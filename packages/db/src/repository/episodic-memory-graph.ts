import { randomUUID } from 'node:crypto'
import { getMemoryRawSqlite } from '../memory-client'

export type EntityType = 'person' | 'place' | 'object' | 'project' | 'event' | 'unknown'
export type MatchKind = 'exact' | 'contains'

export interface MemoryEntityRecord {
  id: string
  agentId: string
  type: EntityType
  canonicalName: string
  description: string | null
  confidence: number
  createdAt: Date
  lastSeenAt: Date | null
}

export interface EpisodicMemoryRecord {
  id: string
  agentId: string
  sessionId: string
  summary: string
  sourceText: string
  sourceQuote: string | null
  retrievalText: string
  retrievalEmbedding: number[]
  retrievalModel: string
  importance: number
  observedStartAt: Date | null
  observedEndAt: Date | null
  createdAt: Date
}

export interface EpisodicMemoryEntityLinkRecord {
  entity: MemoryEntityRecord
  weight: number
}

export interface EpisodicMemoryWithEntitiesRecord extends EpisodicMemoryRecord {
  entities: EpisodicMemoryEntityLinkRecord[]
}

export interface MemoryEntityWithStatsRecord extends MemoryEntityRecord {
  aliases: string[]
  episodicMemoryCount: number
}

export interface MemoryEntityEdgeRecord {
  agentId: string
  sourceEntityId: string
  sourceCanonicalName: string
  targetEntityId: string
  targetCanonicalName: string
  weight: number
  coOccurrenceCount: number
  lastSeenAt: Date
}

type EntityRow = {
  id: string
  agent_id: string
  type: string
  canonical_name: string
  description: string | null
  confidence: number
  created_at: number
  last_seen_at: number | null
}

type EpisodicMemoryRow = {
  id: string
  agent_id: string
  session_id: string
  summary: string
  source_text: string
  source_quote: string | null
  retrieval_text: string
  retrieval_embedding: string
  retrieval_model: string
  importance: number
  observed_start_at: number | null
  observed_end_at: number | null
  created_at: number
}

type AliasRow = {
  entity_id: string
  alias: string
}

type EpisodicLinkRow = {
  memory_id: string
  entity_id: string
  weight: number
}

type EntityCountRow = {
  entity_id: string
  count: number
}

type EntityEdgeRow = {
  agent_id: string
  source_entity_id: string
  source_canonical_name: string
  target_entity_id: string
  target_canonical_name: string
  weight: number
  co_occurrence_count: number
  last_seen_at: number
}

function normalizeType(type: string): EntityType {
  return type === 'person' || type === 'place' || type === 'object' || type === 'project' || type === 'event'
    ? type
    : 'unknown'
}

function normalizeText(value: string) {
  return value.trim()
}

function parseEmbedding(embedding: string): number[] {
  try {
    const parsed = JSON.parse(embedding) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      : []
  } catch {
    return []
  }
}

function normalizeMatchText(value: string) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, ' ')
}

function hasCjk(value: string) {
  return /[\u3400-\u9fff]/.test(value)
}

function longestCommonSubstringLength(left: string, right: string) {
  let previous = new Array(right.length + 1).fill(0) as number[]
  let best = 0

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = new Array(right.length + 1).fill(0) as number[]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      if (left[leftIndex - 1] === right[rightIndex - 1]) {
        current[rightIndex] = previous[rightIndex - 1]! + 1
        best = Math.max(best, current[rightIndex]!)
      }
    }
    previous = current
  }

  return best
}

function hasSharedConcreteFragment(left: string, right: string) {
  const normalizedLeft = normalizeMatchText(left)
  const normalizedRight = normalizeMatchText(right)
  if (!normalizedLeft || !normalizedRight) {
    return false
  }

  const minLength = hasCjk(normalizedLeft) || hasCjk(normalizedRight) ? 3 : 6
  return longestCommonSubstringLength(normalizedLeft, normalizedRight) >= minLength
}

