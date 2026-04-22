import { desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb } from '../client'
import { relationshipCounterparts } from '../schema'

export interface RelationshipCounterpartRecord {
  id: string
  agentId: string
  name: string
  createdAt: Date
  updatedAt: Date
}

function mapCounterpart(row: typeof relationshipCounterparts.$inferSelect): RelationshipCounterpartRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function normalizeName(value: string) {
  return value.trim()
}

export function createRelationshipCounterpart(data: {
  agentId: string
  name: string
}) {
  const db = getDb()
  const name = normalizeName(data.name)
  const now = new Date()
  const id = randomUUID()
  db.insert(relationshipCounterparts).values({
    id,
    agentId: data.agentId,
    name,
    createdAt: now,
    updatedAt: now,
  }).run()
  return getRelationshipCounterpart(id)!
}

export function getRelationshipCounterpart(id: string) {
  const db = getDb()
  const row = db.select()
    .from(relationshipCounterparts)
    .where(eq(relationshipCounterparts.id, id))
    .get()
  return row ? mapCounterpart(row) : undefined
}

export function listRelationshipCounterpartsByAgent(agentId: string) {
  const db = getDb()
  return db.select()
    .from(relationshipCounterparts)
    .where(eq(relationshipCounterparts.agentId, agentId))
    .orderBy(desc(relationshipCounterparts.updatedAt))
    .all()
    .map(mapCounterpart)
}

export function updateRelationshipCounterpart(id: string, data: { name?: string }) {
  const existing = getRelationshipCounterpart(id)
  if (!existing) {
    return undefined
  }

  const db = getDb()
  db.update(relationshipCounterparts)
    .set({
      ...(data.name !== undefined ? { name: normalizeName(data.name) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(relationshipCounterparts.id, id))
    .run()
  return getRelationshipCounterpart(id)!
}

export function deleteRelationshipCounterpart(id: string) {
  const db = getDb()
  db.delete(relationshipCounterparts).where(eq(relationshipCounterparts.id, id)).run()
}

export function deleteRelationshipCounterpartsByAgent(agentId: string) {
  const db = getDb()
  db.delete(relationshipCounterparts).where(eq(relationshipCounterparts.agentId, agentId)).run()
}
