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

function extractJsonCandidate(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const source = fenced?.[1]?.trim() ?? trimmed
  const starts = [
    { index: source.indexOf('{'), open: '{', close: '}' },
    { index: source.indexOf('['), open: '[', close: ']' },
  ].filter((item) => item.index >= 0)

  if (starts.length === 0) {
    return source
  }

  const start = starts.sort((left, right) => left.index - right.index)[0]!
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start.index; index < source.length; index += 1) {
    const char = source[index]!
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === start.open) {
      depth += 1
    } else if (char === start.close) {
      depth -= 1
      if (depth === 0) {
        return source.slice(start.index, index + 1)
      }
    }
  }

  return source.slice(start.index)
}

function parseJsonValue(text: string): unknown {
  const withoutFences = extractJsonCandidate(text)
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
  return JSON.parse(withoutFences) as unknown
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = parseJsonValue(text)

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
    '泛称也可以是 mention：如果“旧书店”“那家店”“这个项目”等词可能指向记忆节点，也要输出。',
    '不要提取抽象概念、情绪标签、关系解释或心理分析。',
    '不要创建实体、不要合并实体、不要新增 alias；你只输出当前文本中的 mention。',
    '只输出严格 JSON，不要 markdown，不要解释文字。',
    '顶层格式必须是：{"mentions":[{"surface":string,"type":"person|place|object|project|event|unknown","context_hint":string,"confidence":number}]}。',
    '最多 5 个 mention，按和当前问题的相关性排序。',
    'surface 必须来自原文或原文里的稳定称呼；context_hint 用一句话说明这个 mention 在当前语境里指什么。',
    '如果没有实体，返回 {"mentions":[]}。',
  ].join('\n')
}

export function parseEntityMentionResponse(responseText: string): EntityMention[] {
  const parsed = parseJsonValue(responseText)
  const rawMentions = Array.isArray(parsed)
    ? parsed
    : (
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).mentions
          : []
      )
  const mentionItems = Array.isArray(rawMentions) ? rawMentions : []

  return mentionItems.slice(0, 5).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    const record = item as Record<string, unknown>
    const surface = readText(record.surface) || readText(record.name) || readText(record.mention)
    const type = readEntityType(record.type, null)

    if (!surface || !type) {
      return []
    }

    return [{
      surface,
      type,
      contextHint: readText(record.context_hint) || readText(record.context),
      confidence: readConfidence(record.confidence ?? record.score),
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
  const parsed = parseJsonValue(responseText)
  const rawResolutions = Array.isArray(parsed)
    ? parsed
    : (
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? ((parsed as Record<string, unknown>).resolutions)
          : []
      )
  const resolutionItems = Array.isArray(rawResolutions) ? rawResolutions : []
  const resolutions: EntityResolution[] = []

  for (const item of resolutionItems) {
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
      canonicalName: readText(record.canonical_name) || readText(record.global_entity_id),
      type: readEntityType(record.type, 'unknown') ?? 'unknown',
      confidence: score,
    })
  }

  return resolutions
}
