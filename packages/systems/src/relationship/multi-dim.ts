import { relationshipRepo } from '@mas/db'
import type {
  AgentSystem,
  ConversationMessage,
  PendingRelationshipAnalysis,
  RelationshipDimensions,
  RelationshipHistoryEntry,
  TurnContext,
} from '../types'

const DEFAULT_BASELINE: RelationshipDimensions = {
  trust: 0.5,
  affinity: 0.4,
  familiarity: 0.1,
  respect: 0.5,
}

const DEFAULT_COUNTERPART_ID = 'default-user'
const MAX_HISTORY_ENTRIES = 8

interface RelationshipConfig {
  scheme?: string
  baseline?: Partial<RelationshipDimensions>
  decayPerTurn?: number
  analysisModel?: string | null
}

function clampUnit(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }

  return Number(Math.min(1, Math.max(0, value)).toFixed(6))
}

function clampSigned(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }

  return Math.min(1, Math.max(-1, value))
}

function clampDecay(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.05
  }

  return Math.min(1, Math.max(0, value))
}

function normalizeDimensions(
  value: Partial<RelationshipDimensions> | undefined,
): RelationshipDimensions {
  return {
    trust: clampUnit(value?.trust, DEFAULT_BASELINE.trust),
    affinity: clampUnit(value?.affinity, DEFAULT_BASELINE.affinity),
    familiarity: clampUnit(value?.familiarity, DEFAULT_BASELINE.familiarity),
    respect: clampUnit(value?.respect, DEFAULT_BASELINE.respect),
  }
}

