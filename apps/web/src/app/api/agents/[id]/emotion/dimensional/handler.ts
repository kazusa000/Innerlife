import { agentRepo, appSettingsRepo, emotionStateRepo } from '@mas/db'
import {
  buildEmotionAnalysisPrompt,
  buildEmotionFragment,
} from '@mas/systems'
import { DEFAULT_EMOTION_BASELINE } from '../../../../../persona-modules'
import { readEmotionModule } from '../handler'

type EmotionBaseline = {
  mood: number
  energy: number
  stress: number
}

type DimensionalConfig = {
  scheme: 'dimensional'
  baseline: EmotionBaseline
  decayPerTurn?: number
  analysisModel: string | null
  fragmentPrompt: string | null
  analysisPrompt: string | null
}
type AppLocale = appSettingsRepo.AppLocale

type HistoryEntry = {
  state: EmotionBaseline
  delta: EmotionBaseline | null
  trigger: string | null
  createdAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clampMood(value: unknown, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(1, Math.max(-1, value))
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
  fallback: EmotionBaseline = DEFAULT_EMOTION_BASELINE,
): EmotionBaseline {
  const record = isRecord(value) ? value : {}
  return {
    mood: clampMood(record.mood, fallback.mood),
    energy: clampLevel(record.energy, fallback.energy),
    stress: clampLevel(record.stress, fallback.stress),
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

function normalizeDimensionalConfig(module: unknown, locale: AppLocale): DimensionalConfig {
  const record = readEmotionModule({ emotion: module })
  return {
    scheme: 'dimensional',
    baseline: normalizeBaseline(record?.baseline),
    decayPerTurn: clampDecay(record?.decayPerTurn, undefined),
    analysisModel: readText(record?.analysisModel),
    fragmentPrompt: readLocalizedPrompt(record, 'fragmentPrompt', locale),
    analysisPrompt: readLocalizedPrompt(record, 'analysisPrompt', locale),
  }
}

function mapHistoryEntry(
  entry: ReturnType<typeof emotionStateRepo.listRecentEmotionStatesByAgent>[number],
): HistoryEntry {
  return {
    state: entry.state,
    delta: entry.delta,
    trigger: entry.trigger,
    createdAt: entry.createdAt.toISOString(),
  }
}

function buildPayload(agentId: string, config: DimensionalConfig, locale: AppLocale) {
  const history = emotionStateRepo
    .listRecentEmotionStatesByAgent(agentId, 10)
    .map(mapHistoryEntry)
  const currentState = history[0]?.state ?? null

  return {
    agentId,
    scheme: 'dimensional' as const,
    baseline: config.baseline,
    decayPerTurn: config.decayPerTurn ?? null,
    analysisModel: config.analysisModel,
    fragmentPrompt: config.fragmentPrompt,
    analysisPrompt: config.analysisPrompt,
    locale,
    currentState,
    fragmentPromptDefault: buildEmotionFragment(currentState ?? config.baseline, null, locale),
    fragmentPromptEffective: buildEmotionFragment(currentState ?? config.baseline, config.fragmentPrompt, locale),
    analysisPromptDefault: buildEmotionAnalysisPrompt(null, locale),
    analysisPromptEffective: buildEmotionAnalysisPrompt(config.analysisPrompt, locale),
    history,
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

  if (body.currentState !== undefined && !isRecord(body.currentState)) {
    return {
      ok: false as const,
      response: Response.json({ error: 'currentState must be an object' }, { status: 400 }),
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
      baseline?: Partial<EmotionBaseline>
      currentState?: Partial<EmotionBaseline>
      decayPerTurn?: number
      analysisModel?: string | null
      fragmentPrompt?: string | null
      analysisPrompt?: string | null
    },
  }
}

export function getDimensionalEmotionConfig(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const emotion = readEmotionModule(agent.modules)
  if (emotion?.scheme !== 'dimensional') {
    return Response.json(
      { error: 'Agent emotion scheme must be dimensional' },
      { status: 400 },
    )
  }

  const locale = appSettingsRepo.getAppLocale()
  return Response.json(buildPayload(agentId, normalizeDimensionalConfig(agent.modules?.emotion, locale), locale))
}

export function updateDimensionalEmotionConfig(agentId: string, body: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = parsePatchBody(body)
  if (!parsed.ok) {
    return parsed.response
  }

  const locale = appSettingsRepo.getAppLocale()
  const current = normalizeDimensionalConfig(agent.modules?.emotion, locale)
  const next: DimensionalConfig = {
    scheme: 'dimensional',
    baseline: {
      mood: clampMood(parsed.value.baseline?.mood, current.baseline.mood),
      energy: clampLevel(parsed.value.baseline?.energy, current.baseline.energy),
      stress: clampLevel(parsed.value.baseline?.stress, current.baseline.stress),
    },
    decayPerTurn: clampDecay(parsed.value.decayPerTurn, current.decayPerTurn),
    analysisModel:
      parsed.value.analysisModel !== undefined
        ? readText(parsed.value.analysisModel)
        : current.analysisModel,
    fragmentPrompt: parsed.value.fragmentPrompt !== undefined ? readText(parsed.value.fragmentPrompt) : current.fragmentPrompt,
    analysisPrompt: parsed.value.analysisPrompt !== undefined ? readText(parsed.value.analysisPrompt) : current.analysisPrompt,
  }

  const nextModules = isRecord(agent.modules) ? { ...agent.modules } : {}
  const nextEmotion: Record<string, unknown> = {
    scheme: 'dimensional',
    baseline: next.baseline,
    ...(typeof next.decayPerTurn === 'number' ? { decayPerTurn: next.decayPerTurn } : {}),
    ...(next.analysisModel ? { analysisModel: next.analysisModel } : {}),
  }
  const existingEmotion = isRecord(agent.modules?.emotion) ? agent.modules?.emotion as Record<string, unknown> : {}
  for (const key of ['fragmentPromptByLocale', 'analysisPromptByLocale'] as const) {
    if (isRecord(existingEmotion[key])) nextEmotion[key] = existingEmotion[key]
  }
  if (parsed.value.fragmentPrompt !== undefined) writeLocalizedPrompt(nextEmotion, 'fragmentPrompt', locale, next.fragmentPrompt)
  if (parsed.value.analysisPrompt !== undefined) writeLocalizedPrompt(nextEmotion, 'analysisPrompt', locale, next.analysisPrompt)
  nextModules.emotion = nextEmotion
  agentRepo.updateAgent(agentId, { modules: nextModules })

  if (parsed.value.currentState !== undefined) {
    const latest = emotionStateRepo.listRecentEmotionStatesByAgent(agentId, 1)[0]
    emotionStateRepo.addEmotionState({
      agentId,
      sessionId: latest?.sessionId ?? 'manual-override',
      state: {
        mood: clampMood(parsed.value.currentState.mood, latest?.state.mood ?? next.baseline.mood),
        energy: clampLevel(parsed.value.currentState.energy, latest?.state.energy ?? next.baseline.energy),
        stress: clampLevel(parsed.value.currentState.stress, latest?.state.stress ?? next.baseline.stress),
      },
      delta: null,
      trigger: 'manual_override',
    })
  }

  return Response.json(buildPayload(agentId, next, locale))
}
