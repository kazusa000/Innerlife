import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb } from '../client'
import { relationships } from '../schema'

export interface RelationshipDimensions {
  trust: number
  affinity: number
  familiarity: number
  respect: number
}

export interface RelationshipHistoryEntry {
  summary: string
  trigger: string | null
  delta: RelationshipDimensions
  createdAt: string
}

export interface RelationshipRecord {
  id: string
  agentId: string
  counterpartType: 'user' | 'agent'
  counterpartId: string
  dimensions: RelationshipDimensions
  history: RelationshipHistoryEntry[]
  updatedAt: Date
}

function clampUnit(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(1, Math.max(0, value))
}

function clampSigned(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }

  return Math.min(1, Math.max(-1, value))
}

function normalizeDimensions(
  value: Partial<RelationshipDimensions> | null | undefined,
): RelationshipDimensions {
  return {
    trust: clampUnit(value?.trust),
    affinity: clampUnit(value?.affinity),
    familiarity: clampUnit(value?.familiarity),
    respect: clampUnit(value?.respect),
  }
}

function parseDimensions(value: string): RelationshipDimensions {
  try {
    return normalizeDimensions(JSON.parse(value) as Partial<RelationshipDimensions>)
  } catch {
    return normalizeDimensions(undefined)
  }
}

function parseHistory(value: string): RelationshipHistoryEntry[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return []
      }

      const record = entry as Record<string, unknown>
      const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : ''
      if (!summary || !createdAt) {
        return []
      }

      return [{
        summary,
        trigger:
          typeof record.trigger === 'string' && record.trigger.trim()
            ? record.trigger.trim()
            : null,
        delta: {
          trust: clampSigned((record.delta as Partial<RelationshipDimensions> | undefined)?.trust),
          affinity: clampSigned((record.delta as Partial<RelationshipDimensions> | undefined)?.affinity),
          familiarity: clampSigned((record.delta as Partial<RelationshipDimensions> | undefined)?.familiarity),
          respect: clampSigned((record.delta as Partial<RelationshipDimensions> | undefined)?.respect),
        },
        createdAt,
      }]
    })
  } catch {
    return []
  }
}

function mapRelationship(row: typeof relationships.$inferSelect): RelationshipRecord {
  return {
    ...row,
    counterpartType: row.counterpartType as 'user' | 'agent',
    dimensions: parseDimensions(row.dimensions),
    history: parseHistory(row.history),
  }
}

export function getRelationship(
  agentId: string,
  counterpartType: 'user' | 'agent',
  counterpartId: string,
) {
  const db = getDb()
  const row = db.select()
    .from(relationships)
    .where(and(
      eq(relationships.agentId, agentId),
      eq(relationships.counterpartType, counterpartType),
      eq(relationships.counterpartId, counterpartId),
    ))
    .get()

  return row ? mapRelationship(row) : undefined
}

export function getRelationshipById(id: string) {
  const db = getDb()
  const row = db.select().from(relationships).where(eq(relationships.id, id)).get()
  return row ? mapRelationship(row) : undefined
}

export function listRelationshipHistory(relationshipId: string) {
  return getRelationshipById(relationshipId)?.history ?? []
}

export function upsertRelationship(data: {
  agentId: string
  counterpartType: 'user' | 'agent'
  counterpartId: string
  dimensions: RelationshipDimensions
  history: RelationshipHistoryEntry[]
  updatedAt?: Date
}) {
  const db = getDb()
  const existing = getRelationship(data.agentId, data.counterpartType, data.counterpartId)
  const payload = {
    agentId: data.agentId,
    counterpartType: data.counterpartType,
    counterpartId: data.counterpartId,
    dimensions: JSON.stringify(normalizeDimensions(data.dimensions)),
    history: JSON.stringify(parseHistory(JSON.stringify(data.history))),
    updatedAt: data.updatedAt ?? new Date(),
  }

  if (existing) {
    db.update(relationships)
      .set(payload)
      .where(eq(relationships.id, existing.id))
      .run()
    return getRelationshipById(existing.id)!
  }

  const id = randomUUID()
  db.insert(relationships)
    .values({
      id,
      ...payload,
    })
    .run()

  return getRelationshipById(id)!
}
