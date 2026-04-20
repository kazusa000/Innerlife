export type BigFiveKey =
  | 'openness'
  | 'conscientiousness'
  | 'extraversion'
  | 'agreeableness'
  | 'neuroticism'

export type BigFiveScores = Record<BigFiveKey, number>

export type EmotionKey = 'mood' | 'energy' | 'stress'
export type EmotionBaseline = Record<EmotionKey, number>

export type RelationshipKey = 'trust' | 'affinity' | 'familiarity' | 'respect'
export type RelationshipBaseline = Record<RelationshipKey, number>

type PersonalityModule = {
  scheme?: string
  big5?: Partial<BigFiveScores>
  speechStyle?: string
  background?: string
}

type EmotionModule = {
  scheme?: string
  baseline?: Partial<EmotionBaseline>
  decayPerTurn?: number
  analysisModel?: string | null
}

type RelationshipModule = {
  scheme?: string
  baseline?: Partial<RelationshipBaseline>
  decayPerTurn?: number
  analysisModel?: string | null
}

type MemoryModule = {
  scheme?: string
  summarizeModel?: string | null
}

export type PersonalityFormState = {
  enabled: boolean
  big5: BigFiveScores
  speechStyle: string
  background: string
}

export type EmotionFormState = {
  enabled: boolean
  baseline: EmotionBaseline
  decayPerTurn?: number
  analysisModel?: string | null
}

export type RelationshipFormState = {
  enabled: boolean
  baseline: RelationshipBaseline
  decayPerTurn?: number
  analysisModel?: string | null
}

export type MemoryFormState = {
  scheme: 'noop' | 'sqlite'
  summarizeModel: string
}

export const DEFAULT_BIG5: BigFiveScores = {
  openness: 0.5,
  conscientiousness: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  neuroticism: 0.5,
}

export const DEFAULT_EMOTION_BASELINE: EmotionBaseline = {
  mood: 0,
  energy: 0,
  stress: 0,
}

export const DEFAULT_RELATIONSHIP_BASELINE: RelationshipBaseline = {
  trust: 0.5,
  affinity: 0.4,
  familiarity: 0.1,
  respect: 0.5,
}

export const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: 'claude-sonnet-4-6',
  openrouter: 'anthropic/claude-sonnet-4.6',
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clampTrait(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.5
  }

  return Math.min(1, Math.max(0, value))
}

function clampMood(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }

  return Math.min(1, Math.max(-1, value))
}

function clampEmotionLevel(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }

  return Math.min(1, Math.max(0, value))
}

function clampRelationshipLevel(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(1, Math.max(0, value))
}

function readPersonalityModule(
  modules: Record<string, unknown> | null,
): PersonalityModule | null {
  if (!isRecord(modules)) {
    return null
  }

  const personality = modules.personality
  if (typeof personality === 'string') {
    return { scheme: personality }
  }

  return isRecord(personality) ? (personality as PersonalityModule) : null
}

export function getPersonalityFormState(
  modules: Record<string, unknown> | null,
  defaultEnabled: boolean,
): PersonalityFormState {
  const personality = readPersonalityModule(modules)

  return {
    enabled: personality ? personality.scheme !== 'noop' : defaultEnabled,
    big5: {
      openness: clampTrait(personality?.big5?.openness),
      conscientiousness: clampTrait(personality?.big5?.conscientiousness),
      extraversion: clampTrait(personality?.big5?.extraversion),
      agreeableness: clampTrait(personality?.big5?.agreeableness),
      neuroticism: clampTrait(personality?.big5?.neuroticism),
    },
    speechStyle: typeof personality?.speechStyle === 'string'
      ? personality.speechStyle
      : '',
    background: typeof personality?.background === 'string'
      ? personality.background
      : '',
  }
}

function readEmotionModule(
  modules: Record<string, unknown> | null,
): EmotionModule | null {
  if (!isRecord(modules)) {
    return null
  }

  const emotion = modules.emotion
  if (typeof emotion === 'string') {
    return { scheme: emotion }
  }

  return isRecord(emotion) ? (emotion as EmotionModule) : null
}

export function getEmotionFormState(
  modules: Record<string, unknown> | null,
  defaultEnabled: boolean,
): EmotionFormState {
  const emotion = readEmotionModule(modules)

  return {
    enabled: emotion ? emotion.scheme !== 'noop' : defaultEnabled,
    baseline: {
      mood: clampMood(emotion?.baseline?.mood),
      energy: clampEmotionLevel(emotion?.baseline?.energy),
      stress: clampEmotionLevel(emotion?.baseline?.stress),
    },
    decayPerTurn:
      typeof emotion?.decayPerTurn === 'number' ? emotion.decayPerTurn : undefined,
    analysisModel:
      typeof emotion?.analysisModel === 'string' ? emotion.analysisModel : null,
  }
}

