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

type PersonalityPrompts = {
  systemPrompt?: string
  personaPrompt?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readPrompt(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function parseModules(modules: string | null) {
  if (!modules) return null
  try {
    return JSON.parse(modules) as Record<string, unknown>
  } catch {
    return null
  }
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

function readModulesPrompts(modules: AgentModules | undefined): PersonalityPrompts {
  const personality = isRecord(modules?.personality)
    ? modules?.personality as Record<string, unknown>
    : null

  return {
    systemPrompt: readPrompt(personality?.systemPrompt),
    personaPrompt: readPrompt(personality?.personaPrompt),
  }
}

function resolvePersonalityPrompts(
  modules: AgentModules | undefined,
  config: AgentConfig,
  overrides?: PersonalityPrompts,
) {
  const fromModules = readModulesPrompts(modules)

  return {
    systemPrompt:
      overrides?.systemPrompt !== undefined
        ? readPrompt(overrides.systemPrompt)
        : readPrompt(config.systemPrompt) ?? fromModules.systemPrompt,
    personaPrompt:
      overrides?.personaPrompt !== undefined
        ? readPrompt(overrides.personaPrompt)
        : readPrompt(config.personaPrompt) ?? fromModules.personaPrompt,
  }
}

function normalizeModules(
  modules: AgentModules | undefined,
  prompts: PersonalityPrompts,
): AgentModules {
  const next = isRecord(modules) ? { ...modules } : {}
  const personality: Record<string, string> = {}

  if (prompts.systemPrompt) {
    personality.systemPrompt = prompts.systemPrompt
  }
  if (prompts.personaPrompt) {
    personality.personaPrompt = prompts.personaPrompt
  }

  if (Object.keys(personality).length > 0) {
    next.personality = personality
  } else {
    delete next.personality
  }

  return Object.keys(next).length > 0 ? next : null
}

function mapAgent(row: typeof agents.$inferSelect) {
  const config = parseConfig(row.config)
  const prompts = resolvePersonalityPrompts(parseModules(row.modules), config)
  const modules = normalizeModules(parseModules(row.modules), prompts)

  return {
    ...row,
    provider: config.provider === 'openrouter' ? 'openrouter' : 'anthropic',
    systemPrompt: prompts.systemPrompt ?? '',
    personaPrompt: prompts.personaPrompt ?? '',
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
  const prompts = resolvePersonalityPrompts(
    data.modules ?? null,
    {},
    {
      systemPrompt: data.systemPrompt,
      personaPrompt: data.personaPrompt,
    },
  )

  db
    .insert(agents)
    .values({
      id,
      name: data.name,
      description: data.description,
      personality: data.personality,
      skills: data.skills,
      model: data.model,
      modules: serializeModules(normalizeModules(data.modules ?? null, prompts)) ?? null,
      config: serializeConfig({
        provider: data.provider ?? 'anthropic',
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
  const existingModules = parseModules(existing?.modules ?? null)
  const existingConfig = parseConfig(existing?.config ?? null)
  const prompts = resolvePersonalityPrompts(
    data.modules !== undefined ? data.modules : existingModules,
    existingConfig,
    {
      systemPrompt: data.systemPrompt,
      personaPrompt: data.personaPrompt,
    },
  )
  const shouldRewriteModules =
    data.modules !== undefined
    || data.systemPrompt !== undefined
    || data.personaPrompt !== undefined
    || existingConfig.systemPrompt !== undefined
    || existingConfig.personaPrompt !== undefined
    || existingModules?.personality !== undefined
  const nextConfig =
    data.provider !== undefined
    || existingConfig.systemPrompt !== undefined
    || existingConfig.personaPrompt !== undefined
      ? serializeConfig({
          provider: data.provider ?? existingConfig.provider ?? 'anthropic',
        }) ?? null
      : undefined
  db
    .update(agents)
    .set({
      name: data.name,
      description: data.description,
      model: data.model,
      modules: shouldRewriteModules
        ? serializeModules(normalizeModules(
          data.modules !== undefined ? data.modules : existingModules,
          prompts,
        ))
        : undefined,
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
