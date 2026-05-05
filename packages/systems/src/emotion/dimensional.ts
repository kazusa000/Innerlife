import { emotionStateRepo } from '@mas/db'
import type {
  AgentSystem,
  ConversationMessage,
  EmotionAnalysisResult,
  EmotionStateVector,
  PendingEmotionAnalysis,
  TurnContext,
} from '../types'

interface EmotionConfig {
  scheme?: string
  baseline?: Partial<EmotionStateVector>
  decayPerTurn?: number
  analysisModel?: string | null
  fragmentPrompt?: string | null
  fragmentPromptByLocale?: Partial<Record<'zh-CN' | 'en-US', string>>
  analysisPrompt?: string | null
  analysisPromptByLocale?: Partial<Record<'zh-CN' | 'en-US', string>>
}
type AppLocale = 'zh-CN' | 'en-US'

const DEFAULT_BASELINE: EmotionStateVector = {
  mood: 0,
  energy: 0,
  stress: 0,
}

function clampMood(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(1, Math.max(-1, value))
}

function clampLevel(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(1, Math.max(0, value))
}

function clampDecay(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.1
  }

  return Math.min(1, Math.max(0, value))
}

function normalizeStateVector(value: Partial<EmotionStateVector> | undefined): EmotionStateVector {
  return {
    mood: clampMood(value?.mood, DEFAULT_BASELINE.mood),
    energy: clampLevel(value?.energy, DEFAULT_BASELINE.energy),
    stress: clampLevel(value?.stress, DEFAULT_BASELINE.stress),
  }
}

function readLocalizedPrompt(
  record: EmotionConfig,
  key: 'fragmentPrompt' | 'analysisPrompt',
  locale: AppLocale,
) {
  const localized = record[`${key}ByLocale`]
  const localizedText = localized?.[locale]
  if (typeof localizedText === 'string' && localizedText.trim()) {
    return localizedText.trim()
  }
  const legacy = record[key]
  return locale === 'zh-CN' && typeof legacy === 'string' && legacy.trim()
    ? legacy.trim()
    : null
}

function normalizeConfig(config: unknown, locale: AppLocale = 'zh-CN') {
  const record = config && typeof config === 'object'
    ? (config as EmotionConfig)
    : {}

  return {
    baseline: normalizeStateVector(record.baseline),
    decayPerTurn: clampDecay(record.decayPerTurn),
    analysisModel:
      typeof record.analysisModel === 'string' && record.analysisModel.trim()
        ? record.analysisModel.trim()
        : null,
    fragmentPrompt:
      readLocalizedPrompt(record, 'fragmentPrompt', locale),
    analysisPrompt:
      readLocalizedPrompt(record, 'analysisPrompt', locale),
  }
}

function extractConversationText(content: ConversationMessage['content']): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .map((block) => {
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text
      }

      return JSON.stringify(block)
    })
    .join('\n')
}

function renderMood(value: number): string {
  if (value <= -0.65) return '明显低落'
  if (value <= -0.2) return '略微低落'
  if (value < 0.2) return '基本平稳'
  if (value < 0.65) return '略微愉快'
  return '明显愉快'
}

function renderEnergy(value: number): string {
  if (value < 0.2) return '很低'
  if (value < 0.45) return '偏低'
  if (value < 0.75) return '中等'
  return '充沛'
}

function renderStress(value: number): string {
  if (value < 0.2) return '很低'
  if (value < 0.45) return '偏低'
  if (value < 0.75) return '偏高'
  return '很高'
}

function readCurrentState(ctx: TurnContext, fallback: EmotionStateVector): EmotionStateVector {
  const emotion = ctx.state.emotion
  if (!emotion || typeof emotion !== 'object') {
    return fallback
  }

  const record = emotion as Partial<EmotionStateVector>
  return normalizeStateVector(record)
}

