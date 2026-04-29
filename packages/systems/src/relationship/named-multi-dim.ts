import {
  relationshipCounterpartRepo,
  relationshipRepo,
  sessionRelationshipBindingRepo,
} from '@mas/db'
import type { AgentSystem, RelationshipCounterpartRef, RelationshipDimensions, TurnContext } from '../types'
import {
  applyRelationshipDecayAndDelta,
  buildRelationshipFragment,
  normalizeRelationshipConfig,
} from './multi-dim'
import type { RelationshipHistoryEntry } from '../types'

const MAX_HISTORY_ENTRIES = 8

function clampSigned(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }

  return Math.min(1, Math.max(-1, value))
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

function readCounterpart(ctx: TurnContext): RelationshipCounterpartRef | null {
  const binding = sessionRelationshipBindingRepo.getSessionRelationshipBinding(ctx.sessionId)
  if (!binding) {
    return null
  }

  const counterpart = relationshipCounterpartRepo.getRelationshipCounterpart(binding.counterpartId)
  if (!counterpart || counterpart.agentId !== ctx.agentId) {
    return null
  }

  return {
    id: counterpart.id,
    name: counterpart.name,
    type: 'named',
    avatarUrl: counterpart.avatarUrl,
    role: counterpart.role,
    description: counterpart.description,
    note: counterpart.note,
  }
}

function readCurrentState(ctx: TurnContext, fallback: RelationshipDimensions): RelationshipDimensions {
  const relationship = ctx.state.relationship
  if (!relationship || typeof relationship !== 'object') {
    return fallback
  }

  const record = relationship as Partial<RelationshipDimensions>
  return {
    trust: typeof record.trust === 'number' ? record.trust : fallback.trust,
    affinity: typeof record.affinity === 'number' ? record.affinity : fallback.affinity,
    familiarity: typeof record.familiarity === 'number' ? record.familiarity : fallback.familiarity,
    respect: typeof record.respect === 'number' ? record.respect : fallback.respect,
  }
}

function buildNamedAnalysisRequest(
  ctx: TurnContext,
  currentState: RelationshipDimensions,
  baseline: RelationshipDimensions,
  decayPerTurn: number,
  model: string | null,
  promptOverride: string | null,
  counterpart: RelationshipCounterpartRef,
) {
  const assistantText = Array.isArray(ctx.response?.content)
    ? ctx.response.content
        .map((block) => {
          const record = block && typeof block === 'object' ? (block as Record<string, unknown>) : null
          return typeof record?.text === 'string' ? record.text : JSON.stringify(block)
        })
        .join('\n')
    : ''

  const analysisInput = [
    `请分析这一轮已经完成的对话，应该如何改变这个 persona 面向「${counterpart.name}」的关系状态。`,
    '只输出严格 JSON。',
    '必须包含这些键：trust_delta、affinity_delta、familiarity_delta、respect_delta、trigger。',
    '所有 *_delta 的数值都必须落在 [-1, 1]。',
    '除非互动强度非常明显，否则增量要保持小幅变化。',
    '',
    `当前面对的对象：${counterpart.name}`,
    counterpart.role ? `关系角色：${counterpart.role}` : null,
    counterpart.description ? `对象描述：${counterpart.description}` : null,
    counterpart.note ? `角色主观备注：${counterpart.note}` : null,
    `当前状态：${JSON.stringify(currentState)}`,
    `基线状态：${JSON.stringify(baseline)}`,
    `每轮衰减：${decayPerTurn}`,
    '',
    '用户消息：',
    ctx.input.text || '（空）',
    '',
    '助手回复：',
    assistantText || '（空）',
  ].filter((line): line is string => line !== null).join('\n')

  return {
    kind: 'named-multi-dim' as const,
    model,
    systemPrompt:
      typeof promptOverride === 'string' && promptOverride.trim()
        ? promptOverride.trim()
        : '你负责分析单轮对话对关系状态的影响，只输出 JSON。',
    messages: [
      {
        role: 'user' as const,
        content: [{ type: 'text', text: analysisInput }],
      },
    ],
    currentState,
    baseline,
    decayPerTurn,
    counterpart,
  }
}

export class NamedMultiDimRelationshipSystem implements AgentSystem {
  name = 'relationship:named-multi-dim'
  type = 'relationship'

  private readonly config

  constructor(config?: unknown) {
    this.config = normalizeRelationshipConfig(config)
  }

  async beforeTurn(ctx: TurnContext): Promise<void> {
    const counterpart = readCounterpart(ctx)
    ctx.state.relationshipCounterpart = counterpart
    if (!counterpart) {
      delete ctx.state.relationship
      delete ctx.state.relationshipHistory
      return
    }

    const latest = relationshipRepo.getRelationship(ctx.agentId, counterpart.id, 'named')
    ctx.state.relationship = latest?.dimensions ?? this.config.baseline
    ctx.state.relationshipHistory = latest?.history ?? []
  }

  async beforeLLM(ctx: TurnContext): Promise<void> {
    const counterpart = ctx.state.relationshipCounterpart as RelationshipCounterpartRef | null | undefined
    if (!counterpart) {
      return
    }

    ctx.promptFragments.push({
      source: this.name,
      priority: 40,
      content: buildRelationshipFragment(
        readCurrentState(ctx, this.config.baseline),
        this.config.fragmentPrompt,
        counterpart.name,
        counterpart,
      ),
    })
  }

  async afterLLM(ctx: TurnContext): Promise<void> {
    if (ctx.response?.stopReason !== 'end_turn') {
      return
    }

    const counterpart = ctx.state.relationshipCounterpart as RelationshipCounterpartRef | null | undefined
    if (!counterpart) {
      return
    }

    ctx.pendingRelationshipAnalysis = buildNamedAnalysisRequest(
      ctx,
      readCurrentState(ctx, this.config.baseline),
      this.config.baseline,
      this.config.decayPerTurn,
      this.config.analysisModel,
      this.config.analysisPrompt,
      counterpart,
    )
  }

  async afterTurn(ctx: TurnContext): Promise<void> {
    const counterpart = ctx.state.relationshipCounterpart as RelationshipCounterpartRef | null | undefined
    if (!counterpart) {
      return
    }

    const currentState = readCurrentState(ctx, this.config.baseline)
    const delta = ctx.relationshipAnalysis?.delta ?? {
      trust: 0,
      affinity: 0,
      familiarity: 0,
      respect: 0,
    }

    const nextState = applyRelationshipDecayAndDelta(
      currentState,
      this.config.baseline,
      this.config.decayPerTurn,
      delta,
    )
    const latest = relationshipRepo.getRelationship(ctx.agentId, counterpart.id, 'named')
    const history = [
      ...(latest?.history ?? []),
      buildHistoryEntry(delta, ctx.relationshipAnalysis?.trigger ?? null),
    ].slice(-MAX_HISTORY_ENTRIES)

    ctx.state.relationship = nextState
    ctx.state.relationshipHistory = history

    relationshipRepo.upsertRelationship({
      agentId: ctx.agentId,
      counterpartId: counterpart.id,
      counterpartType: 'named',
      dimensions: nextState,
      history,
      updatedAt: new Date(),
    })
  }
}
