import { and, asc, desc, eq, or, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb, getRawSqlite } from '../client'
import { memories } from '../schema'

export interface MemoryRecord {
  id: string
  agentId: string
  sessionId: string
  content: string
  summary: string
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
  summary: string
  tags: string[]
  importance: number
}

export interface MemoryConsolidationMergeAction {
  op: 'merge'
  sourceIds: string[]
  summary: string
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

function normalizeTags(tags: string[]): string[] {
  return [...new Set(
    tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map(tag => tag.trim())
      .filter(Boolean),
  )]
}

function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function mapMemory(row: typeof memories.$inferSelect): MemoryRecord {
  return {
    ...row,
    tags: parseTags(row.tags),
  }
}

export function addMemory(data: {
  agentId: string
  sessionId: string
  content: string
  summary: string
  tags: string[]
  importance: number
  createdAt?: Date
}) {
  const db = getDb()
  const id = randomUUID()

  db.insert(memories)
    .values({
      id,
      ...data,
      tags: JSON.stringify(normalizeTags(data.tags)),
      createdAt: data.createdAt ?? new Date(),
    })
    .run()

  return getMemory(id)!
}

export function getMemory(id: string) {
  const db = getDb()
  const memory = db.select().from(memories).where(eq(memories.id, id)).get()
  return memory ? mapMemory(memory) : undefined
}

export function listMemoriesByAgent(agentId: string) {
  const db = getDb()
  return db
    .select()
    .from(memories)
    .where(eq(memories.agentId, agentId))
    .orderBy(desc(memories.createdAt))
    .all()
    .map(mapMemory)
}

export function listSqliteMemoriesByAgent(agentId: string, query?: string) {
  const normalizedQuery = query?.trim().toLowerCase()
  const db = getDb()
  const scope = eq(memories.agentId, agentId)

  if (!normalizedQuery) {
    return db
      .select()
      .from(memories)
      .where(scope)
      .orderBy(desc(memories.createdAt))
      .all()
      .map(mapMemory)
  }

  const wildcard = `%${normalizedQuery}%`

  return db
    .select()
    .from(memories)
    .where(and(
      scope,
      or(
        sql`lower(${memories.summary}) like ${wildcard}`,
        sql`lower(${memories.tags}) like ${wildcard}`,
      )!,
    ))
    .orderBy(desc(memories.createdAt))
    .all()
    .map(mapMemory)
}

export function listMemoriesByAgentOldestFirst(agentId: string) {
  const db = getDb()
  return db
    .select()
    .from(memories)
    .where(eq(memories.agentId, agentId))
    .orderBy(asc(memories.createdAt))
    .all()
    .map(mapMemory)
}

export function deleteSqliteMemoryByAgent(agentId: string, memoryId: string) {
  const db = getDb()
  const result = db
    .delete(memories)
    .where(and(
      eq(memories.agentId, agentId),
      eq(memories.id, memoryId),
    ))
    .run()

  return result.changes > 0
}

export function findRelevantMemories(input: {
  agentId: string
  terms: string[]
  topK: number
}) {
  const normalizedTerms = [...new Set(
    input.terms
      .filter((term): term is string => typeof term === 'string')
      .map(term => term.trim().toLowerCase())
      .filter(Boolean),
  )]

  if (normalizedTerms.length === 0) {
    return []
  }

  const filters = normalizedTerms.map((term) =>
    sql`lower(${memories.tags}) like ${`%${term}%`}`,
  )
  const db = getDb()

  return db
    .select()
    .from(memories)
    .where(and(eq(memories.agentId, input.agentId), or(...filters)!))
    .orderBy(desc(memories.importance), desc(memories.createdAt))
    .limit(input.topK)
    .all()
    .map(mapMemory)
}

function normalizeImportance(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
}

function requireMemory(
  byId: Map<string, MemoryRecord>,
  id: string,
  agentId: string,
): MemoryRecord {
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
  const db = getDb()
  const sqlite = getRawSqlite()

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
        requireMemory(byId, action.id, payload.agentId)
        if (consumedIds.has(action.id)) {
          throw new Error(`Memory ${action.id} was referenced more than once`)
        }
        consumedIds.add(action.id)
        db.update(memories)
          .set({
            summary: action.summary.trim(),
            tags: JSON.stringify(normalizeTags(action.tags)),
            importance: normalizeImportance(action.importance),
          })
          .where(eq(memories.id, action.id))
          .run()
        rewritten += 1
        continue
      }

      const sourceIds = [...new Set(action.sourceIds.map(id => id.trim()).filter(Boolean))]
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
      const mergedId = randomUUID()

      db.insert(memories)
        .values({
          id: mergedId,
          agentId: payload.agentId,
          sessionId: oldest.sessionId,
          content: sourceRecords.map((memory) => memory.content).join('\n---\n'),
          summary: action.summary.trim(),
          tags: JSON.stringify(normalizeTags(action.tags)),
          importance: normalizeImportance(action.importance),
          createdAt: oldest.createdAt,
        })
        .run()

      for (const id of sourceIds) {
        db.delete(memories).where(eq(memories.id, id)).run()
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
