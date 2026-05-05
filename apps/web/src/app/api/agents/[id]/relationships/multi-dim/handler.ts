import { agentRepo, appSettingsRepo, relationshipRepo } from '@mas/db'
import {
  buildRelationshipAnalysisPrompt,
  buildRelationshipFragment,
} from '@mas/systems'
import { DEFAULT_RELATIONSHIP_BASELINE } from '../../../../../persona-modules'
import { readRelationshipModule } from '../handler'

const DEFAULT_COUNTERPART_ID = 'default-user'

type RelationshipBaseline = {
  trust: number
  affinity: number
  familiarity: number
  respect: number
}

type MultiDimConfig = {
  scheme: 'multi-dim'
  baseline: RelationshipBaseline
  decayPerTurn?: number
  analysisModel: string | null
  fragmentPrompt: string | null
  analysisPrompt: string | null
}
type AppLocale = appSettingsRepo.AppLocale

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clampLevel(value: unknown, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(1, Math.max(0, value))
}

function clampDecay(value: unknown, fallback: number | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(1, Math.max(0, value))
}

function readText(value: unknown, fallback: string | null = null) {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : fallback
}

function normalizeBaseline(
  value: unknown,
  fallback: RelationshipBaseline = DEFAULT_RELATIONSHIP_BASELINE,
): RelationshipBaseline {
  const record = isRecord(value) ? value : {}
  return {
    trust: clampLevel(record.trust, fallback.trust),
    affinity: clampLevel(record.affinity, fallback.affinity),
    familiarity: clampLevel(record.familiarity, fallback.familiarity),
    respect: clampLevel(record.respect, fallback.respect),
  }
}

