import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../client'
import { sessions } from '../schema'
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
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.agentId, agentId))
    .orderBy(desc(sessions.updatedAt))
    .all()
}

export function getLatestActiveSessionByAgent(agentId: string) {
  const db = getDb()
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.agentId, agentId), eq(sessions.status, 'active')))
    .orderBy(desc(sessions.updatedAt))
    .get()
}

export function archiveActiveSessionsByAgent(agentId: string) {
  const db = getDb()
  db
    .update(sessions)
    .set({
      status: 'archived',
      updatedAt: new Date(),
    })
    .where(and(eq(sessions.agentId, agentId), eq(sessions.status, 'active')))
    .run()
}

export function listAllSessions() {
  const db = getDb()
  return db.select().from(sessions).orderBy(desc(sessions.updatedAt)).all()
}

export function deleteSession(id: string) {
  const db = getDb()
  db.delete(sessions).where(eq(sessions.id, id)).run()
}