function buildEmotionFragment(
  state: EmotionStateVector,
  promptOverride?: string | null,
  locale: AppLocale = 'zh-CN',
): string {
  const defaultPrompt = locale === 'en-US'
    ? 'Let these states subtly influence tone, but do not recite the numbers or explain that you are "simulating emotion".'
    : '回答时让这些状态产生轻微影响，但不要生硬复述数值或直接解释自己在“模拟情绪”。'
  if (promptOverride?.trim()) {
    if (locale === 'en-US') {
      return [
        'Current emotional state reference:',
        `- mood: ${renderMood(state.mood)} (${state.mood.toFixed(2)})`,
        `- energy: ${renderEnergy(state.energy)} (${state.energy.toFixed(2)})`,
        `- stress: ${renderStress(state.stress)} (${state.stress.toFixed(2)})`,
        promptOverride.trim(),
      ].join('\n')
    }
    return [
      '当前情绪状态参考：',
      `- 心情 mood：${renderMood(state.mood)}（${state.mood.toFixed(2)}）`,
      `- 精力 energy：${renderEnergy(state.energy)}（${state.energy.toFixed(2)}）`,
      `- 压力 stress：${renderStress(state.stress)}（${state.stress.toFixed(2)}）`,
      promptOverride.trim(),
    ].join('\n')
  }

  return [
    locale === 'en-US' ? 'Current emotion (changes over conversation):' : '当前情绪（会随对话变化）：',
    locale === 'en-US' ? `- mood: ${renderMood(state.mood)} (${state.mood.toFixed(2)})` : `- 心情 mood：${renderMood(state.mood)}（${state.mood.toFixed(2)}）`,
    locale === 'en-US' ? `- energy: ${renderEnergy(state.energy)} (${state.energy.toFixed(2)})` : `- 精力 energy：${renderEnergy(state.energy)}（${state.energy.toFixed(2)}）`,
    locale === 'en-US' ? `- stress: ${renderStress(state.stress)} (${state.stress.toFixed(2)})` : `- 压力 stress：${renderStress(state.stress)}（${state.stress.toFixed(2)}）`,
    `- ${defaultPrompt}`,
  ].join('\n')
}

function buildEmotionAnalysisPrompt(promptOverride?: string | null, locale: AppLocale = 'zh-CN'): string {
  return promptOverride?.trim()
    ? promptOverride.trim()
    : locale === 'en-US'
      ? 'Analyze how one completed turn affects the emotional state. Output JSON only.'
      : '你负责分析单轮对话对情绪状态的影响，只输出 JSON。'
}

function buildAnalysisRequest(
  ctx: TurnContext,
  currentState: EmotionStateVector,
  baseline: EmotionStateVector,
  decayPerTurn: number,
  model: string | null,
  promptOverride?: string | null,
  locale: AppLocale = 'zh-CN',
): PendingEmotionAnalysis {
  const assistantText = ctx.response
    ? extractConversationText(ctx.response.content as ConversationMessage['content'])
    : ''

  const analysisInput = [
    locale === 'en-US' ? 'Analyze the completed turn and decide how it should change this persona emotional state.' : '请分析这一轮已经完成的对话，应该如何改变这个 persona 的情绪状态。',
    locale === 'en-US' ? 'Output strict JSON only.' : '只输出严格 JSON。',
    locale === 'en-US' ? 'Must include these keys: mood_delta, energy_delta, stress_delta, trigger.' : '必须包含这些键：mood_delta、energy_delta、stress_delta、trigger。',
    locale === 'en-US' ? 'All deltas must be in [-1, 1].' : 'mood_delta 必须落在 [-1, 1]。',
    locale === 'en-US' ? 'Unless interaction intensity is obvious, keep deltas small.' : '除非互动强度非常明显，否则增量要保持小幅变化。',
    '',
    `${locale === 'en-US' ? 'Current state' : '当前状态'}：${JSON.stringify(currentState)}`,
    `${locale === 'en-US' ? 'Baseline state' : '基线状态'}：${JSON.stringify(baseline)}`,
    `${locale === 'en-US' ? 'Decay per turn' : '每轮衰减'}：${decayPerTurn}`,
    '',
    locale === 'en-US' ? 'User message:' : '用户消息：',
    ctx.input.text || (locale === 'en-US' ? '(empty)' : '（空）'),
    '',
    locale === 'en-US' ? 'Assistant reply:' : '助手回复：',
    assistantText || (locale === 'en-US' ? '(empty)' : '（空）'),
  ].join('\n')

  return {
    kind: 'dimensional',
    model,
    systemPrompt: buildEmotionAnalysisPrompt(promptOverride, locale),
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: analysisInput }],
      },
    ],
    currentState,
    baseline,
    decayPerTurn,
  }
}

