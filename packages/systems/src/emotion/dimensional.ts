import { emotionStateRepo } from '@mas/db'
import type {
  AgentSystem,
  ConversationMessage,
  EmotionStateVector,
  PendingEmotionAnalysis,
  TurnContext,
} from '../types'

interface EmotionConfig {
  scheme?: string
  baseline?: Partial<EmotionStateVector>
  decayPerTurn?: number
  analysisModel?: string | null
}

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

function normalizeConfig(config: unknown) {
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

function buildEmotionFragment(state: EmotionStateVector): string {
  return [
    '当前情绪（会随对话变化）：',
    `- 心情 mood：${renderMood(state.mood)}（${state.mood.toFixed(2)}）`,
    `- 精力 energy：${renderEnergy(state.energy)}（${state.energy.toFixed(2)}）`,
    `- 压力 stress：${renderStress(state.stress)}（${state.stress.toFixed(2)}）`,
    '- 回答时让这些状态产生轻微影响，但不要生硬复述数值或直接解释自己在“模拟情绪”。',
  ].join('\n')
}

function buildAnalysisRequest(
  ctx: TurnContext,
  currentState: EmotionStateVector,
  baseline: EmotionStateVector,
  decayPerTurn: number,
  model: string | null,
): PendingEmotionAnalysis {
  const assistantText = ctx.response
    ? extractConversationText(ctx.response.content as ConversationMessage['content'])
    : ''

  const analysisInput = [
    'Analyze how this single completed turn should change the persona emotion state.',
    'Return strict JSON only.',
    'Required keys: mood_delta, energy_delta, stress_delta, trigger.',
    'mood_delta must be in [-1, 1].',
    'energy_delta and stress_delta must be in [-1, 1].',
    'Use small deltas unless the interaction is clearly strong.',
    '',
    `Current state: ${JSON.stringify(currentState)}`,
    `Baseline: ${JSON.stringify(baseline)}`,
    `Decay per turn: ${decayPerTurn}`,
    '',
    'User message:',
    ctx.input.text || '(empty)',
    '',
    'Assistant reply:',
    assistantText || '(empty)',
  ].join('\n')

  return {
    kind: 'dimensional',
    model,
    systemPrompt: 'You analyze conversational emotional impact. Output JSON only.',
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

  constructor(config?: unknown) {
    this.config = normalizeConfig(config)
  }

  async beforeTurn(ctx: TurnContext): Promise<void> {
    const latest = emotionStateRepo.getLatestEmotionState(ctx.agentId, ctx.sessionId)
    ctx.state.emotion = latest?.state ?? this.config.baseline
  }

  async beforeLLM(ctx: TurnContext): Promise<void> {
    const currentState = readCurrentState(ctx, this.config.baseline)

    ctx.promptFragments.push({
      source: this.name,
      priority: 20,
      content: buildEmotionFragment(currentState),
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

export {
  DEFAULT_BASELINE,
  applyDecayAndDelta,
  buildEmotionFragment,
  normalizeConfig,
  normalizeStateVector,
}
