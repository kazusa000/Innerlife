import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { agents } from '../schema'
import { randomUUID } from 'node:crypto'

export function createAgent(data: {
  name: string
  description?: string
  personality?: string
  skills?: string
  model: string
}) {
  const db = getDb()
  const id = randomUUID()
  db.insert(agents).values({ id, ...data }).run()
  return getAgent(id)!
}

export function getAgent(id: string) {
  const db = getDb()
  return db.select().from(agents).where(eq(agents.id, id)).get()
}

export function listAgents() {
  const db = getDb()
  return db.select().from(agents).all()
}