function readRelationshipModule(
  modules: Record<string, unknown> | null,
): RelationshipModule | null {
  if (!isRecord(modules)) {
    return null
  }

  const relationship = modules.relationship
  if (typeof relationship === 'string') {
    return { scheme: relationship }
  }

  return isRecord(relationship) ? (relationship as RelationshipModule) : null
}

export function getRelationshipFormState(
  modules: Record<string, unknown> | null,
  defaultEnabled: boolean,
): RelationshipFormState {
  const relationship = readRelationshipModule(modules)

  return {
    enabled: relationship ? relationship.scheme !== 'noop' : defaultEnabled,
    baseline: {
      trust: clampRelationshipLevel(
        relationship?.baseline?.trust,
        DEFAULT_RELATIONSHIP_BASELINE.trust,
      ),
      affinity: clampRelationshipLevel(
        relationship?.baseline?.affinity,
        DEFAULT_RELATIONSHIP_BASELINE.affinity,
      ),
      familiarity: clampRelationshipLevel(
        relationship?.baseline?.familiarity,
        DEFAULT_RELATIONSHIP_BASELINE.familiarity,
      ),
      respect: clampRelationshipLevel(
        relationship?.baseline?.respect,
        DEFAULT_RELATIONSHIP_BASELINE.respect,
      ),
    },
    decayPerTurn:
      typeof relationship?.decayPerTurn === 'number' ? relationship.decayPerTurn : undefined,
    analysisModel:
      typeof relationship?.analysisModel === 'string' ? relationship.analysisModel : null,
  }
}

export function readValuePriorities(modules: Record<string, unknown> | null | undefined) {
  if (!isRecord(modules)) {
    return []
  }

  const values = modules.values
  if (!isRecord(values) || !Array.isArray(values.priorities)) {
    return []
  }

  return values.priorities
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean)
}

function readMemoryModule(
  modules: Record<string, unknown> | null,
): MemoryModule | null {
  if (!isRecord(modules)) {
    return null
  }

  const memory = modules.memory
  if (typeof memory === 'string') {
    return { scheme: memory }
  }

  return isRecord(memory) ? (memory as MemoryModule) : null
}

export function getMemoryFormState(
  modules: Record<string, unknown> | null,
): MemoryFormState {
  const memory = readMemoryModule(modules)
  const scheme = memory?.scheme === 'sqlite' ? 'sqlite' : 'noop'

  return {
    scheme,
    summarizeModel:
      typeof memory?.summarizeModel === 'string' ? memory.summarizeModel : '',
  }
}

export function stripManagedModules(modules: Record<string, unknown> | null) {
  if (!isRecord(modules)) {
    return {}
  }

  const { personality: _personality, values: _values, ...rest } = modules
  delete rest.emotion
  delete rest.relationship
  delete rest.memory
  return rest
}

export function buildModules(
  baseModules: Record<string, unknown>,
  personality: PersonalityFormState,
  emotion: EmotionFormState,
  relationship: RelationshipFormState,
  memory: MemoryFormState,
  valuePriorities: string[],
) {
  const next: Record<string, unknown> = { ...baseModules }

  next.personality = personality.enabled
    ? {
        scheme: 'big-five',
        big5: personality.big5,
        speechStyle: personality.speechStyle.trim(),
        background: personality.background.trim(),
      }
    : { scheme: 'noop' }

  next.emotion = emotion.enabled
    ? {
        scheme: 'dimensional',
        baseline: emotion.baseline,
        ...(typeof emotion.decayPerTurn === 'number'
          ? { decayPerTurn: emotion.decayPerTurn }
          : {}),
        ...(emotion.analysisModel ? { analysisModel: emotion.analysisModel } : {}),
      }
    : { scheme: 'noop' }

  next.relationship = relationship.enabled
    ? {
        scheme: 'multi-dim',
        baseline: relationship.baseline,
        ...(typeof relationship.decayPerTurn === 'number'
          ? { decayPerTurn: relationship.decayPerTurn }
          : {}),
        ...(relationship.analysisModel ? { analysisModel: relationship.analysisModel } : {}),
      }
    : { scheme: 'noop' }

  next.memory = memory.scheme === 'sqlite'
    ? {
        scheme: 'sqlite',
        ...(memory.summarizeModel.trim()
          ? { summarizeModel: memory.summarizeModel.trim() }
          : {}),
      }
    : { scheme: 'noop' }

  const priorities = valuePriorities.map(value => value.trim()).filter(Boolean)
  if (priorities.length > 0) {
    next.values = {
      scheme: 'priority-list',
      priorities,
    }
  }

  return next
}
