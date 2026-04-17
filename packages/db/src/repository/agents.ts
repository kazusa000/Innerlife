import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { agents } from '../schema'
import { randomUUID } from 'node:crypto'

export type AgentModules = Record<string, unknown> | null

function parseModules(modules: string | null) {
  if (!modules) return null
  return JSON.parse(modules) as Record<string, unknown>
}

function serializeModules(modules: AgentModules | undefined) {
  if (modules === undefined) return undefined
  if (modules === null) return null
  return JSON.stringify(modules)
}

function mapAgent(row: typeof agents.$inferSelect) {
  return {
    ...row,
    modules: parseModules(row.modules),
  }
}

export function createAgent(data: {
  name: string
  description?: string
  personality?: string
  skills?: string
  model: string
  modules?: AgentModules
}) {
  const db = getDb()
  const id = randomUUID()
  db
    .insert(agents)
    .values({ id, ...data, modules: serializeModules(data.modules) ?? null })
    .run()
  return getAgent(id)!
}

export function getAgent(id: string) {
  const db = getDb()
  const agent = db.select().from(agents).where(eq(agents.id, id)).get()
  return agent ? mapAgent(agent) : undefined
}

export function listAgents() {
  const db = getDb()
  return db.select().from(agents).all().map(mapAgent)
}

export function updateAgent(id: string, data: {
  name?: string
  description?: string
  model?: string
  modules?: AgentModules
}) {
  const db = getDb()
  db
    .update(agents)
    .set({
      ...data,
      modules: serializeModules(data.modules),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, id))
    .run()
  return getAgent(id)
}

export function deleteAgent(id: string) {
  const db = getDb()
  db.delete(agents).where(eq(agents.id, id)).run()
}
