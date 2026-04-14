import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { messages, toolExecutions } from '../schema'
import { randomUUID } from 'node:crypto'

export function addMessage(data: {
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tokenCount?: number
}) {
  const db = getDb()
  const id = randomUUID()
  db.insert(messages).values({ id, ...data }).run()
  return id
}

export function getSessionMessages(sessionId: string) {
  const db = getDb()
  return db.select().from(messages).where(eq(messages.sessionId, sessionId)).all()
}

export function addToolExecution(data: {
  messageId: string
  toolName: string
  input: string
  output: string
  isError: boolean
  durationMs: number
}) {
  const db = getDb()
  const id = randomUUID()
  db.insert(toolExecutions).values({ id, ...data }).run()
}

export function deleteSessionMessages(sessionId: string) {
  const db = getDb()
  const msgs = db.select({ id: messages.id }).from(messages).where(eq(messages.sessionId, sessionId)).all()
  for (const msg of msgs) {
    db.delete(toolExecutions).where(eq(toolExecutions.messageId, msg.id)).run()
  }
  db.delete(messages).where(eq(messages.sessionId, sessionId)).run()
}