function applyDecayAndDelta(
  currentState: EmotionStateVector,
  baseline: EmotionStateVector,
  decayPerTurn: number,
  delta: EmotionStateVector,
): EmotionStateVector {
  return {
    mood: clampMood(
      currentState.mood + (baseline.mood - currentState.mood) * decayPerTurn + delta.mood,
      baseline.mood,
    ),
    energy: clampLevel(
      currentState.energy + (baseline.energy - currentState.energy) * decayPerTurn + delta.energy,
      baseline.energy,
    ),
    stress: clampLevel(
      currentState.stress + (baseline.stress - currentState.stress) * decayPerTurn + delta.stress,
      baseline.stress,
    ),
  }
}

export class DimensionalEmotionSystem implements AgentSystem {
  name = 'emotion:dimensional'
  type = 'emotion'

  private readonly config
  private readonly locale: AppLocale

  constructor(config?: unknown, locale: AppLocale = 'zh-CN') {
    this.locale = locale
    this.config = normalizeConfig(config, locale)
  }

  async beforeTurn(ctx: TurnContext): Promise<void> {
    const latest = emotionStateRepo.getLatestEmotionStateByAgent(ctx.agentId)
    ctx.state.emotion = latest?.state ?? this.config.baseline
  }

  async beforeLLM(ctx: TurnContext): Promise<void> {
    const currentState = readCurrentState(ctx, this.config.baseline)

    ctx.promptFragments.push({
      source: this.name,
      priority: 20,
      content: buildEmotionFragment(currentState, this.config.fragmentPrompt, this.locale),
    })
  }

  async afterLLM(ctx: TurnContext): Promise<void> {
    if (ctx.response?.stopReason !== 'end_turn') {
      return
    }

    const currentState = readCurrentState(ctx, this.config.baseline)
    ctx.pendingEmotionAnalysis = buildAnalysisRequest(
      ctx,
      currentState,
      this.config.baseline,
      this.config.decayPerTurn,
      this.config.analysisModel,
      this.config.analysisPrompt,
      this.locale,
    )
  }

  async afterTurn(ctx: TurnContext): Promise<void> {
    const currentState = readCurrentState(ctx, this.config.baseline)
    const delta = ctx.emotionAnalysis?.delta ?? {
      mood: 0,
      energy: 0,
      stress: 0,
    }

    const nextState = applyDecayAndDelta(
      currentState,
      this.config.baseline,
      this.config.decayPerTurn,
      delta,
    )

    ctx.state.emotion = nextState

    emotionStateRepo.addEmotionState({
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      state: nextState,
      delta: ctx.emotionAnalysis?.delta ?? null,
      trigger: ctx.emotionAnalysis?.trigger ?? null,
    })
  }
}

function clampSigned(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }

  return Math.min(1, Math.max(-1, value))
}

export function parseEmotionAnalysis(rawResponse: string): EmotionAnalysisResult {
  const trimmed = rawResponse.trim()
  const withoutFence = trimmed.startsWith('```')
    ? trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    : trimmed
  const record = JSON.parse(withoutFence) as {
    mood_delta?: unknown
    energy_delta?: unknown
    stress_delta?: unknown
    trigger?: unknown
  }

  return {
    delta: {
      mood: clampSigned(record.mood_delta),
      energy: clampSigned(record.energy_delta),
      stress: clampSigned(record.stress_delta),
    },
    trigger:
      typeof record.trigger === 'string' && record.trigger.trim()
        ? record.trigger.trim()
        : null,
    rawResponse: withoutFence,
  }
}

export function serializeEmotionState(state: EmotionStateVector) {
  const round = (value: number) => Number(value.toFixed(3))

  return {
    mood: round(state.mood),
    energy: round(state.energy),
    stress: round(state.stress),
  }
}

export {
  DEFAULT_BASELINE,
  applyDecayAndDelta,
  buildEmotionAnalysisPrompt,
  buildEmotionFragment,
  normalizeConfig,
  normalizeStateVector,
}
