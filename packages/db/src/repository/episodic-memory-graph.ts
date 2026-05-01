import { randomUUID } from 'node:crypto'
import { getMemoryRawSqlite } from '../memory-client'

export type EntityType = 'person' | 'place' | 'object' | 'event'
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

export type ManagedMemoryRowLayer = 'short_term' | 'long_term' | 'fixed' | 'episodic'
export type ManagedMemoryRowKind = 'sqlite' | 'episodic'

export interface ManagedMemoryRowRecord {
  kind: ManagedMemoryRowKind
  id: string
  agentId: string
  sessionId: string
  layer: ManagedMemoryRowLayer
  summary: string
  retrievalText: string
  sourceQuote: string | null
  retrievalEmbedding: number[]
  retrievalModel: string
  importance: number
  observedStartAt: Date | null
  observedEndAt: Date | null
  createdAt: Date
  entities: EpisodicMemoryEntityLinkRecord[]
}

export interface PageResult<T> {
  total: number
  page: number
  pageSize: number
  items: T[]
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

type ManagedMemorySqlRow = {
  kind: ManagedMemoryRowKind
  id: string
  agent_id: string
  session_id: string
  layer: ManagedMemoryRowLayer
  summary: string
  retrieval_text: string
  source_quote: string | null
  retrieval_embedding: string
  retrieval_model: string
  importance: number
  observed_start_at: number | null
  observed_end_at: number | null
  created_at: number
}

function normalizeType(type: string): EntityType {
  return type === 'person' || type === 'place' || type === 'object' || type === 'event'
    ? type
    : 'object'
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

function normalizePage(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

function normalizePageSize(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.floor(value))) : 20
}

function readSearchQuery(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.toLowerCase() : null
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

function mapManagedMemoryRow(row: ManagedMemorySqlRow): ManagedMemoryRowRecord {
  return {
    kind: row.kind,
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    layer: row.layer,
    summary: row.summary,
    retrievalText: row.retrieval_text,
    sourceQuote: row.source_quote,
    retrievalEmbedding: parseEmbedding(row.retrieval_embedding),
    retrievalModel: row.retrieval_model,
    importance: row.importance,
    observedStartAt: typeof row.observed_start_at === 'number' ? new Date(row.observed_start_at) : null,
    observedEndAt: typeof row.observed_end_at === 'number' ? new Date(row.observed_end_at) : null,
    createdAt: new Date(row.created_at),
    entities: [],
  }
}

function attachEpisodicEntityLinks<T extends { id: string; kind?: ManagedMemoryRowKind; entities: EpisodicMemoryEntityLinkRecord[] }>(rows: T[]) {
  const episodicIds = rows
    .filter((row) => row.kind === undefined || row.kind === 'episodic')
    .map((row) => row.id)
  if (episodicIds.length === 0) {
    return rows
  }

  const sqlite = getMemoryRawSqlite()
  const placeholders = episodicIds.map(() => '?').join(', ')
  const links = sqlite.prepare(`
    SELECT memory_id, entity_id, weight
    FROM episodic_memory_entities
    WHERE memory_id IN (${placeholders})
  `).all(...episodicIds) as EpisodicLinkRow[]

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

  for (const row of rows) {
    if (row.kind === 'sqlite') {
      continue
    }
    row.entities = (linksByMemory.get(row.id) ?? [])
      .sort((left, right) => right.weight - left.weight || left.entity.canonicalName.localeCompare(right.entity.canonicalName))
  }

  return rows
}

function attachEntityStats(entities: MemoryEntityRecord[]): MemoryEntityWithStatsRecord[] {
  if (entities.length === 0) {
    return []
  }

  const sqlite = getMemoryRawSqlite()
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
    WHERE l.entity_id IN (${placeholders})
    GROUP BY l.entity_id
  `).all(...entityIds) as EntityCountRow[]

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
  const requestedType = input.type ? normalizeType(input.type) : null

  const rows = sqlite.prepare(`
    SELECT
      e.id,
      e.type,
      e.canonical_name,
      a.alias
    FROM memory_entities e
    LEFT JOIN memory_entity_aliases a ON a.entity_id = e.id
    WHERE e.agent_id = ?
  `).all(input.agentId) as Array<{ id: string; type: string; canonical_name: string; alias: string | null }>

  const items = new Map<string, {
    canonicalName: string
    aliases: string[]
    matchScore: number
    typeScore: number
  }>()
  for (const row of rows) {
    const item = items.get(row.id) ?? {
      canonicalName: row.canonical_name,
      aliases: [],
      matchScore: 0,
      typeScore: requestedType && normalizeType(row.type) === requestedType ? 1 : 0,
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
    return matchScore > 0 ? [{ id, matchScore, typeScore: item.typeScore }] : []
  })

  return scored
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) {
        return right.matchScore - left.matchScore
      }
      return right.typeScore - left.typeScore
    })
    .slice(0, input.limit ?? 10)
    .map((row) => ({ row, entity: getEntity(row.id) }))
    .filter((item): item is { row: { id: string; matchScore: number; typeScore: number }; entity: MemoryEntityRecord } =>
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
  return attachEpisodicEntityLinks(memories.map((memory) => ({ ...memory, entities: [] })))
}

export function listManagedMemoryRowsByAgent(input: {
  agentId: string
  query?: string | null
  layer?: ManagedMemoryRowLayer | null
  page: number
  pageSize: number
}): PageResult<ManagedMemoryRowRecord> {
  const page = normalizePage(input.page)
  const pageSize = normalizePageSize(input.pageSize)
  const offset = (page - 1) * pageSize
  const query = readSearchQuery(input.query)
  const layer = input.layer ?? null
  const sqlite = getMemoryRawSqlite()
  const unionParts: string[] = []
  const unionValues: unknown[] = []

  if (layer !== 'episodic') {
    const sqliteLayers = layer
      ? [layer]
      : ['short_term', 'fixed']
    unionParts.push(`
      SELECT
        'sqlite' AS kind,
        id,
        agent_id,
        session_id,
        layer,
        display_summary AS summary,
        retrieval_text,
        NULL AS source_quote,
        retrieval_embedding,
        retrieval_model,
        importance,
        observed_start_at,
        observed_end_at,
        created_at
      FROM memories
      WHERE agent_id = ?
        AND layer IN (${sqliteLayers.map(() => '?').join(', ')})
    `)
    unionValues.push(input.agentId, ...sqliteLayers)
  }

  if (!layer || layer === 'episodic') {
    unionParts.push(`
      SELECT
        'episodic' AS kind,
        id,
        agent_id,
        session_id,
        'episodic' AS layer,
        summary,
        retrieval_text,
        source_quote,
        retrieval_embedding,
        retrieval_model,
        importance,
        observed_start_at,
        observed_end_at,
        created_at
      FROM episodic_memories
      WHERE agent_id = ?
    `)
    unionValues.push(input.agentId)
  }

  if (unionParts.length === 0) {
    return { total: 0, page, pageSize, items: [] }
  }

  const queryCondition = query
    ? `WHERE (
        lower(summary) LIKE ?
        OR lower(retrieval_text) LIKE ?
        OR lower(COALESCE(source_quote, '')) LIKE ?
      )`
    : ''
  const queryValues = query ? [`%${query}%`, `%${query}%`, `%${query}%`] : []
  const fromSql = `FROM (${unionParts.join(' UNION ALL ')}) unified ${queryCondition}`
  const totalRow = sqlite.prepare(`
    SELECT COUNT(*) AS total
    ${fromSql}
  `).get(...unionValues, ...queryValues) as { total: number } | undefined
  const rows = sqlite.prepare(`
    SELECT *
    ${fromSql}
    ORDER BY created_at DESC, id ASC
    LIMIT ? OFFSET ?
  `).all(...unionValues, ...queryValues, pageSize, offset) as ManagedMemorySqlRow[]

  return {
    total: totalRow?.total ?? 0,
    page,
    pageSize,
    items: attachEpisodicEntityLinks(rows.map(mapManagedMemoryRow)),
  }
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

  return attachEntityStats(entities)
}

export function listMemoryEntitiesPageByAgent(input: {
  agentId: string
  query?: string | null
  page: number
  pageSize: number
}): PageResult<MemoryEntityWithStatsRecord> {
  const page = normalizePage(input.page)
  const pageSize = normalizePageSize(input.pageSize)
  const offset = (page - 1) * pageSize
  const query = readSearchQuery(input.query)
  const sqlite = getMemoryRawSqlite()
  const conditions = ['e.agent_id = ?']
  const values: unknown[] = [input.agentId]

  if (query) {
    const wildcard = `%${query}%`
    conditions.push(`(
      lower(e.canonical_name) LIKE ?
      OR lower(COALESCE(e.description, '')) LIKE ?
      OR EXISTS (
        SELECT 1
        FROM memory_entity_aliases a
        WHERE a.entity_id = e.id
          AND lower(a.alias) LIKE ?
      )
    )`)
    values.push(wildcard, wildcard, wildcard)
  }

  const whereSql = conditions.join(' AND ')
  const totalRow = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM memory_entities e
    WHERE ${whereSql}
  `).get(...values) as { total: number } | undefined
  const entities = (sqlite.prepare(`
    SELECT
      e.id,
      e.agent_id,
      e.type,
      e.canonical_name,
      e.description,
      e.confidence,
      e.created_at,
      e.last_seen_at
    FROM memory_entities e
    WHERE ${whereSql}
    ORDER BY COALESCE(e.last_seen_at, e.created_at) DESC, e.canonical_name ASC
    LIMIT ? OFFSET ?
  `).all(...values, pageSize, offset) as EntityRow[]).map(mapEntity)

  return {
    total: totalRow?.total ?? 0,
    page,
    pageSize,
    items: attachEntityStats(entities),
  }
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

export function listMemoryEntityEdgesPageByAgent(input: {
  agentId: string
  query?: string | null
  page: number
  pageSize: number
}): PageResult<MemoryEntityEdgeRecord> {
  const page = normalizePage(input.page)
  const pageSize = normalizePageSize(input.pageSize)
  const offset = (page - 1) * pageSize
  const query = readSearchQuery(input.query)
  const conditions = ['edge.agent_id = ?']
  const values: unknown[] = [input.agentId]

  if (query) {
    const wildcard = `%${query}%`
    conditions.push(`(
      lower(source.canonical_name) LIKE ?
      OR lower(target.canonical_name) LIKE ?
      OR EXISTS (
        SELECT 1
        FROM memory_entity_aliases source_alias
        WHERE source_alias.entity_id = source.id
          AND lower(source_alias.alias) LIKE ?
      )
      OR EXISTS (
        SELECT 1
        FROM memory_entity_aliases target_alias
        WHERE target_alias.entity_id = target.id
          AND lower(target_alias.alias) LIKE ?
      )
    )`)
    values.push(wildcard, wildcard, wildcard, wildcard)
  }

  const whereSql = conditions.join(' AND ')
  const sqlite = getMemoryRawSqlite()
  const totalRow = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM memory_entity_edges edge
    JOIN memory_entities source ON source.id = edge.source_entity_id
    JOIN memory_entities target ON target.id = edge.target_entity_id
    WHERE ${whereSql}
  `).get(...values) as { total: number } | undefined
  const rows = sqlite.prepare(`
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
    WHERE ${whereSql}
    ORDER BY edge.weight DESC, edge.co_occurrence_count DESC, edge.last_seen_at DESC
    LIMIT ? OFFSET ?
  `).all(...values, pageSize, offset) as EntityEdgeRow[]

  return {
    total: totalRow?.total ?? 0,
    page,
    pageSize,
    items: rows.map((row) => ({
      agentId: row.agent_id,
      sourceEntityId: row.source_entity_id,
      sourceCanonicalName: row.source_canonical_name,
      targetEntityId: row.target_entity_id,
      targetCanonicalName: row.target_canonical_name,
      weight: clip01(row.weight),
      coOccurrenceCount: row.co_occurrence_count,
      lastSeenAt: new Date(row.last_seen_at),
    })),
  }
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
