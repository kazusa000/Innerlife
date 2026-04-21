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
import {
  createOpenRouterMemoryEmbedder,
  DEFAULT_MEMORY_EMBEDDING_MODEL,
  type MemoryEmbedder,
} from './embeddings'

const DEFAULT_RETRIEVE_TOP_K = 5
const MAX_MEMORY_CONTENT_CHARS = 500

interface MemoryModuleConfig {
  summarizeModel: string | null
  embeddingModel: string
  retrieveTopK: number
  embedder: MemoryEmbedder
}

export interface MemoryConsolidationKeepAction {
  op: 'keep'
  id: string
}

export interface MemoryConsolidationRewriteAction {
  op: 'rewrite'
  id: string
  displaySummary: string
  retrievalText: string
  tags: string[]
  importance: number
}

export interface MemoryConsolidationMergeAction {
  op: 'merge'
  sourceIds: string[]
  displaySummary: string
  retrievalText: string
  tags: string[]
  importance: number
}

export type MemoryConsolidationAction =
  | MemoryConsolidationKeepAction
  | MemoryConsolidationRewriteAction
  | MemoryConsolidationMergeAction

const WRITE_GUIDANCE = [
  'display_summary 用简体中文，写成简洁、稳定、适合展示给模型看的记忆摘要。',
  'retrieval_text 用自然语言完整描述可检索的事实、场景或事件，不要写成标签列表。',
  'tags 默认使用简体中文；除非是专有名词、代码标识符或固定英文术语，否则不要输出英文标签。',
  'tags 至少提供 4 个简短、可复用的中文标签。',
].join('\n')

function readConfig(config: unknown): MemoryModuleConfig {
  const embedder = createOpenRouterMemoryEmbedder()

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      summarizeModel: null,
      embeddingModel: DEFAULT_MEMORY_EMBEDDING_MODEL,
      retrieveTopK: DEFAULT_RETRIEVE_TOP_K,
      embedder,
    }
  }

  const record = config as Record<string, unknown>

  return {
    summarizeModel: typeof record.summarizeModel === 'string'
      ? record.summarizeModel.trim() || null
      : null,
    embeddingModel: typeof record.embeddingModel === 'string'
      ? record.embeddingModel.trim() || DEFAULT_MEMORY_EMBEDDING_MODEL
      : DEFAULT_MEMORY_EMBEDDING_MODEL,
    retrieveTopK: typeof record.retrieveTopK === 'number' && record.retrieveTopK > 0
      ? Math.floor(record.retrieveTopK)
      : DEFAULT_RETRIEVE_TOP_K,
    embedder:
      record.embedder && typeof record.embedder === 'object' && 'embed' in record.embedder
        ? record.embedder as MemoryEmbedder
        : embedder,
  }
}

export function resolveMemorySqliteConfig(config: unknown) {
  const resolved = readConfig(config)
  return {
    summarizeModel: resolved.summarizeModel,
    embeddingModel: resolved.embeddingModel,
    retrieveTopK: resolved.retrieveTopK,
  }
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
    '请严格返回只有以下键的 JSON：',
    '{"display_summary": string, "retrieval_text": string, "tags": string[], "importance": number}',
    WRITE_GUIDANCE,
    'importance 必须是 0 到 1 之间的数字。',
    '不要输出 markdown、代码块或任何额外说明。',
  ].join('\n')
}

function buildRetrievePrompt(): string {
  return [
    '你要为 sqlite 记忆系统准备一份语义检索查询。',
    '你会收到电脑当前的本地时间，以及用户最新一条消息。',
    '请严格返回如下 JSON 结构：',
    '{"retrieval_query": string | null, "time_range": {"start": string, "end": string} | null, "focus": string | null}',
    'retrieval_query 表示最适合语义检索的主题表达，不是解释句，也不是关键词列表。',
    '如果用户问题里存在稳定主题、对象、事件或关系锚点，就提炼出最短、最稳定、最能检索的主题表达。',
    '优先保留主题本体本身，不要套上“用户提到的……内容”“关于……的事情”“……相关内容”这类包裹说法。',
    '如果一个词或一个短语就足以表达主题，就直接返回这个词或短语，不要额外解释。',
    '如果用户主要是在回顾某个时间段内发生了什么，而没有明显的主题锚点，可以返回 "retrieval_query": null。',
    '如果用户表达了时间相关意图，请基于当前本地时间把它翻译成绝对的 time_range。',
    '当用户说“刚刚”“刚才”“前面”“上一句”这类近期回顾时，time_range 应该是覆盖最近一小段时间的短时间窗口，而不是单一时间点。',
    '不要把“刚刚”理解成只有当前这一秒；如果用户在回顾最近说过的话，time_range 应该覆盖足以包含刚才那段对话的时间窗口。',
    '如果用户没有表达时间相关意图，返回 "time_range": null。',
    '如果时间意图过于模糊、无法安全判断，也返回 "time_range": null。',
    'focus 是可选的短语，用来标记这次回忆的核心关注点；没有明显 focus 就返回 null。',
    '"start" 和 "end" 必须是 ISO 8601 datetime 字符串。',
    '不要输出 markdown、代码块或任何额外说明。',
  ].join('\n')
}

