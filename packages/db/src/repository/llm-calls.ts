import { eq, and, asc } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb } from '../client'
import { llmCalls, messages } from '../schema'

export interface StartCallInput {
  kind: 'turn' | 'compaction' | 'memory' | 'emotion' | 'relationship'
  sessionId: string
  userMessageId: string
  turnIndex: number
  model: string
  systemPrompt: string
  toolsJson: string
  messagesJson: string
  metadataJson?: string
}

export interface FinishCallInput {
  metadataJson?: string
  responseJson?: string
  stopReason?: string
  inputTokens?: number
  outputTokens?: number
  error?: string
}

export function startCall(input: StartCallInput): string {
  const db = getDb()
  const id = randomUUID()
  db.insert(llmCalls)
    .values({ id, ...input, startedAt: new Date() })
    .run()
  return id
}

export function finishCall(id: string, input: FinishCallInput): void {
  const db = getDb()
  db.update(llmCalls)
    .set({ ...input, finishedAt: new Date() })
    .where(eq(llmCalls.id, id))
    .run()
}

export function listCallsBySession(sessionId: string) {
  const db = getDb()
  return db
    .select()
    .from(llmCalls)
    .where(eq(llmCalls.sessionId, sessionId))
    .orderBy(asc(llmCalls.startedAt))
    .all()
}

export function getCall(id: string) {
  const db = getDb()
  return db.select().from(llmCalls).where(eq(llmCalls.id, id)).get()
}

export function clearAllCalls(): void {
  const db = getDb()
  db.delete(llmCalls).run()
}

export function deleteCallsBySession(sessionId: string): void {
  const db = getDb()
  db.delete(llmCalls).where(eq(llmCalls.sessionId, sessionId)).run()
}

export interface TurnNode {
  userMessageId: string
  userText: string
  createdAt: number
  calls: Array<{
    id: string
    turnIndex: number
    kind: 'turn' | 'compaction' | 'memory' | 'emotion' | 'relationship'
    stopReason: string | null
    startedAt: number
    finishedAt: number | null
  }>
}

export function getSessionTurnTree(sessionId: string): TurnNode[] {
  const db = getDb()
  const userMsgs = db
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
    .orderBy(asc(messages.createdAt))
    .all()

  const allCalls = db
    .select()
    .from(llmCalls)
    .where(eq(llmCalls.sessionId, sessionId))
    .orderBy(asc(llmCalls.startedAt))
    .all()

  return userMsgs.map((m) => {
    let userText = m.content
    try {
      const blocks = JSON.parse(m.content) as Array<{ type: string; text?: string }>
      userText = blocks
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('')
    } catch {
      // fall back to raw content
    }
    const calls = allCalls
      .filter((c) => c.userMessageId === m.id)
      .map((c) => ({
        id: c.id,
        turnIndex: c.turnIndex,
        kind: c.kind ?? 'turn',
        stopReason: c.stopReason,
        startedAt: c.startedAt.getTime(),
        finishedAt: c.finishedAt ? c.finishedAt.getTime() : null,
      }))
    return {
      userMessageId: m.id,
      userText,
      createdAt: m.createdAt.getTime(),
      calls,
    }
  })
}
