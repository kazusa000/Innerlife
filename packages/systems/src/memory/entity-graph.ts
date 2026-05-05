export type MemoryEntityType = 'person' | 'place' | 'object' | 'event'

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
  detail: string | null
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

const ENTITY_TYPES = new Set(['person', 'place', 'object', 'event'])
const MERGE_CONFIDENCE_THRESHOLD = 0.75
type AppLocale = 'zh-CN' | 'en-US'

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
  if (raw === 'project') {
    return 'object'
  }
  if (raw === 'unknown') {
    return fallback
  }
  return fallback
}

export function buildEntityMentionPrompt(promptOverride?: string | null, locale: AppLocale = 'zh-CN') {
  const override = promptOverride?.trim()
  if (override) {
    return override
  }

  if (locale === 'en-US') {
    return [
      'You are an entity mention extractor for current-chat memory recall.',
      'You may receive recent conversation plus the current retrieval question; recent conversation is only for resolving pronouns, omissions, and references in the current retrieval question.',
      'Extract real entity mentions from the current retrieval question: person/place/object/event.',
      'object includes items, games, software, books, movies, websites, system names, project names, and other concrete referable objects.',
      'event is only for a specific occurrence, such as a test, trip, meeting, or argument.',
      'Generic mentions may still be valid when they can point to memory nodes, such as "the old bookstore", "that shop", or "this game".',
      'If "that game", "it", or "there" can be uniquely resolved from recent conversation, output the resolved stable surface.',
      'Do not opportunistically output extra entities from recent conversation; output only mentions needed for the current retrieval question.',
      'Do not extract abstract concepts, emotion labels, relationship explanations, or psychological analysis.',
      'Do not create entities, merge entities, or add aliases; only output mentions in the current text.',
      'Return strict JSON only. No markdown and no explanatory text.',
      'Top-level shape: {"mentions":[{"surface":string,"type":"person|place|object|event","context_hint":string,"confidence":number}]}.',
      'At most 5 mentions, sorted by relevance to the current question.',
      'surface must come from the text or a stable resolved phrase from the text; context_hint briefly explains what this mention means in the current context.',
      'If there are no entities, return {"mentions":[]}.',
    ].join('\n')
  }

  return [
    '你是实体 mention 提取器，只服务当前聊天召回。',
    '你可能会收到最近对话和当前检索问题；最近对话只用于补全当前检索问题里的代词、省略、回指，不用于扩写主题。',
    '请从当前检索问题中提取真实实体 mention：person/place/object/event。',
    'object 包含物品、游戏、软件、书、电影、网站、系统名、项目名和其他可被指代的具体对象。',
    'event 只用于某次具体发生过的事情，例如某次测试、旅行、聚会或争吵。',
    '泛称也可以是 mention：如果“旧书店”“那家店”“这个游戏”等词可能指向记忆节点，也要输出。',
    '如果当前检索问题里的“那个游戏”“它”“那里”等能被最近对话唯一补全，surface 输出补全后的稳定称呼。',
    '不要把最近对话中的额外实体顺手输出；只输出服务当前检索问题的 mention。',
    '不要提取抽象概念、情绪标签、关系解释或心理分析。',
    '不要创建实体、不要合并实体、不要新增 alias；你只输出当前文本中的 mention。',
    '只输出严格 JSON，不要 markdown，不要解释文字。',
    '顶层格式必须是：{"mentions":[{"surface":string,"type":"person|place|object|event","context_hint":string,"confidence":number}]}。',
    '最多 5 个 mention，按和当前问题的相关性排序。',
    'surface 必须来自原文或原文里的稳定称呼；context_hint 用一句话说明这个 mention 在当前语境里指什么。',
    '如果没有实体，返回 {"mentions":[]}。',
  ].join('\n')
}

