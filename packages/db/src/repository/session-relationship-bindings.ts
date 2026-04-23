import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { sessionRelationshipBindings } from '../schema'

export interface SessionRelationshipBindingRecord {
  sessionId: string
  counterpartId: string
  updatedAt: Date
}

function mapBinding(row: typeof sessionRelationshipBindings.$inferSelect): SessionRelationshipBindingRecord {
  return {
    sessionId: row.sessionId,
    counterpartId: row.counterpartId,
    updatedAt: row.updatedAt,
  }
}

export function getSessionRelationshipBinding(sessionId: string) {
  const db = getDb()
  const row = db.select()
    .from(sessionRelationshipBindings)
    .where(eq(sessionRelationshipBindings.sessionId, sessionId))
    .get()
  return row ? mapBinding(row) : undefined
}

export function bindSessionRelationshipCounterpart(input: {
  sessionId: string
  counterpartId: string
}) {
  const db = getDb()
  const existing = getSessionRelationshipBinding(input.sessionId)
  const payload = {
    sessionId: input.sessionId,
    counterpartId: input.counterpartId,
    updatedAt: new Date(),
  }
  if (existing) {
    db.update(sessionRelationshipBindings)
      .set(payload)
      .where(eq(sessionRelationshipBindings.sessionId, input.sessionId))
      .run()
  } else {
    db.insert(sessionRelationshipBindings)
      .values(payload)
      .run()
  }
  return getSessionRelationshipBinding(input.sessionId)!
}

export function unbindSessionRelationshipCounterpart(sessionId: string) {
  const db = getDb()
  db.delete(sessionRelationshipBindings).where(eq(sessionRelationshipBindings.sessionId, sessionId)).run()
}

export function deleteSessionRelationshipBindingsByCounterpart(counterpartId: string) {
  const db = getDb()
  db.delete(sessionRelationshipBindings)
    .where(eq(sessionRelationshipBindings.counterpartId, counterpartId))
    .run()
}
