import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { agents } from '../schema'
import { randomUUID } from 'node:crypto'

export type AgentModules = Record<string, unknown> | null
export type AgentProvider = 'anthropic' | 'openrouter'

type AgentConfig = {
  provider?: AgentProvider
  systemPrompt?: string
  personaPrompt?: string
}

function parseModules(modules: string | null) {
  if (!modules) return null
  return JSON.parse(modules) as Record<string, unknown>
}

function readLegacyPersonaPrompt(modules: Record<string, unknown> | null): string | null {
  const personality = modules?.personality
  if (!personality || typeof personality !== 'object' || Array.isArray(personality)) {
    return null
  }

  const prompt = (personality as Record<string, unknown>).prompt
  return typeof prompt === 'string' && prompt.trim().length > 0
    ? prompt.trim()
    : null
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
  const modules = parseModules(row.modules)
  return {
    ...row,
    provider: config.provider === 'openrouter' ? 'openrouter' : 'anthropic',
    systemPrompt: typeof config.systemPrompt === 'string' ? config.systemPrompt : '',
    personaPrompt:
      typeof config.personaPrompt === 'string' && config.personaPrompt.trim().length > 0
        ? config.personaPrompt.trim()
        : readLegacyPersonaPrompt(modules) ?? '',
    modules,
  }
}

export function createAgent(data: {
  name: string
  description?: string
  personality?: string
  skills?: string
  provider?: AgentProvider
  model: string
  systemPrompt?: string
  personaPrompt?: string
  modules?: AgentModules
}) {
  const db = getDb()
  const id = randomUUID()
  db
    .insert(agents)
    .values({
      id,
      name: data.name,
      description: data.description,
      personality: data.personality,
      skills: data.skills,
      model: data.model,
      modules: serializeModules(data.modules) ?? null,
      config: serializeConfig({
        provider: data.provider ?? 'anthropic',
        systemPrompt: data.systemPrompt?.trim() || undefined,
        personaPrompt: data.personaPrompt?.trim() || undefined,
      }) ?? null,
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
  systemPrompt?: string
  personaPrompt?: string
  modules?: AgentModules
}) {
  const db = getDb()
  const existing = db.select().from(agents).where(eq(agents.id, id)).get()
  const existingConfig = parseConfig(existing?.config ?? null)
  const nextConfig =
    data.provider !== undefined
    || data.systemPrompt !== undefined
    || data.personaPrompt !== undefined
      ? serializeConfig({
          ...existingConfig,
          provider: data.provider ?? existingConfig.provider,
          systemPrompt:
            data.systemPrompt !== undefined
              ? (data.systemPrompt.trim() || undefined)
              : existingConfig.systemPrompt,
          personaPrompt:
            data.personaPrompt !== undefined
              ? (data.personaPrompt.trim() || undefined)
              : existingConfig.personaPrompt,
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
