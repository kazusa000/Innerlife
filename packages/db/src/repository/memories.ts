import { randomUUID } from 'node:crypto'
import { getMemoryRawSqlite } from '../memory-client'

export type MemoryLayer = 'short_term' | 'long_term' | 'fixed'

export interface MemoryRecord {
  id: string
  agentId: string
  sessionId: string
  layer: MemoryLayer
  sourceText: string
  detail: string
  retrievalText: string
  retrievalEmbedding: number[]
  retrievalModel: string
  tags: string[]
  importance: number
  observedStartAt: Date | null
  observedEndAt: Date | null
  createdAt: Date
}

type MemoryRow = {
  id: string
  agent_id: string
  session_id: string
  layer: string
  source_text: string
  display_summary: string
  retrieval_text: string
  retrieval_embedding: string
  retrieval_model: string
  tags: string
  importance: number
  observed_start_at: number | null
  observed_end_at: number | null
  created_at: number
}

const MIN_SEMANTIC_SIMILARITY = 0.6

function normalizeTags(tags: string[]): string[] {
  return [...new Set(
    tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean),
  )]
}

function normalizeLayer(layer: string | null | undefined): MemoryLayer {
  if (layer === 'long_term' || layer === 'fixed') {
    return layer
  }
  return 'short_term'
}

function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
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

function mapMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    layer: normalizeLayer(row.layer),
    sourceText: row.source_text,
    detail: row.display_summary,
    retrievalText: row.retrieval_text,
    retrievalEmbedding: parseEmbedding(row.retrieval_embedding),
    retrievalModel: row.retrieval_model,
    tags: parseTags(row.tags),
    importance: row.importance,
    observedStartAt: typeof row.observed_start_at === 'number' ? new Date(row.observed_start_at) : null,
    observedEndAt: typeof row.observed_end_at === 'number' ? new Date(row.observed_end_at) : null,
    createdAt: new Date(row.created_at),
  }
}

function selectMemories(whereSql: string, ...values: unknown[]) {
  const sqlite = getMemoryRawSqlite()
  return sqlite.prepare(`
    SELECT
      id,
      agent_id,
      session_id,
      layer,
      source_text,
      display_summary,
      retrieval_text,
      retrieval_embedding,
      retrieval_model,
      tags,
      importance,
      observed_start_at,
      observed_end_at,
      created_at
    FROM memories
    ${whereSql}
  `).all(...values).map((row) => mapMemory(row as MemoryRow))
}

