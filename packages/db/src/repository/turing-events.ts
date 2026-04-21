import { asc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb } from '../client'
import { turingTestEvents } from '../schema'

export interface TuringEventRecord {
  id: string
  runId: string
  kind: string
  message: string
  payload: Record<string, unknown> | null
  createdAt: Date
}

function parsePayload(value: string | null) {
  if (!value) {
    return null
  }
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function mapEvent(row: typeof turingTestEvents.$inferSelect): TuringEventRecord {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind,
    message: row.message,
    payload: parsePayload(row.payloadJson),
    createdAt: row.createdAt,
  }
}

export function appendEvent(input: {
  runId: string
  kind: string
  message: string
  payload?: Record<string, unknown> | null
}) {
  const db = getDb()
  const id = randomUUID()
  db.insert(turingTestEvents)
    .values({
      id,
      runId: input.runId,
      kind: input.kind,
      message: input.message,
      payloadJson: input.payload ? JSON.stringify(input.payload) : null,
    })
    .run()
  return getEvent(id)!
}

export function getEvent(id: string) {
  const db = getDb()
  const row = db.select().from(turingTestEvents).where(eq(turingTestEvents.id, id)).get()
  return row ? mapEvent(row) : undefined
}

export function listEvents(runId: string) {
  const db = getDb()
  return db.select()
    .from(turingTestEvents)
    .where(eq(turingTestEvents.runId, runId))
    .orderBy(asc(turingTestEvents.createdAt), asc(turingTestEvents.id))
    .all()
    .map(mapEvent)
}

export function deleteEvents(runId: string) {
  const db = getDb()
  db.delete(turingTestEvents).where(eq(turingTestEvents.runId, runId)).run()
}
