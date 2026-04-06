import { eq } from 'drizzle-orm'
import { getDb } from '../client.js'
import { sessions } from '../schema.js'
import { randomUUID } from 'node:crypto'

export function createSession(agentId: string, title?: string) {
  const db = getDb()
  const id = randomUUID()
  db.insert(sessions).values({ id, agentId, title }).run()
  return db.select().from(sessions).where(eq(sessions.id, id)).get()!
}

export function getSession(id: string) {
  const db = getDb()
  return db.select().from(sessions).where(eq(sessions.id, id)).get()
}

export function listSessionsByAgent(agentId: string) {
  const db = getDb()
  return db.select().from(sessions).where(eq(sessions.agentId, agentId)).all()
}
