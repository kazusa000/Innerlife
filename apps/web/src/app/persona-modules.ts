export type EmotionScheme = 'noop' | 'dimensional'
export type RelationshipScheme = 'noop' | 'multi-dim'
export type MemoryScheme = 'noop' | 'sqlite'

export type EmotionBaseline = {
  mood: number
  energy: number
  stress: number
}

export type RelationshipBaseline = {
  trust: number
  affinity: number
  familiarity: number
  respect: number
}

type ManagedModuleRecord = {
  scheme?: string
  [key: string]: unknown
}

export type EmotionFormState = {
  scheme: EmotionScheme
}

export type RelationshipFormState = {
  scheme: RelationshipScheme
}

export type MemoryFormState = {
  scheme: MemoryScheme
}

export const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: 'claude-sonnet-4-6',
  openrouter: 'anthropic/claude-sonnet-4.6',
} as const

export const DEFAULT_EMOTION_BASELINE: EmotionBaseline = {
  mood: 0.15,
  energy: 0.62,
  stress: 0.22,
}

export const DEFAULT_RELATIONSHIP_BASELINE: RelationshipBaseline = {
  trust: 0.5,
  affinity: 0.4,
  familiarity: 0.1,
  respect: 0.5,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readModule(
  modules: Record<string, unknown> | null | undefined,
  key: string,
): ManagedModuleRecord | null {
  const value = modules?.[key]
  if (typeof value === 'string') {
    return { scheme: value }
  }

  return isRecord(value) ? (value as ManagedModuleRecord) : null
}

function normalizeScheme<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value === 'string' && allowed.includes(value as T)) {
    return value as T
  }

  return fallback
}

export function getEmotionFormState(
  modules: Record<string, unknown> | null,
  fallback: EmotionScheme,
): EmotionFormState {
  const emotion = readModule(modules, 'emotion')
  return {
    scheme: normalizeScheme(emotion?.scheme, ['noop', 'dimensional'], fallback),
  }
}

export function getRelationshipFormState(
  modules: Record<string, unknown> | null,
  fallback: RelationshipScheme,
): RelationshipFormState {
  const relationship = readModule(modules, 'relationship')
  return {
    scheme: normalizeScheme(relationship?.scheme, ['noop', 'multi-dim'], fallback),
  }
}

export function getMemoryFormState(
  modules: Record<string, unknown> | null,
): MemoryFormState {
  const memory = readModule(modules, 'memory')
  return {
    scheme: normalizeScheme(memory?.scheme, ['noop', 'sqlite'], 'noop'),
  }
}

function applyScheme(
  current: unknown,
  scheme: string,
): Record<string, unknown> {
  if (scheme === 'noop') {
    return { scheme: 'noop' }
  }

  if (isRecord(current)) {
    return { ...current, scheme }
  }

  return { scheme }
}

export function buildModules(
  baseModules: Record<string, unknown> | null | undefined,
  emotion: EmotionFormState,
  relationship: RelationshipFormState,
  memory: MemoryFormState,
) {
  const next: Record<string, unknown> = isRecord(baseModules) ? { ...baseModules } : {}

  delete next.values

  next.emotion = applyScheme(next.emotion, emotion.scheme)
  next.relationship = applyScheme(next.relationship, relationship.scheme)
  next.memory = applyScheme(next.memory, memory.scheme)

  return next
}
