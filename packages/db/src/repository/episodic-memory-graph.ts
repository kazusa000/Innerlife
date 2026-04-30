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
  importance: number
  observedStartAt: Date | null
  observedEndAt: Date | null
  createdAt: Date
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
  importance: number
  observed_start_at: number | null
  observed_end_at: number | null
  created_at: number
}

function normalizeType(type: string): EntityType {
  return type === 'person' || type === 'place' || type === 'object' || type === 'project' || type === 'event'
    ? type
    : 'unknown'
}

function normalizeText(value: string) {
  return value.trim()
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
      max(
        CASE
          WHEN e.canonical_name = ? THEN 2
          WHEN a.alias = ? THEN 2
          ELSE 1
        END
      ) AS match_score
    FROM memory_entities e
    LEFT JOIN memory_entity_aliases a ON a.entity_id = e.id
    WHERE e.agent_id = ?
      ${typeCondition}
      AND (
        e.canonical_name = ?
        OR a.alias = ?
        OR instr(?, e.canonical_name) > 0
        OR instr(e.canonical_name, ?) > 0
        OR (a.alias IS NOT NULL AND instr(?, a.alias) > 0)
        OR (a.alias IS NOT NULL AND instr(a.alias, ?) > 0)
      )
    GROUP BY e.id
    ORDER BY match_score DESC
    LIMIT ?
  `).all(
    surface,
    surface,
    ...values,
    surface,
    surface,
    surface,
    surface,
    surface,
    surface,
    input.limit ?? 10,
  ) as Array<{ id: string; match_score: number }>

  return rows
    .map((row) => ({ row, entity: getEntity(row.id) }))
    .filter((item): item is { row: { id: string; match_score: number }; entity: MemoryEntityRecord } =>
      Boolean(item.entity),
    )
    .map(({ row, entity }) => ({
      entity,
      matchKind: row.match_score >= 2 ? 'exact' as const : 'contains' as const,
    }))
}

export function createEpisodicMemory(input: {
  agentId: string
  sessionId: string
  summary: string
  sourceText: string
  sourceQuote?: string | null
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
      importance,
      observed_start_at,
      observed_end_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.agentId,
    input.sessionId,
    normalizeText(input.summary),
    input.sourceText,
    input.sourceQuote?.trim() || null,
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
      importance,
      observed_start_at,
      observed_end_at,
      created_at
    FROM episodic_memories
    WHERE id = ?
  `).get(memoryId) as EpisodicMemoryRow | undefined

  return row ? mapEpisodicMemory(row) : undefined
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

export function activateEntities(input: {
  agentId: string
  activations: Array<{ entityId: string; activation: number; reason: string }>
  ttlMs: number
  maxActive: number
  spreadFactor: number
  now?: Date
}) {
  const sqlite = getMemoryRawSqlite()
  const now = input.now ?? new Date()
  const expiresAt = now.getTime() + input.ttlMs

  sqlite.prepare(`
    DELETE FROM memory_entity_activations
    WHERE agent_id = ? AND expires_at <= ?
  `).run(input.agentId, now.getTime())

  const direct = input.activations.map((item) => ({
    entityId: item.entityId,
    activation: clip01(item.activation),
    reason: item.reason,
  }))
  const spread = direct.flatMap((item) => {
    const rows = sqlite.prepare(`
      SELECT source_entity_id, target_entity_id, weight
      FROM memory_entity_edges
      WHERE agent_id = ?
        AND (source_entity_id = ? OR target_entity_id = ?)
    `).all(input.agentId, item.entityId, item.entityId) as Array<{
      source_entity_id: string
      target_entity_id: string
      weight: number
    }>

    return rows.map((row) => ({
      entityId: row.source_entity_id === item.entityId ? row.target_entity_id : row.source_entity_id,
      activation: clip01(item.activation * row.weight * input.spreadFactor),
      reason: 'spread',
    }))
  })

  for (const item of [...direct, ...spread]) {
    if (item.activation <= 0) {
      continue
    }

    sqlite.prepare(`
      INSERT INTO memory_entity_activations (
        agent_id,
        entity_id,
        activation,
        reason,
        expires_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, entity_id) DO UPDATE SET
        activation = min(1.0, activation + excluded.activation),
        reason = excluded.reason,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(input.agentId, item.entityId, item.activation, item.reason, expiresAt, now.getTime())
  }

  const overflow = sqlite.prepare(`
    SELECT entity_id
    FROM memory_entity_activations
    WHERE agent_id = ?
    ORDER BY activation DESC, updated_at DESC
    LIMIT -1 OFFSET ?
  `).all(input.agentId, input.maxActive) as Array<{ entity_id: string }>

  for (const row of overflow) {
    sqlite.prepare(`
      DELETE FROM memory_entity_activations
      WHERE agent_id = ? AND entity_id = ?
    `).run(input.agentId, row.entity_id)
  }
}

export function recallEpisodicMemories(input: {
  agentId: string
  topK: number
  now?: Date
}) {
  const now = input.now ?? new Date()
  const rows = getMemoryRawSqlite().prepare(`
    SELECT
      m.id,
      sum(a.activation * l.weight)
        + (0.15 * m.importance)
        + (0.1 * max(0, count(distinct l.entity_id) - 1)) AS score
    FROM memory_entity_activations a
    JOIN episodic_memory_entities l ON l.entity_id = a.entity_id
    JOIN episodic_memories m ON m.id = l.memory_id
    WHERE a.agent_id = ?
      AND m.agent_id = ?
      AND a.expires_at > ?
    GROUP BY m.id
    ORDER BY score DESC, m.created_at DESC
    LIMIT ?
  `).all(input.agentId, input.agentId, now.getTime(), input.topK) as Array<{ id: string }>

  return rows
    .map((row) => getEpisodicMemory(row.id))
    .filter((memory): memory is EpisodicMemoryRecord => Boolean(memory))
}
