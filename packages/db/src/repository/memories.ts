import { randomUUID } from 'node:crypto'
import { getMemoryRawSqlite } from '../memory-client'

export interface MemoryRecord {
  id: string
  agentId: string
  sessionId: string
  sourceText: string
  displaySummary: string
  retrievalText: string
  retrievalEmbedding: number[]
  retrievalModel: string
  tags: string[]
  importance: number
  createdAt: Date
}

export interface MemoryConsolidationKeepAction {
  op: 'keep'
  id: string
}

export interface MemoryConsolidationRewriteAction {
  op: 'rewrite'
  id: string
  displaySummary: string
  retrievalText: string
  retrievalEmbedding?: number[]
  retrievalModel?: string | null
  tags: string[]
  importance: number
}

export interface MemoryConsolidationMergeAction {
  op: 'merge'
  sourceIds: string[]
  displaySummary: string
  retrievalText: string
  retrievalEmbedding?: number[]
  retrievalModel?: string | null
  tags: string[]
  importance: number
}

export type MemoryConsolidationAction =
  | MemoryConsolidationKeepAction
  | MemoryConsolidationRewriteAction
  | MemoryConsolidationMergeAction

export interface MemoryConsolidationReport {
  before: number
  after: number
  kept: number
  rewritten: number
  merged: number
}

