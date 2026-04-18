import { and, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb } from '../client'
import { emotionStates } from '../schema'

export interface EmotionStateVector {
  mood: number
  energy: number
  stress: number
}

interface EmotionStateRow {
  id: string
  agentId: string
  sessionId: string
  state: EmotionStateVector
  delta: EmotionStateVector | null
  trigger: string | null
  createdAt: Date
}

function parseState(value: string | null): EmotionStateVector | null {
  if (!value) {
    return null
  }

  return JSON.parse(value) as EmotionStateVector
}

function mapEmotionState(row: typeof emotionStates.$inferSelect): EmotionStateRow {
  return {
    ...row,
    state: parseState(row.state)!,
    delta: parseState(row.delta),
  }
}

export function addEmotionState(data: {
  agentId: string
  sessionId: string
  state: EmotionStateVector
  delta: EmotionStateVector | null
  trigger: string | null
}) {
  const db = getDb()
  const id = randomUUID()

  db.insert(emotionStates)
    .values({
      id,
      agentId: data.agentId,
      sessionId: data.sessionId,
      state: JSON.stringify(data.state),
      delta: data.delta ? JSON.stringify(data.delta) : null,
      trigger: data.trigger,
    })
    .run()

  return getEmotionState(id)!
}

export function getEmotionState(id: string) {
  const db = getDb()
  const row = db.select().from(emotionStates).where(eq(emotionStates.id, id)).get()
  return row ? mapEmotionState(row) : undefined
}

export function getLatestEmotionState(agentId: string, sessionId: string) {
  const db = getDb()
  const row = db.select()
    .from(emotionStates)
    .where(and(
      eq(emotionStates.agentId, agentId),
      eq(emotionStates.sessionId, sessionId),
    ))
    .orderBy(desc(emotionStates.createdAt), desc(emotionStates.id))
    .get()

  return row ? mapEmotionState(row) : undefined
}

export function getLatestEmotionStateBySession(sessionId: string) {
  const db = getDb()
  const row = db.select()
    .from(emotionStates)
    .where(eq(emotionStates.sessionId, sessionId))
    .orderBy(desc(emotionStates.createdAt), desc(emotionStates.id))
    .get()

  return row ? mapEmotionState(row) : undefined
}
