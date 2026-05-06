import { relationshipRepo } from '@mas/db'
import type {
  AgentSystem,
  ConversationMessage,
  PendingRelationshipAnalysis,
  RelationshipAnalysisResult,
  RelationshipCounterpartRef,
  RelationshipDimensions,
  RelationshipHistoryEntry,
  TurnContext,
} from '../types'

export const DEFAULT_BASELINE: RelationshipDimensions = {
  trust: 0.5,
  affinity: 0.4,
  familiarity: 0.1,
  respect: 0.5,
}

export const DEFAULT_COUNTERPART_ID = 'default-user'
const MAX_HISTORY_ENTRIES = 8

interface RelationshipConfig {
  scheme?: string
  baseline?: Partial<RelationshipDimensions>
  decayPerTurn?: number
  analysisModel?: string | null
  fragmentPrompt?: string | null
  fragmentPromptByLocale?: Partial<Record<'zh-CN' | 'en-US', string>>
  analysisPrompt?: string | null
  analysisPromptByLocale?: Partial<Record<'zh-CN' | 'en-US', string>>
}
type AppLocale = 'zh-CN' | 'en-US'

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

function normalizeDimensions(value: Partial<RelationshipDimensions> | undefined): RelationshipDimensions {
  return {
    trust: clampUnit(value?.trust, DEFAULT_BASELINE.trust),
    affinity: clampUnit(value?.affinity, DEFAULT_BASELINE.affinity),
    familiarity: clampUnit(value?.familiarity, DEFAULT_BASELINE.familiarity),
    respect: clampUnit(value?.respect, DEFAULT_BASELINE.respect),
  }
}

function readLocalizedPrompt(
  record: RelationshipConfig,
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
    ? (config as RelationshipConfig)
    : {}

  return {
    baseline: normalizeDimensions(record.baseline),
    decayPerTurn: clampDecay(record.decayPerTurn),
    analysisModel:
      typeof record.analysisModel === 'string' && record.analysisModel.trim()
        ? record.analysisModel.trim()
        : null,
    fragmentPrompt: readLocalizedPrompt(record, 'fragmentPrompt', locale),
    analysisPrompt: readLocalizedPrompt(record, 'analysisPrompt', locale),
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

export function buildRelationshipFragment(
  state: RelationshipDimensions,
  promptOverride?: string | null,
  counterpartName = '用户',
  counterpart?: Pick<RelationshipCounterpartRef, 'role' | 'description' | 'note'> | null,
  locale: AppLocale = 'zh-CN',
): string {
  const defaultPrompt = locale === 'en-US'
    ? 'Let these relationship states subtly influence tone, patience, closeness, and wording, but do not recite the values or say you are "simulating relationship scores".'
    : '让这些关系状态轻微影响语气、耐心、亲疏感和措辞，但不要直接复述数值，也不要声称自己在“模拟关系分数”。'
  const profileLines = [
    counterpart?.role ? `- ${locale === 'en-US' ? 'Relationship role' : '关系角色'}：${counterpart.role}` : null,
    counterpart?.description ? `- ${locale === 'en-US' ? 'Counterpart description' : '对象描述'}：${counterpart.description}` : null,
    counterpart?.note ? `- ${locale === 'en-US' ? 'Persona note' : '角色主观备注'}：${counterpart.note}` : null,
  ].filter((line): line is string => Boolean(line))
  if (promptOverride?.trim()) {
    if (locale === 'en-US') {
      return [
        `Current relationship state reference with ${counterpartName}:`,
        `Current conversation counterpart: ${counterpartName}`,
        ...profileLines,
        `- trust: ${renderTrust(state.trust)} (${state.trust.toFixed(2)})`,
        `- affinity: ${renderAffinity(state.affinity)} (${state.affinity.toFixed(2)})`,
        `- familiarity: ${renderFamiliarity(state.familiarity)} (${state.familiarity.toFixed(2)})`,
        `- respect: ${renderRespect(state.respect)} (${state.respect.toFixed(2)})`,
        promptOverride.trim(),
      ].join('\n')
    }
    return [
      `当前你与${counterpartName}的关系状态参考：`,
      `当前谈话对象：${counterpartName}`,
      ...profileLines,
      `- trust：${renderTrust(state.trust)}（${state.trust.toFixed(2)}）`,
      `- affinity：${renderAffinity(state.affinity)}（${state.affinity.toFixed(2)}）`,
      `- familiarity：${renderFamiliarity(state.familiarity)}（${state.familiarity.toFixed(2)}）`,
      `- respect：${renderRespect(state.respect)}（${state.respect.toFixed(2)}）`,
      promptOverride.trim(),
    ].join('\n')
  }

  return [
    locale === 'en-US'
      ? `Current relationship state with ${counterpartName} (changes slowly through interaction):`
      : `当前你与${counterpartName}的关系状态（会随互动缓慢变化）：`,
    locale === 'en-US' ? `Current conversation counterpart: ${counterpartName}` : `当前谈话对象：${counterpartName}`,
    ...profileLines,
    `- trust：${renderTrust(state.trust)}（${state.trust.toFixed(2)}）`,
    `- affinity：${renderAffinity(state.affinity)}（${state.affinity.toFixed(2)}）`,
    `- familiarity：${renderFamiliarity(state.familiarity)}（${state.familiarity.toFixed(2)}）`,
    `- respect：${renderRespect(state.respect)}（${state.respect.toFixed(2)}）`,
    `- ${defaultPrompt}`,
  ].join('\n')
}

function buildRelationshipAnalysisPrompt(promptOverride?: string | null, locale: AppLocale = 'zh-CN'): string {
  return promptOverride?.trim()
    ? promptOverride.trim()
    : locale === 'en-US'
      ? 'Analyze how one completed turn affects the relationship state. Output JSON only.'
      : '你负责分析单轮对话对关系状态的影响，只输出 JSON。'
}

function readCurrentState(ctx: TurnContext, fallback: RelationshipDimensions): RelationshipDimensions {
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
  promptOverride?: string | null,
  input?: {
    kind?: PendingRelationshipAnalysis['kind']
    counterpart?: RelationshipCounterpartRef | null
  },
  locale: AppLocale = 'zh-CN',
): PendingRelationshipAnalysis {
  const assistantText = ctx.response
    ? extractConversationText(ctx.response.content as ConversationMessage['content'])
    : ''
  const counterpartName = input?.counterpart?.name ?? (locale === 'en-US' ? 'current user' : '当前用户')

  const analysisInput = [
    locale === 'en-US' ? 'Analyze the completed turn and decide how it should change this persona relationship state toward the current user.' : '请分析这一轮已经完成的对话，应该如何改变这个 persona 面向当前用户的关系状态。',
    locale === 'en-US' ? 'Output strict JSON only.' : '只输出严格 JSON。',
    locale === 'en-US' ? 'Must include these keys: trust_delta, affinity_delta, familiarity_delta, respect_delta, trigger.' : '必须包含这些键：trust_delta、affinity_delta、familiarity_delta、respect_delta、trigger。',
    locale === 'en-US' ? 'All *_delta values must be in [-1, 1].' : '所有 *_delta 的数值都必须落在 [-1, 1]。',
    locale === 'en-US' ? 'Unless interaction intensity is obvious, keep deltas small.' : '除非互动强度非常明显，否则增量要保持小幅变化。',
    '',
    `${locale === 'en-US' ? 'Current counterpart' : '当前面对的对象'}：${counterpartName}`,
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
    kind: input?.kind ?? 'multi-dim',
    model,
    systemPrompt: buildRelationshipAnalysisPrompt(promptOverride, locale),
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: analysisInput }],
      },
    ],
    currentState,
    baseline,
    decayPerTurn,
    counterpart: input?.counterpart ?? null,
  }
}

