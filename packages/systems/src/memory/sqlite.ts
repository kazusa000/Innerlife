import { memoryRepo } from '@mas/db'
import type {
  AgentSystem,
  MemoryRecord,
  MemoryQueryResult,
  PendingMemoryQuery,
  MemoryWriteResult,
  PendingMemoryWrite,
  TurnContext,
} from '../types'

const DEFAULT_RETRIEVE_TOP_K = 5
const DEFAULT_MIN_TERM_LENGTH = 2
const MAX_MEMORY_CONTENT_CHARS = 500

interface MemoryModuleConfig {
  summarizeModel: string | null
  retrieveTopK: number
  minTermLength: number
}

export interface MemoryConsolidationKeepAction {
  op: 'keep'
  id: string
}

export interface MemoryConsolidationRewriteAction {
  op: 'rewrite'
  id: string
  summary: string
  tags: string[]
  importance: number
}

export interface MemoryConsolidationMergeAction {
  op: 'merge'
  sourceIds: string[]
  summary: string
  tags: string[]
  importance: number
}

export type MemoryConsolidationAction =
  | MemoryConsolidationKeepAction
  | MemoryConsolidationRewriteAction
  | MemoryConsolidationMergeAction

const TAG_GUIDANCE = [
  'tags 尽量提供至少 4 个简短、可复用的中文关键词。',
  'summary 和 tags 默认使用简体中文。',
  '除非是专有名词、代码标识符或固定英文术语，否则不要输出英文标签。',
].join('\n')

function readConfig(config: unknown): MemoryModuleConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      summarizeModel: null,
      retrieveTopK: DEFAULT_RETRIEVE_TOP_K,
      minTermLength: DEFAULT_MIN_TERM_LENGTH,
    }
  }

  const record = config as Record<string, unknown>
  const retrieveTopK = typeof record.retrieveTopK === 'number' && record.retrieveTopK > 0
    ? Math.floor(record.retrieveTopK)
    : DEFAULT_RETRIEVE_TOP_K
  const minTermLength = typeof record.minTermLength === 'number' && record.minTermLength > 0
    ? Math.floor(record.minTermLength)
    : DEFAULT_MIN_TERM_LENGTH

  return {
    summarizeModel: typeof record.summarizeModel === 'string'
      ? record.summarizeModel.trim() || null
      : null,
    retrieveTopK,
    minTermLength,
  }
}

export function resolveMemorySqliteConfig(config: unknown): MemoryModuleConfig {
  return readConfig(config)
}

export function isSqliteMemoryConfig(config: unknown): boolean {
  return !!config
    && typeof config === 'object'
    && !Array.isArray(config)
    && (config as Record<string, unknown>).scheme === 'sqlite'
}

function buildSummaryPrompt(): string {
  return [
    '你负责把一轮已经完成的对话整理成后续可用的长期记忆。',
    '只允许使用提供的本轮对话文本，不要补充不存在的信息。',
    '请使用简体中文总结，并严格返回只有以下键的 JSON：',
    '{"summary": string, "tags": string[], "importance": number}',
    'summary 需要是简洁、可复用的中文记忆摘要。',
    'importance 必须是 0 到 1 之间的数字。',
    TAG_GUIDANCE,
    '不要输出 markdown、代码块或任何额外说明。',
  ].join('\n')
}

function buildRetrievePrompt(): string {
  return [
    'You prepare a memory retrieval query for sqlite-based agent memories.',
    'You will receive the current local datetime of the computer and the user\'s latest message.',
    'Think in two channels:',
    '- time_range answers when the user is referring to.',
    '- keywords capture stable retrieval topics that are likely to appear in memory summaries or tags.',
    'Return strict JSON with exactly this shape:',
    '{"keywords": string[], "time_range": {"start": string, "end": string} | null}',
    'keywords should be stable retrieval topics such as names, people, places, projects, objects, concerns, activities, commitments, or incidents.',
    'keywords may be empty.',
    'Use the same language as the user\'s message.',
    'Choose concepts that would still make sense if the time expression were removed from the message.',
    'Prefer topic anchors over sentence fragments, query scaffolding, or generic recall words.',
    'If the user expresses time-related intent, translate it into an absolute time_range based on the provided current local datetime.',
    'If the user expresses no time-related intent, return "time_range": null.',
    'If the time intent is too ambiguous to resolve safely, return "time_range": null.',
    'If the message is mainly asking about a time period or recent events and does not name a concrete topic, return an empty keywords array and rely on time_range.',
    'Example: if the user says "昨天发生了什么", return {"keywords":[],"time_range":{"start":"...","end":"..."}}.',
    'Example: if the user says "昨天我们聊数据库迁移了吗", return {"keywords":["数据库迁移"],"time_range":{"start":"...","end":"..."}}.',
    'Example: if the user says "你记得我叫什么吗", return {"keywords":["名字"],"time_range":null}.',
    '"start" and "end" must be ISO 8601 datetime strings.',
    'Do not add markdown or code fences.',
  ].join('\n')
}

