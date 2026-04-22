import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { sessionContextState } from '../schema'

export interface SessionContextStateRecord {
  sessionId: string
  activeStartMessageId: string | null
  pendingFlushUntilMessageId: string | null
  lastUserMessageAt: Date | null
  lastContextFlushAt: Date | null
  updatedAt: Date
}

function mapState(row: typeof sessionContextState.$inferSelect): SessionContextStateRecord {
  return {
    sessionId: row.sessionId,
    activeStartMessageId: row.activeStartMessageId,
    pendingFlushUntilMessageId: row.pendingFlushUntilMessageId,
    lastUserMessageAt: row.lastUserMessageAt,
    lastContextFlushAt: row.lastContextFlushAt,
    updatedAt: row.updatedAt,
  }
}

export function getSessionContextState(sessionId: string) {
  const db = getDb()
  const row = db
    .select()
    .from(sessionContextState)
    .where(eq(sessionContextState.sessionId, sessionId))
    .get()

  return row ? mapState(row) : undefined
}

export function upsertSessionContextState(input: {
  sessionId: string
  activeStartMessageId?: string | null
  pendingFlushUntilMessageId?: string | null
  lastUserMessageAt?: Date | null
  lastContextFlushAt?: Date | null
}) {
  const db = getDb()
  const existing = getSessionContextState(input.sessionId)
  const next = {
    sessionId: input.sessionId,
    activeStartMessageId:
      input.activeStartMessageId !== undefined
        ? input.activeStartMessageId
        : existing?.activeStartMessageId ?? null,
    pendingFlushUntilMessageId:
      input.pendingFlushUntilMessageId !== undefined
        ? input.pendingFlushUntilMessageId
        : existing?.pendingFlushUntilMessageId ?? null,
    lastUserMessageAt:
      input.lastUserMessageAt !== undefined
        ? input.lastUserMessageAt
        : existing?.lastUserMessageAt ?? null,
    lastContextFlushAt:
      input.lastContextFlushAt !== undefined
        ? input.lastContextFlushAt
        : existing?.lastContextFlushAt ?? null,
    updatedAt: new Date(),
  }

  db.insert(sessionContextState)
    .values(next)
    .onConflictDoUpdate({
      target: sessionContextState.sessionId,
      set: {
        activeStartMessageId: next.activeStartMessageId,
        pendingFlushUntilMessageId: next.pendingFlushUntilMessageId,
        lastUserMessageAt: next.lastUserMessageAt,
        lastContextFlushAt: next.lastContextFlushAt,
        updatedAt: next.updatedAt,
      },
    })
    .run()

  return getSessionContextState(input.sessionId)!
}

export function recordUserContextActivity(input: {
  sessionId: string
  userMessageId: string
  at?: Date
}) {
  const existing = getSessionContextState(input.sessionId)
  const at = input.at ?? new Date()
  return upsertSessionContextState({
    sessionId: input.sessionId,
    activeStartMessageId: existing?.activeStartMessageId ?? input.userMessageId,
    pendingFlushUntilMessageId: existing?.pendingFlushUntilMessageId ?? null,
    lastUserMessageAt: at,
  })
}

export function recordContextFlush(input: {
  sessionId: string
  nextActiveStartMessageId: string | null
  pendingFlushUntilMessageId?: string | null
  at?: Date
}) {
  return upsertSessionContextState({
    sessionId: input.sessionId,
    activeStartMessageId: input.nextActiveStartMessageId,
    pendingFlushUntilMessageId:
      input.pendingFlushUntilMessageId !== undefined
        ? input.pendingFlushUntilMessageId
        : null,
    lastContextFlushAt: input.at ?? new Date(),
  })
}

export function deleteSessionContextState(sessionId: string) {
  const db = getDb()
  db.delete(sessionContextState)
    .where(eq(sessionContextState.sessionId, sessionId))
    .run()
}