function renderMemoryFragment(memories: MemoryRecord[]): string | null {
  if (memories.length === 0) {
    return null
  }

  const [primaryMemory, ...secondaryMemories] = memories

  return [
    '以下是本轮回复可直接依赖的相关记忆：',
    '把这些内容视为你这一轮可用的回忆。',
    '如果用户在询问先前互动、过去事实或最近发生的事情，而且这些记忆相关，就直接基于这些记忆回答。',
    '如果用户是在回顾“我刚刚说了什么”“我们刚刚聊了什么”“我之前提到过什么”这类内容，优先直接复述命中的相关记忆。',
    '优先从最新、最相关的命中开始回答；如果前面的记忆已经能回答，就不要被更旧的记忆带偏。',
    '只有当最相关记忆不足以回答时，才参考下面的补充记忆。',
    '如果答案已经包含在这些记忆里，不要再声称自己记不住，或声称自己没有记忆能力。',
    '不要先说“这是第一次对话”或“没有历史记录”，除非这些记忆本身就明确支持这个结论。',
    '如果这些记忆仍然不足以回答，就明确说你不确定，不要编造细节。',
    `最相关记忆（优先回答）：${primaryMemory.displaySummary}`,
    ...secondaryMemories.map((memory) => `补充记忆：${memory.displaySummary}`),
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

function buildRetrieveInputText(userText: string, now = new Date()) {
  return [
    `当前本地时间：${formatLocalIsoDateTime(now)}`,
    `用户消息：${userText}`,
  ].join('\n')
}

function buildSourceText(ctx: TurnContext): string {
  const userText = ctx.input.text.trim()
  const assistantText = extractResponseText(ctx)

  if (!userText && !assistantText) {
    return ''
  }

  return truncate([
    `用户：${userText || '（空）'}`,
    `助手：${assistantText || '（空）'}`,
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
      .map((tag) => tag.trim())
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
  const displaySummary = typeof record.display_summary === 'string' ? record.display_summary.trim() : ''
  const retrievalText = typeof record.retrieval_text === 'string' ? record.retrieval_text.trim() : ''

  if (!displaySummary || !retrievalText) {
    throw new Error('Memory summarize call returned missing display_summary or retrieval_text')
  }

  return {
    displaySummary,
    retrievalText,
    tags: normalizeTags(record.tags),
    importance: normalizeImportance(record.importance),
  }
}

function parseDateWithPrecision(value: string, side: 'start' | 'end'): Date {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return date
  }

  const hasFractionalSeconds = /\.\d+(?:Z|[+-]\d{2}:\d{2})?$/.test(value)
  if (side === 'end' && !hasFractionalSeconds) {
    date.setMilliseconds(999)
  }

  return date
}

function parseTimeRange(value: unknown): MemoryQueryResult['timeRange'] {
  if (value == null) {
    return null
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Memory query call returned an invalid time_range')
  }

  const record = value as Record<string, unknown>
  const start = typeof record.start === 'string' ? parseDateWithPrecision(record.start, 'start') : null
  const end = typeof record.end === 'string' ? parseDateWithPrecision(record.end, 'end') : null

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
  const retrievalQuery = typeof record.retrieval_query === 'string' && record.retrieval_query.trim()
    ? record.retrieval_query.trim()
    : null
  const timeRange = parseTimeRange(record.time_range)
  const focus = typeof record.focus === 'string' && record.focus.trim()
    ? record.focus.trim()
    : null

  if (!retrievalQuery && !timeRange) {
    throw new Error('Memory query call returned neither retrieval_query nor time_range')
  }

  return { retrievalQuery, timeRange, focus }
}

export function buildMemoryConsolidationPrompt(): string {
  return [
    '你要为单个 agent 整理已经存储的 sqlite 记忆。',
    '只允许使用提供的记忆列表，不要补充外部信息。',
    '请严格返回如下 JSON 结构：',
    '{"actions": Array<keep|rewrite|merge>}',
    'keep 动作：{"op":"keep","id":"memory-id"}',
    'rewrite 动作：{"op":"rewrite","id":"memory-id","display_summary":string,"retrieval_text":string,"tags":string[],"importance":number}',
    'merge 动作：{"op":"merge","sourceIds":string[],"display_summary":string,"retrieval_text":string,"tags":string[],"importance":number}',
    '除非内容重复，或者可以改写得更清晰，否则尽量保留事实。',
    '同一个 memory id 最多只能出现在一个动作里。',
    'merge 时 sourceIds 至少要包含 2 个 id。',
    WRITE_GUIDANCE,
    'importance 必须是 0 到 1 之间的数字。',
    '不要输出 markdown、代码块或任何额外说明。',
  ].join('\n')
}

export function buildMemoryConsolidationSourceText(memories: MemoryRecord[]): string {
  return [
    '待整理的记忆（按时间从旧到新）：',
    JSON.stringify(
      memories.map((memory) => ({
        id: memory.id,
        display_summary: memory.displaySummary,
        retrieval_text: memory.retrievalText,
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
      const displaySummary = typeof record.display_summary === 'string' ? record.display_summary.trim() : ''
      const retrievalText = typeof record.retrieval_text === 'string' ? record.retrieval_text.trim() : ''
      if (!id || !displaySummary || !retrievalText) {
        throw new Error(`Memory consolidate rewrite action ${index} is missing fields`)
      }
      return {
        op,
        id,
        displaySummary,
        retrievalText,
        tags: normalizeTags(record.tags),
        importance: normalizeImportance(record.importance),
      }
    }

    if (op === 'merge') {
      const sourceIds = Array.isArray(record.sourceIds)
        ? [...new Set(
            record.sourceIds
              .filter((id): id is string => typeof id === 'string')
              .map((id) => id.trim())
              .filter(Boolean),
          )]
        : []
      const displaySummary = typeof record.display_summary === 'string' ? record.display_summary.trim() : ''
      const retrievalText = typeof record.retrieval_text === 'string' ? record.retrieval_text.trim() : ''
      if (sourceIds.length < 2 || !displaySummary || !retrievalText) {
        throw new Error(`Memory consolidate merge action ${index} is missing fields`)
      }
      return {
        op,
        sourceIds,
        displaySummary,
        retrievalText,
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
  private readonly embeddingModel: string
  private readonly retrieveTopK: number
  private readonly embedder: MemoryEmbedder

  constructor(config?: unknown) {
    const resolved = readConfig(config)
    this.summarizeModel = resolved.summarizeModel
    this.embeddingModel = resolved.embeddingModel
    this.retrieveTopK = resolved.retrieveTopK
    this.embedder = resolved.embedder
  }

  async beforeTurn(ctx: TurnContext): Promise<void> {
    const pending: PendingMemoryQuery = {
      kind: 'sqlite',
      system: this.name,
      model: this.summarizeModel,
      reasoning: { effort: 'none' },
      prompt: buildRetrievePrompt(),
      inputText: buildRetrieveInputText(ctx.input.text),
      parse: parseMemoryQueryResponse,
      retrieve: async (query) => {
        const usePureTimeRecall = query.timeRange && !query.retrievalQuery
        const queryTexts = (usePureTimeRecall ? [] : [ctx.input.text, query.retrievalQuery])
          .filter((text): text is string => typeof text === 'string')
          .map((text) => text.trim())
          .filter(Boolean)
        const queryEmbeddings = await this.embedder.embed(queryTexts, {
          model: this.embeddingModel,
          inputType: 'search_query',
        })

        return memoryRepo.findRelevantMemories({
          agentId: ctx.agentId,
          queryEmbeddings,
          topK: this.retrieveTopK,
          timeRange: query.timeRange,
        })
      },
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
      reasoning: { effort: 'none' },
      prompt: buildSummaryPrompt(),
      sourceText,
      parse: parseMemoryWriteResponse,
      persist: async (result) => {
        const [retrievalEmbedding] = await this.embedder.embed([result.retrievalText], {
          model: this.embeddingModel,
          inputType: 'search_document',
        })

        return memoryRepo.addMemory({
          agentId: ctx.agentId,
          sessionId: ctx.sessionId,
          sourceText,
          displaySummary: result.displaySummary,
          retrievalText: result.retrievalText,
          retrievalEmbedding: retrievalEmbedding ?? [],
          retrievalModel: this.embeddingModel,
          tags: result.tags,
          importance: result.importance,
        })
      },
    }

    ctx.pendingMemoryWrite = pending
  }
}