type MemoryRow = {
  id: string
  agent_id: string
  session_id: string
  source_text: string
  display_summary: string
  retrieval_text: string
  retrieval_embedding: string
  retrieval_model: string
  tags: string
  importance: number
  created_at: number
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(
    tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean),
  )]
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
    sourceText: row.source_text,
    displaySummary: row.display_summary,
    retrievalText: row.retrieval_text,
    retrievalEmbedding: parseEmbedding(row.retrieval_embedding),
    retrievalModel: row.retrieval_model,
    tags: parseTags(row.tags),
    importance: row.importance,
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
      source_text,
      display_summary,
      retrieval_text,
      retrieval_embedding,
      retrieval_model,
      tags,
      importance,
      created_at
    FROM memories
    ${whereSql}
  `).all(...values).map((row) => mapMemory(row as MemoryRow))
}

export function addMemory(data: {
  agentId: string
  sessionId: string
  sourceText: string
  displaySummary: string
  retrievalText: string
  retrievalEmbedding: number[]
  retrievalModel: string
  tags: string[]
  importance: number
  createdAt?: Date
}) {
  const sqlite = getMemoryRawSqlite()
  const id = randomUUID()

  sqlite.prepare(`
    INSERT INTO memories (
      id,
      agent_id,
      session_id,
      source_text,
      display_summary,
      retrieval_text,
      retrieval_embedding,
      retrieval_model,
      tags,
      importance,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.agentId,
    data.sessionId,
    data.sourceText,
    data.displaySummary.trim(),
    data.retrievalText.trim(),
    JSON.stringify(data.retrievalEmbedding),
    data.retrievalModel,
    JSON.stringify(normalizeTags(data.tags)),
    normalizeImportance(data.importance),
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
         OR lower(tags) LIKE ?
       )
     ORDER BY created_at DESC`,
    agentId,
    wildcard,
    wildcard,
  )
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

export function findRelevantMemories(input: {
  agentId: string
  queryEmbeddings: number[][]
  topK: number
  timeRange?: {
    start: Date
    end: Date
  } | null
}) {
  const hasTimeRange = !!input.timeRange
  const queryEmbeddings = input.queryEmbeddings
    .filter((embedding): embedding is number[] => Array.isArray(embedding) && embedding.length > 0)
    .map((embedding) => embedding.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))
    .filter((embedding) => embedding.length > 0)
  const conditions = ['agent_id = ?']
  const values: unknown[] = [input.agentId]

  if (input.timeRange) {
    conditions.push('created_at >= ?')
    conditions.push('created_at <= ?')
    values.push(input.timeRange.start.getTime(), input.timeRange.end.getTime())
  }

  if (queryEmbeddings.length === 0 && !input.timeRange) {
    return []
  }

  const candidates = selectMemories(`WHERE ${conditions.join(' AND ')}`, ...values)

  return candidates
    .map((memory) => ({
      memory,
      similarity: queryEmbeddings.length > 0
        ? Math.max(...queryEmbeddings.map((queryEmbedding) => cosineSimilarity(queryEmbedding, memory.retrievalEmbedding)))
        : 0,
    }))
    .filter(({ similarity }) => hasTimeRange || queryEmbeddings.length === 0 || similarity > 0)
    .sort((left, right) => {
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

function normalizeImportance(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
}

function requireMemory(byId: Map<string, MemoryRecord>, id: string, agentId: string): MemoryRecord {
  const memory = byId.get(id)
  if (!memory) {
    throw new Error(`Memory ${id} was not found for agent ${agentId}`)
  }
  return memory
}

export function applyConsolidationPlan(input: {
  agentId: string
  actions: MemoryConsolidationAction[]
}): MemoryConsolidationReport {
  const sqlite = getMemoryRawSqlite()

  const transaction = sqlite.transaction((payload: typeof input): MemoryConsolidationReport => {
    const existing = listMemoriesByAgentOldestFirst(payload.agentId)
    const byId = new Map(existing.map((memory) => [memory.id, memory]))
    const consumedIds = new Set<string>()
    let kept = 0
    let rewritten = 0
    let merged = 0
    let after = existing.length

    for (const action of payload.actions) {
      if (action.op === 'keep') {
        requireMemory(byId, action.id, payload.agentId)
        if (consumedIds.has(action.id)) {
          throw new Error(`Memory ${action.id} was referenced more than once`)
        }
        consumedIds.add(action.id)
        kept += 1
        continue
      }

      if (action.op === 'rewrite') {
        const existingMemory = requireMemory(byId, action.id, payload.agentId)
        if (consumedIds.has(action.id)) {
          throw new Error(`Memory ${action.id} was referenced more than once`)
        }
        consumedIds.add(action.id)
        sqlite.prepare(`
          UPDATE memories
          SET display_summary = ?, retrieval_text = ?, retrieval_embedding = ?, retrieval_model = ?, tags = ?, importance = ?
          WHERE id = ?
        `).run(
          action.displaySummary.trim(),
          action.retrievalText.trim(),
          JSON.stringify(action.retrievalEmbedding ?? existingMemory.retrievalEmbedding),
          action.retrievalModel ?? existingMemory.retrievalModel,
          JSON.stringify(normalizeTags(action.tags)),
          normalizeImportance(action.importance),
          action.id,
        )
        rewritten += 1
        continue
      }

      const sourceIds = [...new Set(action.sourceIds.map((id) => id.trim()).filter(Boolean))]
      if (sourceIds.length < 2) {
        throw new Error('Merge actions require at least 2 source ids')
      }

      const sourceRecords = sourceIds.map((id) => requireMemory(byId, id, payload.agentId))
      for (const id of sourceIds) {
        if (consumedIds.has(id)) {
          throw new Error(`Memory ${id} was referenced more than once`)
        }
      }
      for (const id of sourceIds) {
        consumedIds.add(id)
      }

      const oldest = sourceRecords.reduce((currentOldest, candidate) =>
        candidate.createdAt.getTime() < currentOldest.createdAt.getTime() ? candidate : currentOldest,
      )

      sqlite.prepare(`
        INSERT INTO memories (
          id,
          agent_id,
          session_id,
          source_text,
          display_summary,
          retrieval_text,
          retrieval_embedding,
          retrieval_model,
          tags,
          importance,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        payload.agentId,
        oldest.sessionId,
        sourceRecords.map((memory) => memory.sourceText).join('\n---\n'),
        action.displaySummary.trim(),
        action.retrievalText.trim(),
        JSON.stringify(action.retrievalEmbedding ?? averageEmbeddings(sourceRecords.map((memory) => memory.retrievalEmbedding))),
        action.retrievalModel ?? oldest.retrievalModel,
        JSON.stringify(normalizeTags(action.tags)),
        normalizeImportance(action.importance),
        oldest.createdAt.getTime(),
      )

      for (const id of sourceIds) {
        sqlite.prepare('DELETE FROM memories WHERE id = ?').run(id)
      }

      after = after - sourceIds.length + 1
      merged += 1
    }

    kept += existing.length - consumedIds.size

    return {
      before: existing.length,
      after,
      kept,
      rewritten,
      merged,
    }
  })

  return transaction(input)
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

function averageEmbeddings(embeddings: number[][]): number[] {
  const valid = embeddings.filter((embedding) => embedding.length > 0)
  if (valid.length === 0) {
    return []
  }

  const dimension = valid[0]!.length
  const totals = new Array<number>(dimension).fill(0)
  let count = 0

  for (const embedding of valid) {
    if (embedding.length !== dimension) {
      continue
    }
    count += 1
    for (let index = 0; index < dimension; index += 1) {
      totals[index] += embedding[index]!
    }
  }

  return count === 0 ? [] : totals.map((total) => total / count)
}
