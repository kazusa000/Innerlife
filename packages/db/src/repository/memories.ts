import { and, desc, eq, or, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb } from '../client'
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
