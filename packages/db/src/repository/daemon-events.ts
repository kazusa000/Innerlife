import { desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb } from '../client'
import { daemonEvents } from '../schema'

export type DaemonEventScope = 'daemon' | 'memory_flush' | 'memory_sleep'

export interface DaemonEventRecord {
  id: string
  kind: string
  scope: DaemonEventScope
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

function mapEvent(row: typeof daemonEvents.$inferSelect): DaemonEventRecord {
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    message: row.message,
    payload: parsePayload(row.payloadJson),
    createdAt: row.createdAt,
  }
}

export function appendEvent(input: {
  kind: string
  scope: DaemonEventScope
  message: string
  payload?: Record<string, unknown> | null
  createdAt?: Date
}) {
  const db = getDb()
  const id = randomUUID()

  db.insert(daemonEvents)
    .values({
      id,
      kind: input.kind,
      scope: input.scope,
      message: input.message,
      payloadJson: input.payload ? JSON.stringify(input.payload) : null,
      createdAt: input.createdAt ?? new Date(),
    })
    .run()

  return getEvent(id)!
}

export function getEvent(id: string) {
  const db = getDb()
  const row = db.select().from(daemonEvents).where(eq(daemonEvents.id, id)).get()
  return row ? mapEvent(row) : undefined
}

export function listEvents(input: {
  limit?: number
  scope?: DaemonEventScope
} = {}) {
  const db = getDb()
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 20)))

  const query = db.select().from(daemonEvents)
  const rows = input.scope
    ? query
      .where(eq(daemonEvents.scope, input.scope))
      .orderBy(desc(daemonEvents.createdAt), desc(daemonEvents.id))
      .limit(limit)
      .all()
    : query
      .orderBy(desc(daemonEvents.createdAt), desc(daemonEvents.id))
      .limit(limit)
      .all()

  return rows.map(mapEvent)
}

export function deleteEvents(input: {
  scope?: DaemonEventScope
}) {
  const db = getDb()
  if (input.scope) {
    db.delete(daemonEvents).where(eq(daemonEvents.scope, input.scope)).run()
    return
  }
  db.delete(daemonEvents).run()
}
