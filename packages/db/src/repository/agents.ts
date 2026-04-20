import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { agents } from '../schema'
import { randomUUID } from 'node:crypto'

export type AgentModules = Record<string, unknown> | null
export type AgentProvider = 'anthropic' | 'openrouter'

type AgentConfig = {
  provider?: AgentProvider
}

function parseModules(modules: string | null) {
  if (!modules) return null
  return JSON.parse(modules) as Record<string, unknown>
}

function serializeModules(modules: AgentModules | undefined) {
  if (modules === undefined) return undefined
  if (modules === null) return null
  return JSON.stringify(modules)
}

function parseConfig(config: string | null): AgentConfig {
  if (!config) return {}
  try {
    const parsed = JSON.parse(config)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as AgentConfig
      : {}
  } catch {
    return {}
  }
}

function serializeConfig(config: AgentConfig | undefined) {
  if (!config) return undefined
  return JSON.stringify(config)
}

function mapAgent(row: typeof agents.$inferSelect) {
  const config = parseConfig(row.config)
  return {
    ...row,
    provider: config.provider === 'openrouter' ? 'openrouter' : 'anthropic',
    modules: parseModules(row.modules),
  }
}

export function createAgent(data: {
  name: string
  description?: string
  personality?: string
  skills?: string
  provider?: AgentProvider
  model: string
  modules?: AgentModules
}) {
  const db = getDb()
  const id = randomUUID()
  db
    .insert(agents)
    .values({
      id,
      ...data,
      modules: serializeModules(data.modules) ?? null,
      config: serializeConfig({ provider: data.provider ?? 'anthropic' }) ?? null,
    })
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
  provider?: AgentProvider
  model?: string
  modules?: AgentModules
}) {
  const db = getDb()
  const existing = db.select().from(agents).where(eq(agents.id, id)).get()
  const nextConfig = data.provider !== undefined
    ? serializeConfig({
        ...parseConfig(existing?.config ?? null),
        provider: data.provider,
      }) ?? null
    : undefined
  db
    .update(agents)
    .set({
      name: data.name,
      description: data.description,
      model: data.model,
      modules: serializeModules(data.modules),
      config: nextConfig,
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