function normalizeConfig(config: unknown) {
  const record = config && typeof config === 'object'
    ? (config as RelationshipConfig)
    : {}

  return {
    baseline: normalizeDimensions(record.baseline),
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

function renderTrust(value: number): string {
  if (value < 0.2) return '几乎不信任'
  if (value < 0.45) return '信任偏低'
  if (value < 0.75) return '基本信任'
  return '高度信任'
}

function renderAffinity(value: number): string {
  if (value < 0.2) return '亲和度很低'
  if (value < 0.45) return '亲和度偏低'
  if (value < 0.75) return '亲和度较高'
  return '亲和度很高'
}

function renderFamiliarity(value: number): string {
  if (value < 0.2) return '熟悉度较低'
  if (value < 0.45) return '开始熟悉'
  if (value < 0.75) return '已经比较熟悉'
  return '非常熟悉'
}

function renderRespect(value: number): string {
  if (value < 0.2) return '尊重感很低'
  if (value < 0.45) return '尊重感偏低'
  if (value < 0.75) return '基本尊重'
  return '尊重感很高'
}

function buildRelationshipFragment(state: RelationshipDimensions): string {
  return [
    '当前你与用户的关系状态（会随互动缓慢变化）：',
    `- trust：${renderTrust(state.trust)}（${state.trust.toFixed(2)}）`,
    `- affinity：${renderAffinity(state.affinity)}（${state.affinity.toFixed(2)}）`,
    `- familiarity：${renderFamiliarity(state.familiarity)}（${state.familiarity.toFixed(2)}）`,
    `- respect：${renderRespect(state.respect)}（${state.respect.toFixed(2)}）`,
    '- 让这些关系状态轻微影响语气、耐心、亲疏感和措辞，但不要直接复述数值，也不要声称自己在“模拟关系分数”。',
  ].join('\n')
}

function readCurrentState(
  ctx: TurnContext,
  fallback: RelationshipDimensions,
): RelationshipDimensions {
  const relationship = ctx.state.relationship
  if (!relationship || typeof relationship !== 'object') {
    return fallback
  }

  return normalizeDimensions(relationship as Partial<RelationshipDimensions>)
}

function buildAnalysisRequest(
  ctx: TurnContext,
  currentState: RelationshipDimensions,
  baseline: RelationshipDimensions,
  decayPerTurn: number,
  model: string | null,
): PendingRelationshipAnalysis {
  const assistantText = ctx.response
    ? extractConversationText(ctx.response.content as ConversationMessage['content'])
    : ''

  const analysisInput = [
    'Analyze how this single completed turn should change the persona relationship state toward the current user.',
    'Return strict JSON only.',
    'Required keys: trust_delta, affinity_delta, familiarity_delta, respect_delta, trigger.',
    'All *_delta values must be numbers in [-1, 1].',
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
    kind: 'multi-dim',
    model,
    systemPrompt: 'You analyze conversational relationship impact. Output JSON only.',
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
  currentState: RelationshipDimensions,
  baseline: RelationshipDimensions,
  decayPerTurn: number,
  delta: RelationshipDimensions,
): RelationshipDimensions {
  return {
    trust: clampUnit(
      currentState.trust + (baseline.trust - currentState.trust) * decayPerTurn + delta.trust,
      baseline.trust,
    ),
    affinity: clampUnit(
      currentState.affinity + (baseline.affinity - currentState.affinity) * decayPerTurn + delta.affinity,
      baseline.affinity,
    ),
    familiarity: clampUnit(
      currentState.familiarity
        + (baseline.familiarity - currentState.familiarity) * decayPerTurn
        + delta.familiarity,
      baseline.familiarity,
    ),
    respect: clampUnit(
      currentState.respect + (baseline.respect - currentState.respect) * decayPerTurn + delta.respect,
      baseline.respect,
    ),
  }
}

function buildHistoryEntry(
  delta: RelationshipDimensions,
  trigger: string | null,
): RelationshipHistoryEntry {
  const changes = [
    { name: 'trust', value: delta.trust },
    { name: 'affinity', value: delta.affinity },
    { name: 'familiarity', value: delta.familiarity },
    { name: 'respect', value: delta.respect },
  ]
    .filter(({ value }) => Math.abs(value) >= 0.05)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 2)
    .map(({ name, value }) => `${name} ${value > 0 ? 'up' : 'down'}`)

  return {
    summary: changes.length > 0
      ? `Relationship updated: ${changes.join(', ')}`
      : 'Relationship stayed roughly stable',
    trigger,
    delta: {
      trust: clampSigned(delta.trust),
      affinity: clampSigned(delta.affinity),
      familiarity: clampSigned(delta.familiarity),
      respect: clampSigned(delta.respect),
    },
    createdAt: new Date().toISOString(),
  }
}

export class MultiDimRelationshipSystem implements AgentSystem {
  name = 'relationship:multi-dim'
  type = 'relationship'

  private readonly config

  constructor(config?: unknown) {
    this.config = normalizeConfig(config)
  }

  async beforeTurn(ctx: TurnContext): Promise<void> {
    const latest = relationshipRepo.getRelationship(ctx.agentId, 'user', DEFAULT_COUNTERPART_ID)
    ctx.state.relationship = latest?.dimensions ?? this.config.baseline
    ctx.state.relationshipHistory = latest?.history ?? []
  }

  async beforeLLM(ctx: TurnContext): Promise<void> {
    const currentState = readCurrentState(ctx, this.config.baseline)

    ctx.promptFragments.push({
      source: this.name,
      priority: 40,
      content: buildRelationshipFragment(currentState),
    })
  }

  async afterLLM(ctx: TurnContext): Promise<void> {
    if (ctx.response?.stopReason !== 'end_turn') {
      return
    }

    const currentState = readCurrentState(ctx, this.config.baseline)
    ctx.pendingRelationshipAnalysis = buildAnalysisRequest(
      ctx,
      currentState,
      this.config.baseline,
      this.config.decayPerTurn,
      this.config.analysisModel,
    )
  }

  async afterTurn(ctx: TurnContext): Promise<void> {
    const currentState = readCurrentState(ctx, this.config.baseline)
    const delta = ctx.relationshipAnalysis?.delta ?? {
      trust: 0,
      affinity: 0,
      familiarity: 0,
      respect: 0,
    }

    const nextState = applyDecayAndDelta(
      currentState,
      this.config.baseline,
      this.config.decayPerTurn,
      delta,
    )
    const existing = relationshipRepo.getRelationship(ctx.agentId, 'user', DEFAULT_COUNTERPART_ID)
    const history = [
      ...(existing?.history ?? []),
      buildHistoryEntry(delta, ctx.relationshipAnalysis?.trigger ?? null),
    ].slice(-MAX_HISTORY_ENTRIES)

    ctx.state.relationship = nextState
    ctx.state.relationshipHistory = history

    relationshipRepo.upsertRelationship({
      agentId: ctx.agentId,
      counterpartType: 'user',
      counterpartId: DEFAULT_COUNTERPART_ID,
      dimensions: nextState,
      history,
      updatedAt: new Date(),
    })
  }
}

export {
  DEFAULT_BASELINE,
  DEFAULT_COUNTERPART_ID,
  applyDecayAndDelta,
  buildRelationshipFragment,
  normalizeConfig as normalizeRelationshipConfig,
  normalizeDimensions as normalizeRelationshipState,
}