function clip01(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function mapEntity(row: EntityRow): MemoryEntityRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    type: normalizeType(row.type),
    canonicalName: row.canonical_name,
    description: row.description,
    confidence: row.confidence,
    createdAt: new Date(row.created_at),
    lastSeenAt: typeof row.last_seen_at === 'number' ? new Date(row.last_seen_at) : null,
  }
}

function mapEpisodicMemory(row: EpisodicMemoryRow): EpisodicMemoryRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    summary: row.summary,
    sourceText: row.source_text,
    sourceQuote: row.source_quote,
    retrievalText: row.retrieval_text,
    retrievalEmbedding: parseEmbedding(row.retrieval_embedding),
    retrievalModel: row.retrieval_model,
    importance: row.importance,
    observedStartAt: typeof row.observed_start_at === 'number' ? new Date(row.observed_start_at) : null,
    observedEndAt: typeof row.observed_end_at === 'number' ? new Date(row.observed_end_at) : null,
    createdAt: new Date(row.created_at),
  }
}

function sortedPair(left: string, right: string) {
  return left < right ? [left, right] : [right, left]
}

export function createEntity(input: {
  agentId: string
  type: EntityType
  canonicalName: string
  description?: string | null
  confidence: number
  aliases: Array<{ alias: string; confidence: number }>
  now?: Date
}) {
  const sqlite = getMemoryRawSqlite()
  const now = input.now ?? new Date()
  const id = randomUUID()

  sqlite.prepare(`
    INSERT INTO memory_entities (
      id,
      agent_id,
      type,
      canonical_name,
      description,
      confidence,
      created_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.agentId,
    normalizeType(input.type),
    normalizeText(input.canonicalName),
    input.description?.trim() || null,
    clip01(input.confidence),
    now.getTime(),
    now.getTime(),
  )

  for (const alias of input.aliases) {
    addEntityAlias({
      entityId: id,
      alias: alias.alias,
      confidence: alias.confidence,
      now,
    })
  }

  return getEntity(id)!
}

export function getEntity(entityId: string) {
  const row = getMemoryRawSqlite().prepare(`
    SELECT
      id,
      agent_id,
      type,
      canonical_name,
      description,
      confidence,
      created_at,
      last_seen_at
    FROM memory_entities
    WHERE id = ?
  `).get(entityId) as EntityRow | undefined

  return row ? mapEntity(row) : undefined
}

export function addEntityAlias(input: {
  entityId: string
  alias: string
  confidence: number
  sourceMemoryId?: string | null
  now?: Date
}) {
  const alias = normalizeText(input.alias)
  if (!alias) {
    return false
  }

  const entity = getEntity(input.entityId)
  if (!entity || normalizeMatchText(alias) === normalizeMatchText(entity.canonicalName)) {
    return false
  }

  const now = input.now ?? new Date()
  const result = getMemoryRawSqlite().prepare(`
    INSERT OR IGNORE INTO memory_entity_aliases (
      id,
      entity_id,
      alias,
      confidence,
      source_memory_id,
      created_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    input.entityId,
    alias,
    clip01(input.confidence),
    input.sourceMemoryId ?? null,
    now.getTime(),
    now.getTime(),
  )

  return result.changes > 0
}

export function hasEntitiesForAgent(agentId: string) {
  const row = getMemoryRawSqlite().prepare(`
    SELECT 1 AS value
    FROM memory_entities
    WHERE agent_id = ?
    LIMIT 1
  `).get(agentId) as { value: number } | undefined

  return Boolean(row)
}

export function findEntityCandidates(input: {
  agentId: string
  type?: EntityType
  surface: string
  limit?: number
}) {
  const surface = normalizeText(input.surface)
  if (!surface) {
    return []
  }

  const sqlite = getMemoryRawSqlite()
  const values: unknown[] = [input.agentId]
  const typeCondition = input.type
    ? `AND e.type IN (${input.type === 'unknown' ? '?' : '?, ?'})`
    : ''

  if (input.type === 'unknown') {
    values.push('unknown')
  } else if (input.type) {
    values.push(input.type, 'unknown')
  }

  const rows = sqlite.prepare(`
    SELECT
      e.id,
      e.canonical_name,
      a.alias
    FROM memory_entities e
    LEFT JOIN memory_entity_aliases a ON a.entity_id = e.id
    WHERE e.agent_id = ?
      ${typeCondition}
  `).all(...values) as Array<{ id: string; canonical_name: string; alias: string | null }>

  const items = new Map<string, {
    canonicalName: string
    aliases: string[]
    matchScore: number
  }>()
  for (const row of rows) {
    const item = items.get(row.id) ?? {
      canonicalName: row.canonical_name,
      aliases: [],
      matchScore: 0,
    }
    if (row.alias) {
      item.aliases.push(row.alias)
    }
    items.set(row.id, item)
  }

  const scored = [...items.entries()].flatMap(([id, item]) => {
    const names = [item.canonicalName, ...item.aliases]
    const exact = names.some((name) => normalizeText(name) === surface)
    const contains = names.some((name) =>
      surface.includes(name) || name.includes(surface) || hasSharedConcreteFragment(surface, name),
    )
    const matchScore = exact ? 2 : contains ? 1 : 0
    return matchScore > 0 ? [{ id, matchScore }] : []
  })

  return scored
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, input.limit ?? 10)
    .map((row) => ({ row, entity: getEntity(row.id) }))
    .filter((item): item is { row: { id: string; matchScore: number }; entity: MemoryEntityRecord } =>
      Boolean(item.entity),
    )
    .map(({ row, entity }) => ({
      entity,
      matchKind: row.matchScore >= 2 ? 'exact' as const : 'contains' as const,
    }))
}