export function applyRelationshipDecayAndDelta(
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
  private readonly locale: AppLocale

  constructor(config?: unknown, locale: AppLocale = 'zh-CN') {
    this.locale = locale
    this.config = normalizeConfig(config, locale)
  }

  async beforeTurn(ctx: TurnContext): Promise<void> {
    const latest = relationshipRepo.getRelationship(ctx.agentId, DEFAULT_COUNTERPART_ID)
    ctx.state.relationship = latest?.dimensions ?? this.config.baseline
    ctx.state.relationshipHistory = latest?.history ?? []
  }

  async beforeLLM(ctx: TurnContext): Promise<void> {
    ctx.promptFragments.push({
      source: this.name,
      priority: 40,
      content: buildRelationshipFragment(
        readCurrentState(ctx, this.config.baseline),
        this.config.fragmentPrompt,
        this.locale === 'en-US' ? 'user' : '用户',
        null,
        this.locale,
      ),
    })
  }

  async afterLLM(ctx: TurnContext): Promise<void> {
    if (ctx.response?.stopReason !== 'end_turn') {
      return
    }

    ctx.pendingRelationshipAnalysis = buildAnalysisRequest(
      ctx,
      readCurrentState(ctx, this.config.baseline),
      this.config.baseline,
      this.config.decayPerTurn,
      this.config.analysisModel,
      this.config.analysisPrompt,
      { kind: 'multi-dim', counterpart: { id: DEFAULT_COUNTERPART_ID, name: this.locale === 'en-US' ? 'user' : '用户', type: 'user' } },
      this.locale,
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
    const nextState = applyRelationshipDecayAndDelta(
      currentState,
      this.config.baseline,
      this.config.decayPerTurn,
      delta,
    )
    const latest = relationshipRepo.getRelationship(ctx.agentId, DEFAULT_COUNTERPART_ID)
    const history = [
      ...(latest?.history ?? []),
      buildHistoryEntry(delta, ctx.relationshipAnalysis?.trigger ?? null),
    ].slice(-MAX_HISTORY_ENTRIES)

    ctx.state.relationship = nextState
    ctx.state.relationshipHistory = history

    relationshipRepo.upsertRelationship({
      agentId: ctx.agentId,
      counterpartId: DEFAULT_COUNTERPART_ID,
      dimensions: nextState,
      history,
      updatedAt: new Date(),
    })
  }
}

export function parseRelationshipAnalysis(rawResponse: string): RelationshipAnalysisResult {
  const trimmed = rawResponse.trim()
  const withoutFence = trimmed.startsWith('```')
    ? trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    : trimmed
  const record = JSON.parse(withoutFence) as {
    trust_delta?: unknown
    affinity_delta?: unknown
    familiarity_delta?: unknown
    respect_delta?: unknown
    trigger?: unknown
  }

  return {
    delta: {
      trust: clampSigned(record.trust_delta),
      affinity: clampSigned(record.affinity_delta),
      familiarity: clampSigned(record.familiarity_delta),
      respect: clampSigned(record.respect_delta),
    },
    trigger:
      typeof record.trigger === 'string' && record.trigger.trim()
        ? record.trigger.trim()
        : null,
    rawResponse: withoutFence,
  }
}

export function serializeRelationshipState(state: RelationshipDimensions) {
  const round = (value: number) => Number(value.toFixed(3))

  return {
    trust: round(state.trust),
    affinity: round(state.affinity),
    familiarity: round(state.familiarity),
    respect: round(state.respect),
  }
}

export {
  buildRelationshipAnalysisPrompt,
  normalizeConfig as normalizeRelationshipConfig,
  normalizeDimensions as normalizeRelationshipState,
}
