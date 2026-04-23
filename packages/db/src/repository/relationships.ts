import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb } from '../client'
import { relationships } from '../schema'

export type RelationshipCounterpartType = 'user' | 'named'

export interface RelationshipDimensions {
  trust: number
  affinity: number
  familiarity: number
  respect: number
}

export interface RelationshipHistoryEntry {
  summary: string
  trigger: string | null
  delta: {
    trust: number
    affinity: number
    familiarity: number
    respect: number
  }
  createdAt: string
}

export interface RelationshipRecord {
  id: string
  agentId: string
  counterpartType: RelationshipCounterpartType
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
      const deltaRecord = record.delta && typeof record.delta === 'object'
        ? record.delta as Record<string, unknown>
        : {}
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
          trust: clampSigned(deltaRecord.trust),
          affinity: clampSigned(deltaRecord.affinity),
          familiarity: clampSigned(deltaRecord.familiarity),
          respect: clampSigned(deltaRecord.respect),
        },
        createdAt,
      }]
    })
  } catch {
    return []
  }
}

function serializeHistory(history: RelationshipHistoryEntry[]) {
  return JSON.stringify(
    history.map((entry) => ({
      summary: entry.summary,
      trigger: entry.trigger,
      delta: {
        trust: clampSigned(entry.delta.trust),
        affinity: clampSigned(entry.delta.affinity),
        familiarity: clampSigned(entry.delta.familiarity),
        respect: clampSigned(entry.delta.respect),
      },
      createdAt: entry.createdAt,
    })),
  )
}

function mapRelationship(row: typeof relationships.$inferSelect): RelationshipRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    counterpartType: row.counterpartType,
    counterpartId: row.counterpartId,
    dimensions: parseDimensions(row.dimensions),
    history: parseHistory(row.history),
    updatedAt: row.updatedAt,
  }
}

export function getRelationship(
  agentId: string,
  counterpartId: string,
  counterpartType: RelationshipCounterpartType = 'user',
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

export function listRelationshipHistory(relationshipId: string) {
  const db = getDb()
  const row = db.select().from(relationships).where(eq(relationships.id, relationshipId)).get()
  return row ? mapRelationship(row).history : []
}

export function upsertRelationship(data: {
  agentId: string
  counterpartId: string
  counterpartType?: RelationshipCounterpartType
  dimensions: RelationshipDimensions
  history: RelationshipHistoryEntry[]
  updatedAt?: Date
}) {
  const db = getDb()
  const counterpartType = data.counterpartType ?? 'user'
  const existing = getRelationship(data.agentId, data.counterpartId, counterpartType)
  const payload = {
    agentId: data.agentId,
    counterpartType,
    counterpartId: data.counterpartId,
    dimensions: JSON.stringify(normalizeDimensions(data.dimensions)),
    history: serializeHistory(data.history),
    updatedAt: data.updatedAt ?? new Date(),
  }

  if (existing) {
    db.update(relationships)
      .set(payload)
      .where(eq(relationships.id, existing.id))
      .run()
    return getRelationship(data.agentId, data.counterpartId, counterpartType)!
  }

  db.insert(relationships)
    .values({
      id: randomUUID(),
      ...payload,
    })
    .run()

  return getRelationship(data.agentId, data.counterpartId, counterpartType)!
}

export function deleteRelationshipsByAgent(agentId: string) {
  const db = getDb()
  db.delete(relationships).where(eq(relationships.agentId, agentId)).run()
}

export function deleteRelationshipsByCounterpart(
  agentId: string,
  counterpartId: string,
  counterpartType: RelationshipCounterpartType = 'user',
) {
  const db = getDb()
  db.delete(relationships)
    .where(and(
      eq(relationships.agentId, agentId),
      eq(relationships.counterpartType, counterpartType),
      eq(relationships.counterpartId, counterpartId),
    ))
    .run()
}