export function createEpisodicMemory(input: {
  agentId: string
  sessionId: string
  summary: string
  sourceText: string
  sourceQuote?: string | null
  retrievalText?: string | null
  retrievalEmbedding?: number[]
  retrievalModel?: string | null
  importance: number
  observedStartAt?: Date | null
  observedEndAt?: Date | null
  entityLinks: Array<{ entityId: string; weight: number }>
  now?: Date
}) {
  const sqlite = getMemoryRawSqlite()
  const now = input.now ?? new Date()
  const id = randomUUID()

  sqlite.prepare(`
    INSERT INTO episodic_memories (
      id,
      agent_id,
      session_id,
      summary,
      source_text,
      source_quote,
      retrieval_text,
      retrieval_embedding,
      retrieval_model,
      importance,
      observed_start_at,
      observed_end_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.agentId,
    input.sessionId,
    normalizeText(input.summary),
    input.sourceText,
    input.sourceQuote?.trim() || null,
    input.retrievalText?.trim() || normalizeText(input.summary),
    JSON.stringify(input.retrievalEmbedding?.filter((value) => typeof value === 'number' && Number.isFinite(value)) ?? []),
    input.retrievalModel?.trim() || '',
    clip01(input.importance),
    input.observedStartAt?.getTime() ?? null,
    input.observedEndAt?.getTime() ?? null,
    now.getTime(),
  )

  for (const link of input.entityLinks.slice(0, 5)) {
    if (link.weight < 0.3) {
      continue
    }

    sqlite.prepare(`
      INSERT OR REPLACE INTO episodic_memory_entities (
        memory_id,
        entity_id,
        weight
      ) VALUES (?, ?, ?)
    `).run(id, link.entityId, clip01(link.weight))
  }

  return getEpisodicMemory(id)!
}

export function getEpisodicMemory(memoryId: string) {
  const row = getMemoryRawSqlite().prepare(`
    SELECT
      id,
      agent_id,
      session_id,
      summary,
      source_text,
      source_quote,
      retrieval_text,
      retrieval_embedding,
      retrieval_model,
      importance,
      observed_start_at,
      observed_end_at,
      created_at
    FROM episodic_memories
    WHERE id = ?
  `).get(memoryId) as EpisodicMemoryRow | undefined

  return row ? mapEpisodicMemory(row) : undefined
}

export function listEpisodicMemoriesByAgent(input: {
  agentId: string
  limit?: number
}): EpisodicMemoryWithEntitiesRecord[] {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 50)))
  const sqlite = getMemoryRawSqlite()
  const rows = sqlite.prepare(`
    SELECT
      id,
      agent_id,
      session_id,
      summary,
      source_text,
      source_quote,
      retrieval_text,
      retrieval_embedding,
      retrieval_model,
      importance,
      observed_start_at,
      observed_end_at,
      created_at
    FROM episodic_memories
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(input.agentId, limit) as EpisodicMemoryRow[]

  const memories = rows.map(mapEpisodicMemory)
  if (memories.length === 0) {
    return []
  }

  const memoryIds = memories.map((memory) => memory.id)
  const placeholders = memoryIds.map(() => '?').join(', ')
  const links = sqlite.prepare(`
    SELECT memory_id, entity_id, weight
    FROM episodic_memory_entities
    WHERE memory_id IN (${placeholders})
  `).all(...memoryIds) as EpisodicLinkRow[]

  const entityIds = [...new Set(links.map((link) => link.entity_id))]
  const entities = new Map<string, MemoryEntityRecord>()
  for (const entityId of entityIds) {
    const entity = getEntity(entityId)
    if (entity) {
      entities.set(entityId, entity)
    }
  }

  const linksByMemory = new Map<string, EpisodicMemoryEntityLinkRecord[]>()
  for (const link of links) {
    const entity = entities.get(link.entity_id)
    if (!entity) {
      continue
    }
    const list = linksByMemory.get(link.memory_id) ?? []
    list.push({ entity, weight: clip01(link.weight) })
    linksByMemory.set(link.memory_id, list)
  }

  return memories.map((memory) => ({
    ...memory,
    entities: (linksByMemory.get(memory.id) ?? [])
      .sort((left, right) => right.weight - left.weight || left.entity.canonicalName.localeCompare(right.entity.canonicalName)),
  }))
}

export function listMemoryEntitiesByAgent(agentId: string): MemoryEntityWithStatsRecord[] {
  const sqlite = getMemoryRawSqlite()
  const entities = (sqlite.prepare(`
    SELECT
      id,
      agent_id,
      type,
      canonical_name,
      description,
      confidence,
      created_at,
      last_seen_at
    FROM memory_entities
    WHERE agent_id = ?
    ORDER BY COALESCE(last_seen_at, created_at) DESC, canonical_name ASC
  `).all(agentId) as EntityRow[]).map(mapEntity)

  if (entities.length === 0) {
    return []
  }

  const entityIds = entities.map((entity) => entity.id)
  const placeholders = entityIds.map(() => '?').join(', ')
  const aliases = sqlite.prepare(`
    SELECT entity_id, alias
    FROM memory_entity_aliases
    WHERE entity_id IN (${placeholders})
    ORDER BY alias ASC
  `).all(...entityIds) as AliasRow[]
  const counts = sqlite.prepare(`
    SELECT l.entity_id, COUNT(DISTINCT l.memory_id) AS count
    FROM episodic_memory_entities l
    JOIN episodic_memories m ON m.id = l.memory_id
    WHERE m.agent_id = ?
      AND l.entity_id IN (${placeholders})
    GROUP BY l.entity_id
  `).all(agentId, ...entityIds) as EntityCountRow[]

  const aliasesByEntity = new Map<string, string[]>()
  for (const row of aliases) {
    const list = aliasesByEntity.get(row.entity_id) ?? []
    list.push(row.alias)
    aliasesByEntity.set(row.entity_id, list)
  }

  const countsByEntity = new Map(counts.map((row) => [row.entity_id, row.count]))

  return entities.map((entity) => ({
    ...entity,
    aliases: aliasesByEntity.get(entity.id) ?? [],
    episodicMemoryCount: countsByEntity.get(entity.id) ?? 0,
  }))
}

export function listMemoryEntityEdgesByAgent(agentId: string): MemoryEntityEdgeRecord[] {
  const rows = getMemoryRawSqlite().prepare(`
    SELECT
      edge.agent_id,
      edge.source_entity_id,
      source.canonical_name AS source_canonical_name,
      edge.target_entity_id,
      target.canonical_name AS target_canonical_name,
      edge.weight,
      edge.co_occurrence_count,
      edge.last_seen_at
    FROM memory_entity_edges edge
    JOIN memory_entities source ON source.id = edge.source_entity_id
    JOIN memory_entities target ON target.id = edge.target_entity_id
    WHERE edge.agent_id = ?
    ORDER BY edge.weight DESC, edge.co_occurrence_count DESC, edge.last_seen_at DESC
  `).all(agentId) as EntityEdgeRow[]

  return rows.map((row) => ({
    agentId: row.agent_id,
    sourceEntityId: row.source_entity_id,
    sourceCanonicalName: row.source_canonical_name,
    targetEntityId: row.target_entity_id,
    targetCanonicalName: row.target_canonical_name,
    weight: clip01(row.weight),
    coOccurrenceCount: row.co_occurrence_count,
    lastSeenAt: new Date(row.last_seen_at),
  }))
}

export function findRelevantEpisodicMemories(input: {
  agentId: string
  queryEmbeddings: number[][]
  queryWeights?: number[]
  topK: number
  minSimilarity?: number
}) {
  const weightedQueries = input.queryEmbeddings
    .map((embedding, index) => ({
      embedding,
      weight: input.queryWeights?.[index] ?? 1,
    }))
    .filter((item): item is { embedding: number[]; weight: number } =>
      Array.isArray(item.embedding) && item.embedding.length > 0,
    )
    .map(({ embedding, weight }) => ({
      embedding: embedding.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
      weight: typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : 1,
    }))
    .filter(({ embedding }) => embedding.length > 0)

  if (weightedQueries.length === 0) {
    return []
  }

  const rows = getMemoryRawSqlite().prepare(`
    SELECT
      id,
      agent_id,
      session_id,
      summary,
      source_text,
      source_quote,
      retrieval_text,
      retrieval_embedding,
      retrieval_model,
      importance,
      observed_start_at,
      observed_end_at,
      created_at
    FROM episodic_memories
    WHERE agent_id = ?
  `).all(input.agentId) as EpisodicMemoryRow[]

  const minSimilarity = typeof input.minSimilarity === 'number' && Number.isFinite(input.minSimilarity)
    ? Math.min(1, Math.max(0, input.minSimilarity))
    : 0.6
  const totalWeight = weightedQueries.reduce((sum, query) => sum + query.weight, 0)

  return rows
    .map((row) => {
      const memory = mapEpisodicMemory(row)
      const similarity = totalWeight > 0
        ? weightedQueries.reduce(
          (sum, query) => sum + cosineSimilarity(query.embedding, memory.retrievalEmbedding) * query.weight,
          0,
        ) / totalWeight
        : Math.max(...weightedQueries.map((query) => cosineSimilarity(query.embedding, memory.retrievalEmbedding)))
      return { memory, similarity }
    })
    .filter((hit) => hit.similarity >= minSimilarity)
    .sort((left, right) => {
      if (right.similarity !== left.similarity) {
        return right.similarity - left.similarity
      }
      if (right.memory.importance !== left.memory.importance) {
        return right.memory.importance - left.memory.importance
      }
      return right.memory.createdAt.getTime() - left.memory.createdAt.getTime()
    })
    .slice(0, Math.max(1, input.topK))
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0
  }

  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!
    const rightValue = right[index]!
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

export function upsertEntityEdge(input: {
  agentId: string
  sourceEntityId: string
  targetEntityId: string
  delta: number
  now?: Date
}) {
  if (input.sourceEntityId === input.targetEntityId) {
    return
  }

  const [source, target] = sortedPair(input.sourceEntityId, input.targetEntityId)
  const now = input.now ?? new Date()

  getMemoryRawSqlite().prepare(`
    INSERT INTO memory_entity_edges (
      agent_id,
      source_entity_id,
      target_entity_id,
      weight,
      co_occurrence_count,
      last_seen_at
    ) VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(agent_id, source_entity_id, target_entity_id) DO UPDATE SET
      weight = min(1.0, weight + excluded.weight),
      co_occurrence_count = co_occurrence_count + 1,
      last_seen_at = excluded.last_seen_at
  `).run(input.agentId, source, target, clip01(input.delta), now.getTime())
}

export function recallEpisodicMemories(input: {
  agentId: string
  topK: number
  activations?: Array<{ entityId: string; activation: number }>
  spreadFactor?: number
}) {
  const directActivations = new Map<string, number>()
  for (const item of input.activations ?? []) {
    const activation = clip01(item.activation)
    if (activation <= 0) {
      continue
    }
    directActivations.set(
      item.entityId,
      clip01((directActivations.get(item.entityId) ?? 0) + activation),
    )
  }

  if (directActivations.size === 0) {
    return []
  }

  const sqlite = getMemoryRawSqlite()
  const spreadFactor = typeof input.spreadFactor === 'number' && Number.isFinite(input.spreadFactor)
    ? Math.max(0, input.spreadFactor)
    : 0.35
  const activationScores = new Map(directActivations)

  for (const [entityId, activation] of directActivations) {
    const rows = sqlite.prepare(`
      SELECT source_entity_id, target_entity_id, weight
      FROM memory_entity_edges
      WHERE agent_id = ?
        AND (source_entity_id = ? OR target_entity_id = ?)
    `).all(input.agentId, entityId, entityId) as Array<{
      source_entity_id: string
      target_entity_id: string
      weight: number
    }>

    for (const row of rows) {
      const neighborId = row.source_entity_id === entityId ? row.target_entity_id : row.source_entity_id
      const spreadActivation = clip01(activation * row.weight * spreadFactor)
      if (spreadActivation <= 0) {
        continue
      }
      activationScores.set(
        neighborId,
        clip01((activationScores.get(neighborId) ?? 0) + spreadActivation),
      )
    }
  }

  const entityIds = [...activationScores.keys()]
  if (entityIds.length === 0) {
    return []
  }

  const placeholders = entityIds.map(() => '?').join(', ')
  const rows = sqlite.prepare(`
    SELECT
      m.id,
      l.entity_id,
      l.weight,
      m.importance,
      m.created_at
    FROM episodic_memory_entities l
    JOIN episodic_memories m ON m.id = l.memory_id
    WHERE m.agent_id = ?
      AND l.entity_id IN (${placeholders})
  `).all(input.agentId, ...entityIds) as Array<{
    id: string
    entity_id: string
    weight: number
    importance: number
    created_at: number
  }>

  const scored = new Map<string, {
    id: string
    score: number
    linkedEntityIds: Set<string>
    createdAt: number
  }>()
  for (const row of rows) {
    const existing = scored.get(row.id) ?? {
      id: row.id,
      score: 0.15 * clip01(row.importance),
      linkedEntityIds: new Set<string>(),
      createdAt: row.created_at,
    }
    existing.score += (activationScores.get(row.entity_id) ?? 0) * clip01(row.weight)
    existing.linkedEntityIds.add(row.entity_id)
    scored.set(row.id, existing)
  }

  return [...scored.values()]
    .map((item) => ({
      id: item.id,
      score: item.score + 0.1 * Math.max(0, item.linkedEntityIds.size - 1),
      createdAt: item.createdAt,
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return right.createdAt - left.createdAt
    })
    .slice(0, Math.max(1, input.topK))
    .map((row) => getEpisodicMemory(row.id))
    .filter((memory): memory is EpisodicMemoryRecord => Boolean(memory))
}
