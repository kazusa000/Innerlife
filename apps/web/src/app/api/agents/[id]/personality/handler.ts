import { agentRepo, appSettingsRepo } from '@mas/db'

type AppLocale = appSettingsRepo.AppLocale

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readPrompt(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readLocalizedPrompt(
  record: Record<string, unknown> | null,
  key: string,
  locale: AppLocale,
) {
  const localized = record?.[`${key}ByLocale`]
  if (isRecord(localized)) {
    const value = localized[locale]
    if (typeof value === 'string') {
      return value.trim()
    }
  }

  if (locale === 'zh-CN') {
    return readPrompt(record?.[key])
  }

  return ''
}

function readPersonalityPrompts(
  modules: Record<string, unknown> | null | undefined,
  locale: AppLocale,
) {
  const personality = isRecord(modules?.personality)
    ? modules?.personality as Record<string, unknown>
    : null

  return {
    systemPrompt: readLocalizedPrompt(personality, 'systemPrompt', locale),
    personaPrompt: readLocalizedPrompt(personality, 'personaPrompt', locale),
    avatarUrl: readPrompt(personality?.avatarUrl),
    thinkingRoleImmersionPrompt: readLocalizedPrompt(personality, 'thinkingRoleImmersionPrompt', locale),
  }
}

function writeLocalizedPrompt(
  personality: Record<string, unknown>,
  key: 'systemPrompt' | 'personaPrompt' | 'thinkingRoleImmersionPrompt',
  value: string | undefined,
  locale: AppLocale,
) {
  if (value === undefined) return

  const text = value.trim()
  const localizedKey = `${key}ByLocale`
  const localized = isRecord(personality[localizedKey])
    ? { ...personality[localizedKey] as Record<string, unknown> }
    : {}

  if (text) {
    localized[locale] = text
  } else {
    delete localized[locale]
  }

  if (Object.keys(localized).length > 0) {
    personality[localizedKey] = localized
  } else {
    delete personality[localizedKey]
  }

  if (locale === 'zh-CN') {
    if (text) {
      personality[key] = text
    } else {
      delete personality[key]
    }
  }
}

function writeTextField(
  record: Record<string, unknown>,
  key: string,
  value: string | undefined,
) {
  if (value === undefined) return
  const text = value.trim()
  if (text) {
    record[key] = text
  } else {
    delete record[key]
  }
}

export function getPersonalityConfig(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const locale = appSettingsRepo.getAppLocale()
  const prompts = readPersonalityPrompts(agent.modules, locale)

  return Response.json({
    agentId,
    locale,
    systemPrompt: prompts.systemPrompt,
    personaPrompt: prompts.personaPrompt,
    avatarUrl: prompts.avatarUrl,
    thinkingRoleImmersionPrompt: prompts.thinkingRoleImmersionPrompt,
  })
}

export function updatePersonalityConfig(agentId: string, body: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isRecord(body)) {
    return Response.json({ error: 'body must be an object' }, { status: 400 })
  }

  const { systemPrompt, personaPrompt, avatarUrl, thinkingRoleImmersionPrompt } = body
  if (systemPrompt !== undefined && typeof systemPrompt !== 'string') {
    return Response.json({ error: 'systemPrompt must be a string' }, { status: 400 })
  }
  if (personaPrompt !== undefined && typeof personaPrompt !== 'string') {
    return Response.json({ error: 'personaPrompt must be a string' }, { status: 400 })
  }
  if (avatarUrl !== undefined && typeof avatarUrl !== 'string') {
    return Response.json({ error: 'avatarUrl must be a string' }, { status: 400 })
  }
  if (thinkingRoleImmersionPrompt !== undefined && typeof thinkingRoleImmersionPrompt !== 'string') {
    return Response.json({ error: 'thinkingRoleImmersionPrompt must be a string' }, { status: 400 })
  }

  const locale = appSettingsRepo.getAppLocale()
  const nextModules = isRecord(agent.modules) ? { ...agent.modules } : {}
  const personality = isRecord(nextModules.personality)
    ? { ...nextModules.personality as Record<string, unknown> }
    : {}
  writeLocalizedPrompt(personality, 'systemPrompt', systemPrompt, locale)
  writeLocalizedPrompt(personality, 'personaPrompt', personaPrompt, locale)
  writeLocalizedPrompt(personality, 'thinkingRoleImmersionPrompt', thinkingRoleImmersionPrompt, locale)
  writeTextField(personality, 'avatarUrl', avatarUrl)
  if (Object.keys(personality).length > 0) {
    nextModules.personality = personality
  } else {
    delete nextModules.personality
  }

  const updated = agentRepo.updateAgent(agentId, {
    modules: Object.keys(nextModules).length > 0 ? nextModules : null,
    systemPrompt: locale === 'zh-CN' ? systemPrompt : undefined,
    personaPrompt: locale === 'zh-CN' ? personaPrompt : undefined,
    thinkingRoleImmersionPrompt: locale === 'zh-CN' ? thinkingRoleImmersionPrompt : undefined,
    avatarUrl,
  })
  if (!updated) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const prompts = readPersonalityPrompts(updated.modules, locale)
  return Response.json({
    agentId,
    locale,
    systemPrompt: prompts.systemPrompt,
    personaPrompt: prompts.personaPrompt,
    avatarUrl: prompts.avatarUrl,
    thinkingRoleImmersionPrompt: prompts.thinkingRoleImmersionPrompt,
  })
}