function renderMemoryFragment(memories: MemoryRecord[]): string | null {
  if (memories.length === 0) {
    return null
  }

  return [
    'Relevant memories you can rely on for this reply (most important first):',
    'Treat these as your available recollections for this turn.',
    'If the user asks about prior interactions, past facts, or recent events and these memories are relevant, answer from them directly.',
    'Do not claim that you cannot remember or that you lack memory if the relevant answer is contained here.',
    'If these memories are insufficient, say you are not sure instead of inventing details.',
    ...memories.map((memory) => `- ${memory.summary}`),
  ].join('\n')
}

function extractResponseText(ctx: TurnContext): string {
  if (!ctx.response) {
    return ''
  }

  return ctx.response.content
    .map((block) => {
      if (
        block
        && typeof block === 'object'
        && 'type' in block
        && (block as { type: unknown }).type === 'text'
        && 'text' in block
        && typeof (block as { text: unknown }).text === 'string'
      ) {
        return (block as { text: string }).text
      }
      return JSON.stringify(block)
    })
    .join('\n')
    .trim()
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...`
}

function formatOffset(minutesEastOfUtc: number): string {
  const sign = minutesEastOfUtc >= 0 ? '+' : '-'
  const absoluteMinutes = Math.abs(minutesEastOfUtc)
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0')
  const minutes = String(absoluteMinutes % 60).padStart(2, '0')
  return `${sign}${hours}:${minutes}`
}

function formatLocalIsoDateTime(date: Date): string {
  const localMinutes = date.getTimezoneOffset() * -1
  const localDate = new Date(date.getTime() + date.getTimezoneOffset() * 60_000 * -1)
  const year = localDate.getUTCFullYear()
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(localDate.getUTCDate()).padStart(2, '0')
  const hours = String(localDate.getUTCHours()).padStart(2, '0')
  const minutes = String(localDate.getUTCMinutes()).padStart(2, '0')
  const seconds = String(localDate.getUTCSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${formatOffset(localMinutes)}`
}

function buildRetrieveInputText(userText: string, now = new Date()): string {
  return [
    `Current local datetime: ${formatLocalIsoDateTime(now)}`,
    `User message: ${userText}`,
  ].join('\n')
}

function buildSourceText(ctx: TurnContext): string {
  const userText = ctx.input.text.trim()
  const assistantText = extractResponseText(ctx)

  if (!userText && !assistantText) {
    return ''
  }

  return truncate([
    `User: ${userText || '(empty)'}`,
    `Assistant: ${assistantText || '(empty)'}`,
  ].join('\n'), MAX_MEMORY_CONTENT_CHARS)
}

function extractJson(text: string): unknown {
  const withoutFences = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')

  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  const candidate = start >= 0 && end > start
    ? withoutFences.slice(start, end + 1)
    : withoutFences

  return JSON.parse(candidate)
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return []
  }

  return [...new Set(
    tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map(tag => tag.trim())
      .filter(Boolean),
  )]
}

function normalizeImportance(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0.5
}

function parseMemoryWriteResponse(responseText: string): MemoryWriteResult {
  const parsed = extractJson(responseText)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Memory summarize call did not return a JSON object')
  }

  const record = parsed as Record<string, unknown>
  const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
  if (!summary) {
    throw new Error('Memory summarize call returned an empty summary')
  }

  const tags = normalizeTags(record.tags)
  const importance = normalizeImportance(record.importance)

  return {
    summary,
    tags,
    importance,
  }
}

function parseTimeRange(value: unknown): MemoryQueryResult['timeRange'] {
  if (value == null) {
    return null
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Memory query call returned an invalid time_range')
  }

  const record = value as Record<string, unknown>
  const start = typeof record.start === 'string' ? new Date(record.start) : null
  const end = typeof record.end === 'string' ? new Date(record.end) : null

  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Memory query call returned an invalid time_range')
  }

  if (start.getTime() > end.getTime()) {
    throw new Error('Memory query call returned an inverted time_range')
  }

  return { start, end }
}

function parseMemoryQueryResponse(responseText: string): MemoryQueryResult {
  let parsed: unknown

  try {
    parsed = extractJson(responseText)
  } catch {
    throw new Error('Memory query call returned invalid JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Memory query call did not return a JSON object')
  }

  const record = parsed as Record<string, unknown>
  const keywords = Array.isArray(record.keywords)
    ? [...new Set(
        record.keywords
          .filter((keyword): keyword is string => typeof keyword === 'string')
          .map(keyword => keyword.trim())
          .filter(Boolean),
      )]
    : []
  const timeRange = parseTimeRange(record.time_range)

  if (keywords.length === 0 && !timeRange) {
    throw new Error('Memory query call returned neither keywords nor time_range')
  }

  return {
    keywords,
    timeRange,
  }
}


