import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { agents } from '../schema'
import { randomUUID } from 'node:crypto'

export type AgentModules = Record<string, unknown> | null
export type AgentProvider = 'anthropic' | 'openrouter'
export type AgentToolsConfig = Record<string, {
  enabled?: boolean
  description?: string
}>

type AgentConfig = {
  provider?: AgentProvider
  systemPrompt?: string
  personaPrompt?: string
  avatarUrl?: string
  thinkingRoleImmersionPrompt?: string
  tools?: AgentToolsConfig
}

type PersonalitySettings = {
  systemPrompt?: string
  personaPrompt?: string
  avatarUrl?: string
  thinkingRoleImmersionPrompt?: string
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

function parseToolsConfig(config: unknown): AgentToolsConfig | undefined {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return undefined
  }

  const nextTools: AgentToolsConfig = {}

  for (const [toolName, rawEntry] of Object.entries(config)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      continue
    }

    const entry: { enabled?: boolean; description?: string } = {}
    if (typeof rawEntry.enabled === 'boolean') {
      entry.enabled = rawEntry.enabled
    }

    if (typeof rawEntry.description === 'string' && rawEntry.description.trim()) {
      entry.description = rawEntry.description.trim()
    }

    if (entry.enabled !== undefined || entry.description !== undefined) {
      nextTools[toolName] = entry
    }
  }

  return Object.keys(nextTools).length > 0 ? nextTools : undefined
}

function serializeConfig(config: AgentConfig | undefined) {
  if (!config) return undefined
  return JSON.stringify(config)
}

function readModulesPersonality(modules: AgentModules | undefined): PersonalitySettings {
  const personality = isRecord(modules?.personality)
    ? modules?.personality as Record<string, unknown>
    : null

  return {
    systemPrompt: readPrompt(personality?.systemPrompt),
    personaPrompt: readPrompt(personality?.personaPrompt),
    avatarUrl: readPrompt(personality?.avatarUrl),
    thinkingRoleImmersionPrompt: readPrompt(personality?.thinkingRoleImmersionPrompt),
  }
}

function resolvePersonalitySettings(
  modules: AgentModules | undefined,
  config: AgentConfig,
  overrides?: PersonalitySettings,
) {
  const fromModules = readModulesPersonality(modules)

  return {
    systemPrompt:
      overrides?.systemPrompt !== undefined
        ? readPrompt(overrides.systemPrompt)
        : readPrompt(config.systemPrompt) ?? fromModules.systemPrompt,
    personaPrompt:
      overrides?.personaPrompt !== undefined
        ? readPrompt(overrides.personaPrompt)
        : readPrompt(config.personaPrompt) ?? fromModules.personaPrompt,
    avatarUrl:
      overrides?.avatarUrl !== undefined
        ? readPrompt(overrides.avatarUrl)
        : readPrompt(config.avatarUrl) ?? fromModules.avatarUrl,
    thinkingRoleImmersionPrompt:
      overrides?.thinkingRoleImmersionPrompt !== undefined
        ? readPrompt(overrides.thinkingRoleImmersionPrompt)
        : readPrompt(config.thinkingRoleImmersionPrompt) ?? fromModules.thinkingRoleImmersionPrompt,
  }
}

function normalizeModules(
  modules: AgentModules | undefined,
  personalitySettings: PersonalitySettings,
): AgentModules {
  const next = isRecord(modules) ? { ...modules } : {}
  const personality: Record<string, string> = {}

  if (personalitySettings.systemPrompt) {
    personality.systemPrompt = personalitySettings.systemPrompt
  }
  if (personalitySettings.personaPrompt) {
    personality.personaPrompt = personalitySettings.personaPrompt
  }
  if (personalitySettings.avatarUrl) {
    personality.avatarUrl = personalitySettings.avatarUrl
  }
  if (personalitySettings.thinkingRoleImmersionPrompt) {
    personality.thinkingRoleImmersionPrompt = personalitySettings.thinkingRoleImmersionPrompt
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
  const personalitySettings = resolvePersonalitySettings(parseModules(row.modules), config)
  const modules = normalizeModules(parseModules(row.modules), personalitySettings)

  return {
    ...row,
    provider: config.provider === 'openrouter' ? 'openrouter' : 'anthropic',
    systemPrompt: personalitySettings.systemPrompt ?? '',
    personaPrompt: personalitySettings.personaPrompt ?? '',
    avatarUrl: personalitySettings.avatarUrl ?? '',
    thinkingRoleImmersionPrompt: personalitySettings.thinkingRoleImmersionPrompt ?? '',
    tools: parseToolsConfig(config.tools),
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
  avatarUrl?: string
  thinkingRoleImmersionPrompt?: string
  modules?: AgentModules
  tools?: AgentToolsConfig
}) {
  const db = getDb()
  const id = randomUUID()
  const personalitySettings = resolvePersonalitySettings(
    data.modules ?? null,
    {},
    {
      systemPrompt: data.systemPrompt,
      personaPrompt: data.personaPrompt,
      avatarUrl: data.avatarUrl,
      thinkingRoleImmersionPrompt: data.thinkingRoleImmersionPrompt,
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
      modules: serializeModules(normalizeModules(data.modules ?? null, personalitySettings)) ?? null,
      config: serializeConfig({
        provider: data.provider ?? 'anthropic',
        tools: data.tools,
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
  avatarUrl?: string
  thinkingRoleImmersionPrompt?: string
  modules?: AgentModules
  tools?: AgentToolsConfig | null
}) {
  const db = getDb()
  const existing = db.select().from(agents).where(eq(agents.id, id)).get()
  const existingModules = parseModules(existing?.modules ?? null)
  const existingConfig = parseConfig(existing?.config ?? null)
  const personalitySettings = resolvePersonalitySettings(
    data.modules !== undefined ? data.modules : existingModules,
    existingConfig,
    {
      systemPrompt: data.systemPrompt,
      personaPrompt: data.personaPrompt,
      avatarUrl: data.avatarUrl,
      thinkingRoleImmersionPrompt: data.thinkingRoleImmersionPrompt,
    },
  )
  const shouldRewriteModules =
    data.modules !== undefined
    || data.systemPrompt !== undefined
    || data.personaPrompt !== undefined
    || data.avatarUrl !== undefined
    || data.thinkingRoleImmersionPrompt !== undefined
    || existingConfig.systemPrompt !== undefined
    || existingConfig.personaPrompt !== undefined
    || existingConfig.avatarUrl !== undefined
    || existingConfig.thinkingRoleImmersionPrompt !== undefined
    || existingModules?.personality !== undefined
  const nextTools =
    data.tools !== undefined
      ? (data.tools ?? undefined)
      : existingConfig.tools
  const nextConfig =
    data.provider !== undefined
    || data.tools !== undefined
    || existingConfig.provider !== undefined
    || existingConfig.tools !== undefined
    || existingConfig.systemPrompt !== undefined
    || existingConfig.personaPrompt !== undefined
    || existingConfig.thinkingRoleImmersionPrompt !== undefined
      ? serializeConfig({
          provider: data.provider ?? existingConfig.provider ?? 'anthropic',
          tools: nextTools,
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
          personalitySettings,
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