export function addMemory(data: {
  agentId: string
  sessionId: string
  layer?: MemoryLayer
  sourceText: string
  detail?: string
  displaySummary?: string
  retrievalText: string
  retrievalEmbedding: number[]
  retrievalModel: string
  tags: string[]
  importance: number
  observedStartAt?: Date | null
  observedEndAt?: Date | null
  createdAt?: Date
}) {
  const sqlite = getMemoryRawSqlite()
  const id = randomUUID()
  const detail = data.detail ?? data.displaySummary

  if (!detail?.trim()) {
    throw new Error('memory detail is required')
  }

  sqlite.prepare(`
    INSERT INTO memories (
      id,
      agent_id,
      session_id,
      layer,
      source_text,
      display_summary,
      retrieval_text,
      retrieval_embedding,
      retrieval_model,
      tags,
      importance,
      observed_start_at,
      observed_end_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.agentId,
    data.sessionId,
    normalizeLayer(data.layer),
    data.sourceText,
    detail.trim(),
    data.retrievalText.trim(),
    JSON.stringify(data.retrievalEmbedding),
    data.retrievalModel,
    JSON.stringify(normalizeTags(data.tags)),
    normalizeImportance(data.importance),
    data.observedStartAt?.getTime() ?? null,
    data.observedEndAt?.getTime() ?? null,
    (data.createdAt ?? new Date()).getTime(),
  )

  return getMemory(id)!
}

export function getMemory(id: string) {
  const rows = selectMemories('WHERE id = ?', id)
  return rows[0]
}

export function listMemoriesByAgent(agentId: string) {
  return selectMemories('WHERE agent_id = ? ORDER BY created_at DESC', agentId)
}

export function listSqliteMemoriesByAgent(agentId: string, query?: string) {
  const normalizedQuery = query?.trim().toLowerCase()

  if (!normalizedQuery) {
    return listMemoriesByAgent(agentId)
  }

  const wildcard = `%${normalizedQuery}%`
  return selectMemories(
    `WHERE agent_id = ?
       AND (
         lower(display_summary) LIKE ?
         OR lower(retrieval_text) LIKE ?
       )
     ORDER BY created_at DESC`,
    agentId,
    wildcard,
    wildcard,
  )
}

export function listSqliteMemoriesPageByAgent(input: {
  agentId: string
  query?: string
  layer?: MemoryLayer | null
  layers?: MemoryLayer[]
  page: number
  pageSize: number
}) {
  const normalizedPage = Math.max(1, Math.floor(input.page))
  const normalizedPageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize)))
  const normalizedQuery = input.query?.trim().toLowerCase()
  const normalizedLayer = input.layer ? normalizeLayer(input.layer) : null
  const normalizedLayers = normalizedLayer
    ? []
    : (input.layers ?? [])
      .map(normalizeLayer)
      .filter((layer, index, layers) => layers.indexOf(layer) === index)
  const sqlite = getMemoryRawSqlite()
  const offset = (normalizedPage - 1) * normalizedPageSize

  if (!normalizedQuery) {
    const conditions = ['agent_id = ?']
    const values: unknown[] = [input.agentId]
    if (normalizedLayer) {
      conditions.push('layer = ?')
      values.push(normalizedLayer)
    } else if (normalizedLayers.length > 0) {
      conditions.push(`layer IN (${normalizedLayers.map(() => '?').join(', ')})`)
      values.push(...normalizedLayers)
    }
    const totalRow = sqlite.prepare(`
      SELECT COUNT(*) as total
      FROM memories
      WHERE ${conditions.join(' AND ')}
    `).get(...values) as { total: number } | undefined

    return {
      total: totalRow?.total ?? 0,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      memories: selectMemories(
        `WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        ...values,
        normalizedPageSize,
        offset,
      ),
    }
  }

  const wildcard = `%${normalizedQuery}%`
  const conditions = ['agent_id = ?']
  const values: unknown[] = [input.agentId]
  if (normalizedLayer) {
    conditions.push('layer = ?')
    values.push(normalizedLayer)
  } else if (normalizedLayers.length > 0) {
    conditions.push(`layer IN (${normalizedLayers.map(() => '?').join(', ')})`)
    values.push(...normalizedLayers)
  }
  conditions.push(`(
    lower(display_summary) LIKE ?
    OR lower(retrieval_text) LIKE ?
  )`)
  values.push(wildcard, wildcard)
  const totalRow = sqlite.prepare(`
    SELECT COUNT(*) as total
    FROM memories
    WHERE ${conditions.join(' AND ')}
  `).get(...values) as { total: number } | undefined

  return {
    total: totalRow?.total ?? 0,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    memories: selectMemories(
      `WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      ...values,
      normalizedPageSize,
      offset,
    ),
  }
}

export function listMemoriesByAgentOldestFirst(agentId: string) {
  return selectMemories('WHERE agent_id = ? ORDER BY created_at ASC', agentId)
}

export function deleteSqliteMemoryByAgent(agentId: string, memoryId: string) {
  const sqlite = getMemoryRawSqlite()
  const result = sqlite.prepare(`
    DELETE FROM memories
    WHERE agent_id = ? AND id = ?
  `).run(agentId, memoryId)

  return result.changes > 0
}

export function deleteMemoriesByAgent(agentId: string) {
  const sqlite = getMemoryRawSqlite()
  const result = sqlite.prepare(`
    DELETE FROM memories
    WHERE agent_id = ?
  `).run(agentId)

  return result.changes
}

export function updateSqliteMemoryLayerByAgent(agentId: string, memoryId: string, layer: MemoryLayer) {
  const sqlite = getMemoryRawSqlite()
  const result = sqlite.prepare(`
    UPDATE memories
    SET layer = ?
    WHERE agent_id = ? AND id = ?
  `).run(normalizeLayer(layer), agentId, memoryId)

  return result.changes > 0
}

export function updateSqliteMemoryByAgent(input: {
  agentId: string
  memoryId: string
  layer: MemoryLayer
  detail: string
  retrievalText: string
  retrievalEmbedding: number[]
  retrievalModel: string
  importance: number
  observedStartAt: Date | null
  observedEndAt: Date | null
}) {
  const detail = input.detail.trim()
  const retrievalText = input.retrievalText.trim()
  if (!detail || !retrievalText) {
    return false
  }

  const result = getMemoryRawSqlite().prepare(`
    UPDATE memories
    SET
      layer = ?,
      display_summary = ?,
      retrieval_text = ?,
      retrieval_embedding = ?,
      retrieval_model = ?,
      importance = ?,
      observed_start_at = ?,
      observed_end_at = ?
    WHERE agent_id = ? AND id = ?
  `).run(
    normalizeLayer(input.layer),
    detail,
    retrievalText,
    JSON.stringify(input.retrievalEmbedding.filter((value) => typeof value === 'number' && Number.isFinite(value))),
    input.retrievalModel.trim(),
    normalizeImportance(input.importance),
    input.observedStartAt?.getTime() ?? null,
    input.observedEndAt?.getTime() ?? null,
    input.agentId,
    input.memoryId,
  )

  return result.changes > 0
}

export function findRelevantMemories(input: {
  agentId: string
  queryEmbeddings: number[][]
  queryWeights?: number[]
  topK: number
  minSimilarity?: number
  layers?: MemoryLayer[]
  timeRange?: {
    start: Date
    end: Date
  } | null
}) {
  const hasTimeRange = !!input.timeRange
  const isPureTimeRecall = hasTimeRange && input.queryEmbeddings.length === 0
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
  const queryEmbeddings = weightedQueries.map(({ embedding }) => embedding)
  const queryWeights = weightedQueries.map(({ weight }) => weight)
  const conditions = ['agent_id = ?']
  const values: unknown[] = [input.agentId]
  const normalizedLayers = Array.isArray(input.layers)
    ? [...new Set(input.layers.map((layer) => normalizeLayer(layer)))]
    : []

  if (normalizedLayers.length > 0) {
    conditions.push(`layer IN (${normalizedLayers.map(() => '?').join(', ')})`)
    values.push(...normalizedLayers)
  }

  if (input.timeRange) {
    conditions.push(`(
      (
        layer = 'short_term'
        AND observed_start_at IS NOT NULL
        AND observed_end_at IS NOT NULL
        AND observed_start_at <= ?
        AND observed_end_at >= ?
      )
      OR (
        layer != 'short_term'
        AND created_at >= ?
        AND created_at <= ?
      )
    )`)
    values.push(
      input.timeRange.end.getTime(),
      input.timeRange.start.getTime(),
      input.timeRange.start.getTime(),
      input.timeRange.end.getTime(),
    )
  }

  if (queryEmbeddings.length === 0 && !input.timeRange) {
    return []
  }

  const candidates = selectMemories(`WHERE ${conditions.join(' AND ')}`, ...values)

  const minSimilarity = typeof input.minSimilarity === 'number' && Number.isFinite(input.minSimilarity)
    ? Math.min(1, Math.max(0, input.minSimilarity))
    : MIN_SEMANTIC_SIMILARITY

  return candidates
    .map((memory) => ({
      memory,
      similarity: queryEmbeddings.length > 0
        ? (() => {
          const totalWeight = queryWeights.reduce((sum, weight) => sum + weight, 0)
          if (totalWeight <= 0) {
            return Math.max(...queryEmbeddings.map((queryEmbedding) => cosineSimilarity(queryEmbedding, memory.retrievalEmbedding)))
          }

          let weightedSimilarity = 0
          for (let index = 0; index < queryEmbeddings.length; index += 1) {
            weightedSimilarity += cosineSimilarity(queryEmbeddings[index]!, memory.retrievalEmbedding) * queryWeights[index]!
          }
          return weightedSimilarity / totalWeight
        })()
        : 0,
    }))
    .filter(({ similarity }) => (
      isPureTimeRecall
      || similarity >= minSimilarity
    ))
    .sort((left, right) => {
      if (isPureTimeRecall) {
        const memoryTimeDelta = getMemoryTimeSortValue(right.memory) - getMemoryTimeSortValue(left.memory)
        if (memoryTimeDelta !== 0) {
          return memoryTimeDelta
        }
        if (right.memory.importance !== left.memory.importance) {
          return right.memory.importance - left.memory.importance
        }
        return right.similarity - left.similarity
      }
      if (right.similarity !== left.similarity) {
        return right.similarity - left.similarity
      }
      if (right.memory.importance !== left.memory.importance) {
        return right.memory.importance - left.memory.importance
      }
      return right.memory.createdAt.getTime() - left.memory.createdAt.getTime()
    })
    .slice(0, input.topK)
    .map(({ memory }) => memory)
}

function getMemoryTimeSortValue(memory: MemoryRecord) {
  if (memory.layer === 'short_term') {
    return memory.observedEndAt?.getTime() ?? memory.createdAt.getTime()
  }
  return memory.createdAt.getTime()
}

function normalizeImportance(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
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