export function buildEpisodicExtractionPrompt(promptOverride?: string | null, locale: AppLocale = 'zh-CN') {
  const override = promptOverride?.trim()
  if (override) {
    return override
  }

  if (locale === 'en-US') {
    return [
      'Extract entities and episodic_memories from memories.',
      'You may summarize multiple memories into one episodic_memory.',
      'Return strict JSON only. No markdown and no explanatory text.',
      'Top-level shape must be: {"entities":[...],"episodic_memories":[...]}.',
      'Each entity must be: {"local_entity_id":string,"surface":string,"type":"person|place|object|event","context_hint":string}.',
      'local_entity_id starts at e1 and increments.',
      'surface must preserve the actual text mentioned in the source; do not standardize, translate, or rewrite it into a guessed formal name.',
      'context_hint briefly explains what this entity means in the memories.',
      'Each episodic_memory must be: {"summary":string,"detail":string,"importance":number,"entity_links":[{"local_entity_id":string,"weight":number}]}.',
      'summary is the concise summary of the episodic memory derived from related memories.',
      'detail is the detailed description of this episodic memory and may refer to related memory detail fields.',
      'importance should fall within the importance range of the related memories.',
      'entity_links.local_entity_id must reference an entity local_entity_id from entities.',
      'weight rules: 0.8-1.0 core entity without which the memory does not stand; 0.5-0.8 important related entity; 0.3-0.5 weak background entity.',
    ].join('\n')
  }

  return [
    '从 memories 抽取 entities 和 episodic_memories。',
    '可以从多条 memories 中总结出一条 episodic_memories。',
    '只输出严格 JSON，不要 markdown，不要解释文字。',
    '顶层格式必须是：{"entities":[...],"episodic_memories":[...]}。',
    'entities 每项格式必须是：{"local_entity_id":string,"surface":string,"type":"person|place|object|event","context_hint":string}。',
    'local_entity_id 从 e1 开始逐渐递增。',
    'surface 必须保留原文中的实际提到的文本，不要提前标准化、翻译或改写成你猜测的正式名称。',
    'context_hint 简单解释这个 entity 在 memories 中的含义。',
    'episodic_memories 每项格式必须是：{"summary":string,"detail":string,"importance":number,"entity_links":[{"local_entity_id":string,"weight":number}]}。',
    'summary 为从相关 memories 中总结出的 episodic_memories 的总结。',
    'detail 为该 episodic_memories 的详细描述，可以参考相关 memories 的 detail。',
    'importance 的范围取在相关 memories 的 importance 范围之间。',
    'entity_links.local_entity_id 必须引用 entities 中的 local_entity_id。',
    'weight 判断规则：0.8-1.0 表示核心实体，没有它记忆就不成立；0.5-0.8 表示重要相关实体，帮助理解记忆；0.3-0.5 表示弱相关背景实体。',
  ].join('\n')
}

export function buildEntityResolutionPrompt(promptOverride?: string | null, locale: AppLocale = 'zh-CN') {
  const override = promptOverride?.trim()
  if (override) {
    return override
  }

  if (locale === 'en-US') {
    return [
      'Stage B: decide whether each local entity should merge into a candidate entity or create_new.',
      'Return strict JSON only. No markdown and no explanatory text.',
      'Top-level shape must be: {"resolutions":[...]}; do not return an array at the top level.',
      'Each resolution must be merge or create_new.',
      'merge shape: {"local_entity_id":string,"action":"merge","entity_id":string,"confidence":number,"alias_to_add":string|null}.',
      'create_new shape: {"local_entity_id":string,"action":"create_new","canonical_name":string,"type":"person|place|object|event","confidence":number}.',
      'Do not use substitute fields such as global_entity_id/name/description/attributes/aliases.',
      'Only merge when confidence >= 0.75.',
      'If unsure, create_new. alias_to_add is allowed only on merge, and must be a stable name for the same entity in the source text.',
      'When merging and local surface differs from candidate canonical_name/existing alias, put local surface in alias_to_add; if identical, use null.',
      'If context_hint clearly says the local entity and a candidate are the same thing, such as "is", "refers to", "abbreviation for", or "same as", prefer merging to that candidate.',
      'Same scene, same category, similar terms, or related things are not aliases.',
      'Games, software, books, movies, websites, system names, and project names are object.',
    ].join('\n')
  }

  return [
    '阶段 B：判断 local entity 是否应 merge 到候选实体，或 create_new。',
    '只输出严格 JSON，不要 markdown，不要解释文字。',
    '顶层格式必须是：{"resolutions":[...]}，不要返回数组。',
    '每个 resolution 必须是 merge 或 create_new。',
    'merge 格式：{"local_entity_id":string,"action":"merge","entity_id":string,"confidence":number,"alias_to_add":string|null}。',
    'create_new 格式：{"local_entity_id":string,"action":"create_new","canonical_name":string,"type":"person|place|object|event","confidence":number}。',
    '不要使用 global_entity_id/name/description/attributes/aliases 等替代字段。',
    '只有 confidence >= 0.75 才允许 merge。',
    '不确定就 create_new。alias_to_add 只允许在 merge 时填写，且必须是同一实体在原文中的稳定叫法。',
    'merge 且 local surface 不等于候选 canonical_name/既有 alias 时，应把 local surface 作为 alias_to_add；完全相同则填 null。',
    '如果 context_hint 明确说明 local entity 和某个候选是同一个实体（例如“就是”“指的是”“简称为”“同一个”），优先 merge 到该候选，不要 create_new。',
    '同场景、同类别、相似词、相关物都不是 alias；例如海盐焦糖和焦糖咖啡不能互为 alias，安特卫普旧书店和东京旧书店不能互为 alias。',
    '游戏、软件、书、电影、网站、系统名和项目名统一标为 object。',
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
      type: readEntityType(record.type, 'object') ?? 'object',
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
      detail: readText(record.detail) || null,
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
      type: readEntityType(record.type, 'object') ?? 'object',
      confidence: score,
    })
  }

  return resolutions
}