function readLocalizedPrompt(record: Record<string, unknown> | null | undefined, key: string, locale: AppLocale) {
  const localized = record?.[`${key}ByLocale`]
  if (isRecord(localized)) {
    const value = localized[locale]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return locale === 'zh-CN' ? readText(record?.[key]) : null
}

function writeLocalizedPrompt(record: Record<string, unknown>, key: string, locale: AppLocale, value: string | null) {
  const localizedKey = `${key}ByLocale`
  const localized = isRecord(record[localizedKey]) ? { ...(record[localizedKey] as Record<string, unknown>) } : {}
  if (value) localized[locale] = value
  else delete localized[locale]
  if (Object.keys(localized).length > 0) record[localizedKey] = localized
  else delete record[localizedKey]
}

function normalizeMultiDimConfig(module: unknown, locale: AppLocale): MultiDimConfig {
  const record = readRelationshipModule({ relationship: module })
  return {
    scheme: 'multi-dim',
    baseline: normalizeBaseline(record?.baseline),
    decayPerTurn: clampDecay(record?.decayPerTurn, undefined),
    analysisModel: readText(record?.analysisModel),
    fragmentPrompt: readLocalizedPrompt(record, 'fragmentPrompt', locale),
    analysisPrompt: readLocalizedPrompt(record, 'analysisPrompt', locale),
  }
}

function buildPayload(agentId: string, config: MultiDimConfig, locale: AppLocale) {
  const relationship = relationshipRepo.getRelationship(agentId, DEFAULT_COUNTERPART_ID)
  return {
    agentId,
    scheme: 'multi-dim' as const,
    baseline: config.baseline,
    decayPerTurn: config.decayPerTurn ?? null,
    analysisModel: config.analysisModel,
    fragmentPrompt: config.fragmentPrompt,
    analysisPrompt: config.analysisPrompt,
    locale,
    currentState: relationship?.dimensions ?? null,
    fragmentPromptDefault: buildRelationshipFragment(relationship?.dimensions ?? config.baseline, null, locale === 'en-US' ? 'user' : '用户', null, locale),
    fragmentPromptEffective: buildRelationshipFragment(relationship?.dimensions ?? config.baseline, config.fragmentPrompt, locale === 'en-US' ? 'user' : '用户', null, locale),
    analysisPromptDefault: buildRelationshipAnalysisPrompt(null, locale),
    analysisPromptEffective: buildRelationshipAnalysisPrompt(config.analysisPrompt, locale),
    history: relationship?.history ?? [],
  }
}

function parsePatchBody(body: unknown) {
  if (!isRecord(body)) {
    return {
      ok: false as const,
      response: Response.json({ error: 'Request body must be an object' }, { status: 400 }),
    }
  }

  if (body.baseline !== undefined && !isRecord(body.baseline)) {
    return {
      ok: false as const,
      response: Response.json({ error: 'baseline must be an object' }, { status: 400 }),
    }
  }

  if (body.decayPerTurn !== undefined && typeof body.decayPerTurn !== 'number') {
    return {
      ok: false as const,
      response: Response.json({ error: 'decayPerTurn must be a number' }, { status: 400 }),
    }
  }

  if (body.analysisModel !== undefined && body.analysisModel !== null && typeof body.analysisModel !== 'string') {
    return {
      ok: false as const,
      response: Response.json({ error: 'analysisModel must be a string or null' }, { status: 400 }),
    }
  }

  if (body.fragmentPrompt !== undefined && body.fragmentPrompt !== null && typeof body.fragmentPrompt !== 'string') {
    return {
      ok: false as const,
      response: Response.json({ error: 'fragmentPrompt must be a string or null' }, { status: 400 }),
    }
  }

  if (body.analysisPrompt !== undefined && body.analysisPrompt !== null && typeof body.analysisPrompt !== 'string') {
    return {
      ok: false as const,
      response: Response.json({ error: 'analysisPrompt must be a string or null' }, { status: 400 }),
    }
  }

  return {
    ok: true as const,
    value: body as {
      baseline?: Partial<RelationshipBaseline>
      decayPerTurn?: number
      analysisModel?: string | null
      fragmentPrompt?: string | null
      analysisPrompt?: string | null
    },
  }
}

export function getMultiDimRelationshipConfig(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const relationship = readRelationshipModule(agent.modules)
  if (relationship?.scheme !== 'multi-dim') {
    return Response.json(
      { error: 'Agent relationship scheme must be multi-dim' },
      { status: 400 },
    )
  }

  const locale = appSettingsRepo.getAppLocale()
  return Response.json(buildPayload(agentId, normalizeMultiDimConfig(agent.modules?.relationship, locale), locale))
}

export function updateMultiDimRelationshipConfig(agentId: string, body: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = parsePatchBody(body)
  if (!parsed.ok) {
    return parsed.response
  }

  const locale = appSettingsRepo.getAppLocale()
  const current = normalizeMultiDimConfig(agent.modules?.relationship, locale)
  const next: MultiDimConfig = {
    scheme: 'multi-dim',
    baseline: {
      trust: clampLevel(parsed.value.baseline?.trust, current.baseline.trust),
      affinity: clampLevel(parsed.value.baseline?.affinity, current.baseline.affinity),
      familiarity: clampLevel(parsed.value.baseline?.familiarity, current.baseline.familiarity),
      respect: clampLevel(parsed.value.baseline?.respect, current.baseline.respect),
    },
    decayPerTurn: clampDecay(parsed.value.decayPerTurn, current.decayPerTurn),
    analysisModel:
      parsed.value.analysisModel !== undefined
        ? readText(parsed.value.analysisModel)
        : current.analysisModel,
    fragmentPrompt:
      parsed.value.fragmentPrompt !== undefined
        ? readText(parsed.value.fragmentPrompt)
        : current.fragmentPrompt,
    analysisPrompt:
      parsed.value.analysisPrompt !== undefined
        ? readText(parsed.value.analysisPrompt)
        : current.analysisPrompt,
  }

  const nextModules = isRecord(agent.modules) ? { ...agent.modules } : {}
  const nextRelationship: Record<string, unknown> = {
    scheme: 'multi-dim',
    baseline: next.baseline,
    ...(typeof next.decayPerTurn === 'number' ? { decayPerTurn: next.decayPerTurn } : {}),
    ...(next.analysisModel ? { analysisModel: next.analysisModel } : {}),
  }
  const existingRelationship = isRecord(agent.modules?.relationship) ? agent.modules?.relationship as Record<string, unknown> : {}
  for (const key of ['fragmentPromptByLocale', 'analysisPromptByLocale'] as const) {
    if (isRecord(existingRelationship[key])) nextRelationship[key] = existingRelationship[key]
  }
  if (parsed.value.fragmentPrompt !== undefined) writeLocalizedPrompt(nextRelationship, 'fragmentPrompt', locale, next.fragmentPrompt)
  if (parsed.value.analysisPrompt !== undefined) writeLocalizedPrompt(nextRelationship, 'analysisPrompt', locale, next.analysisPrompt)
  nextModules.relationship = nextRelationship
  agentRepo.updateAgent(agentId, { modules: nextModules })

  return Response.json(buildPayload(agentId, next, locale))
}
