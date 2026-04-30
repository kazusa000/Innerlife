export type MemoryEntityType = 'person' | 'place' | 'object' | 'project' | 'event' | 'unknown'

export interface EntityMention {
  surface: string
  type: MemoryEntityType
  contextHint: string
  confidence: number
}

export interface EpisodicExtractionEntity {
  localEntityId: string
  surface: string
  type: MemoryEntityType
  contextHint: string
  aliases: string[]
}

export interface EpisodicMemoryDraft {
  summary: string
  sourceQuote: string | null
  importance: number
  entityLinks: Array<{ localEntityId: string; weight: number }>
}

export type EntityResolution =
  | {
      localEntityId: string
      action: 'merge'
      entityId: string
      confidence: number
      aliasToAdd: string | null
    }
  | {
      localEntityId: string
      action: 'create_new'
      canonicalName: string
      type: MemoryEntityType
      confidence: number
    }

const ENTITY_TYPES = new Set(['person', 'place', 'object', 'project', 'event', 'unknown'])
const MERGE_CONFIDENCE_THRESHOLD = 0.75

function parseJsonObject(text: string): Record<string, unknown> {
  const withoutFences = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  const candidate = start >= 0 && end > start
    ? withoutFences.slice(start, end + 1)
    : withoutFences
  const parsed = JSON.parse(candidate) as unknown

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected JSON object')
  }

  return parsed as Record<string, unknown>
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readConfidence(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0.5
}

function readEntityType(value: unknown, fallback: MemoryEntityType | null): MemoryEntityType | null {
  const raw = readText(value)
  if (ENTITY_TYPES.has(raw)) {
    return raw as MemoryEntityType
  }
  return fallback
}

export function buildEntityMentionPrompt() {
  return [
    '你是实体 mention 提取器，只服务当前聊天召回。',
    '请从当前用户消息中提取真实实体 mention：person/place/object/project/event/unknown。',
    '不要提取抽象概念、情绪标签、关系解释或心理分析。',
    '不要创建实体、不要合并实体、不要新增 alias；你只输出当前文本中的 mention。',
    '返回 JSON：{"mentions":[{"surface":string,"type":string,"context_hint":string,"confidence":number}]}。',
    'surface 必须来自原文或原文里的稳定称呼；context_hint 用一句话说明这个 mention 在当前语境里指什么。',
    '如果没有实体，返回 {"mentions":[]}。',
  ].join('\n')
}

export function parseEntityMentionResponse(responseText: string): EntityMention[] {
  const parsed = parseJsonObject(responseText)
  const rawMentions = Array.isArray(parsed.mentions) ? parsed.mentions : []

  return rawMentions.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    const record = item as Record<string, unknown>
    const surface = readText(record.surface)
    const type = readEntityType(record.type, null)

    if (!surface || !type) {
      return []
    }

    return [{
      surface,
      type,
      contextHint: readText(record.context_hint),
      confidence: readConfidence(record.confidence),
    }]
  })
}

export function parseEpisodicExtractionResponse(responseText: string): {
  entities: EpisodicExtractionEntity[]
  episodicMemories: EpisodicMemoryDraft[]
} {
  const parsed = parseJsonObject(responseText)
  const entities = (Array.isArray(parsed.entities) ? parsed.entities : []).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    const record = item as Record<string, unknown>
    const localEntityId = readText(record.local_entity_id)
    const surface = readText(record.surface)

    if (!localEntityId || !surface) {
      return []
    }

    return [{
      localEntityId,
      surface,
      type: readEntityType(record.type, 'unknown') ?? 'unknown',
      contextHint: readText(record.context_hint),
      aliases: Array.isArray(record.aliases)
        ? record.aliases.map(readText).filter(Boolean)
        : [],
    }]
  })

  const entityIds = new Set(entities.map((entity) => entity.localEntityId))
  const episodicMemories = (Array.isArray(parsed.episodic_memories) ? parsed.episodic_memories : []).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    const record = item as Record<string, unknown>
    const summary = readText(record.summary)
    if (!summary) {
      return []
    }

    const entityLinks = (Array.isArray(record.entity_links) ? record.entity_links : [])
      .flatMap((link) => {
        if (!link || typeof link !== 'object' || Array.isArray(link)) {
          return []
        }

        const linkRecord = link as Record<string, unknown>
        const localEntityId = readText(linkRecord.local_entity_id)
        const weight = readConfidence(linkRecord.weight)

        return entityIds.has(localEntityId) && weight >= 0.3
          ? [{ localEntityId, weight }]
          : []
      })
      .slice(0, 5)

    return [{
      summary,
      sourceQuote: readText(record.source_quote) || null,
      importance: readConfidence(record.importance),
      entityLinks,
    }]
  })

  return { entities, episodicMemories }
}

export function parseEntityResolutionResponse(responseText: string): EntityResolution[] {
  const parsed = parseJsonObject(responseText)
  const rawResolutions = Array.isArray(parsed.resolutions) ? parsed.resolutions : []
  const resolutions: EntityResolution[] = []

  for (const item of rawResolutions) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }

    const record = item as Record<string, unknown>
    const localEntityId = readText(record.local_entity_id)
    if (!localEntityId) {
      continue
    }

    const score = readConfidence(record.confidence)
    if (
      readText(record.action) === 'merge'
      && score >= MERGE_CONFIDENCE_THRESHOLD
      && readText(record.entity_id)
    ) {
      resolutions.push({
        localEntityId,
        action: 'merge' as const,
        entityId: readText(record.entity_id),
        confidence: score,
        aliasToAdd: readText(record.alias_to_add) || null,
      })
      continue
    }

    resolutions.push({
      localEntityId,
      action: 'create_new' as const,
      canonicalName: readText(record.canonical_name),
      type: readEntityType(record.type, 'unknown') ?? 'unknown',
      confidence: score,
    })
  }

  return resolutions
}