export function buildMemoryConsolidationPrompt(): string {
  return [
    'You consolidate stored sqlite memories for one agent.',
    'Use only the provided memory list.',
    'Return strict JSON with exactly this shape:',
    '{"actions": Array<keep|rewrite|merge>}',
    'keep action: {"op":"keep","id":"memory-id"}',
    'rewrite action: {"op":"rewrite","id":"memory-id","summary":string,"tags":string[],"importance":number}',
    'merge action: {"op":"merge","sourceIds":string[],"summary":string,"tags":string[],"importance":number}',
    'Keep facts unless they are duplicated or can be rewritten more clearly.',
    'A memory id may appear at most once across all actions.',
    'sourceIds must contain at least 2 ids when merging.',
    'importance must be a number between 0 and 1.',
    TAG_GUIDANCE,
    'Do not add markdown or code fences.',
  ].join('\n')
}

export function buildMemoryConsolidationSourceText(memories: MemoryRecord[]): string {
  return [
    'Memories to consolidate (oldest first):',
    JSON.stringify(
      memories.map((memory) => ({
        id: memory.id,
        summary: memory.summary,
        tags: memory.tags,
        importance: memory.importance,
        createdAt: memory.createdAt.toISOString(),
      })),
      null,
      2,
    ),
  ].join('\n')
}

export function parseMemoryConsolidationResponse(responseText: string): MemoryConsolidationAction[] {
  const parsed = extractJson(responseText)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Memory consolidate call did not return a JSON object')
  }

  const actions = (parsed as { actions?: unknown }).actions
  if (!Array.isArray(actions)) {
    throw new Error('Memory consolidate call did not return an actions array')
  }

  return actions.map((action, index) => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      throw new Error(`Memory consolidate action ${index} is not an object`)
    }

    const record = action as Record<string, unknown>
    const op = record.op

    if (op === 'keep') {
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      if (!id) {
        throw new Error(`Memory consolidate keep action ${index} is missing id`)
      }
      return { op, id }
    }

    if (op === 'rewrite') {
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
      if (!id || !summary) {
        throw new Error(`Memory consolidate rewrite action ${index} is missing fields`)
      }
      return {
        op,
        id,
        summary,
        tags: normalizeTags(record.tags),
        importance: normalizeImportance(record.importance),
      }
    }

    if (op === 'merge') {
      const sourceIds = Array.isArray(record.sourceIds)
        ? [...new Set(
            record.sourceIds
              .filter((id): id is string => typeof id === 'string')
              .map(id => id.trim())
              .filter(Boolean),
          )]
        : []
      const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
      if (sourceIds.length < 2 || !summary) {
        throw new Error(`Memory consolidate merge action ${index} is missing fields`)
      }
      return {
        op,
        sourceIds,
        summary,
        tags: normalizeTags(record.tags),
        importance: normalizeImportance(record.importance),
      }
    }

    throw new Error(`Memory consolidate action ${index} has unknown op`)
  })
}

export class MemorySqliteSystem implements AgentSystem {
  name = 'memory:sqlite'
  type = 'memory'

  private readonly summarizeModel: string | null
  private readonly retrieveTopK: number

  constructor(config?: unknown) {
    const resolved = readConfig(config)
    this.summarizeModel = resolved.summarizeModel
    this.retrieveTopK = resolved.retrieveTopK
  }

  async beforeTurn(ctx: TurnContext): Promise<void> {
    const pending: PendingMemoryQuery = {
      kind: 'sqlite',
      system: this.name,
      model: this.summarizeModel,
      prompt: buildRetrievePrompt(),
      inputText: buildRetrieveInputText(ctx.input.text),
      parse: parseMemoryQueryResponse,
      retrieve: async (query) => memoryRepo.findRelevantMemories({
        agentId: ctx.agentId,
        terms: query.keywords,
        topK: this.retrieveTopK,
        timeRange: query.timeRange,
      }),
    }

    ctx.pendingMemoryQuery = pending
  }

  async beforeLLM(ctx: TurnContext): Promise<void> {
    const memories = Array.isArray(ctx.state.memories) ? ctx.state.memories : []
    const content = renderMemoryFragment(memories)
    if (!content) {
      return
    }

    ctx.promptFragments.push({
      source: this.name,
      priority: 30,
      content,
    })
  }

  async afterTurn(ctx: TurnContext): Promise<void> {
    const sourceText = buildSourceText(ctx)
    if (!sourceText) {
      return
    }

    const pending: PendingMemoryWrite = {
      kind: 'sqlite',
      system: this.name,
      model: this.summarizeModel,
      prompt: buildSummaryPrompt(),
      sourceText,
      parse: parseMemoryWriteResponse,
      persist: async (result) => (
        memoryRepo.addMemory({
          agentId: ctx.agentId,
          sessionId: ctx.sessionId,
          content: sourceText,
          summary: result.summary,
          tags: result.tags,
          importance: result.importance,
        })
      ),
    }

    ctx.pendingMemoryWrite = pending
  }
}
