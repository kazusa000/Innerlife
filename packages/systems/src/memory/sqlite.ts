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
    '你要为 sqlite 记忆系统准备一份检索查询。',
    '你会收到电脑当前的本地时间，以及用户最新一条消息。',
    '请把理解拆成两个通道：',
    '- time_range 用来回答“用户指的是哪段时间”。',
    '- keywords 用来提取稳定的话题锚点，这些锚点很可能出现在记忆 summary 或 tags 里。',
    '请严格返回如下 JSON 结构：',
    '{"keywords": string[], "time_range": {"start": string, "end": string} | null}',
    'keywords 应该是稳定的话题锚点，例如名字、人物、地点、项目、对象、顾虑、活动、承诺或事件。',
    'keywords 可以为空。',
    'keywords 使用与用户消息一致的语言。',
    '只保留那些即使去掉时间表达也依然成立的主题概念。',
    '优先选择话题锚点，不要返回句子碎片、提问脚手架或泛泛的回忆词。',
    '如果用户表达了时间相关意图，请基于提供的当前本地时间，把它翻译成绝对的 time_range。',
    '如果用户没有表达时间相关意图，返回 "time_range": null。',
    '如果时间意图过于模糊、无法安全判断，也返回 "time_range": null。',
    '如果用户主要是在追问某个时间段内发生了什么，但没有点名具体话题，那么返回空的 keywords，并依赖 time_range。',
    '例子：如果用户说“昨天发生了什么”，返回 {"keywords":[],"time_range":{"start":"...","end":"..."}}。',
    '例子：如果用户说“昨天我们聊数据库迁移了吗”，返回 {"keywords":["数据库迁移"],"time_range":{"start":"...","end":"..."}}。',
    '例子：如果用户说“你记得我叫什么吗”，返回 {"keywords":["名字"],"time_range":null}。',
    '"start" 和 "end" 必须是 ISO 8601 datetime 字符串。',
    '不要输出 markdown、代码块或任何额外说明。',
  ].join('\n')
}

function renderMemoryFragment(memories: MemoryRecord[]): string | null {
  if (memories.length === 0) {
    return null
  }

  return [
    '以下是本轮回复可直接依赖的相关记忆（按重要性从高到低）：',
    '把这些内容视为你这一轮可用的回忆。',
    '如果用户在询问先前互动、过去事实或最近发生的事情，而且这些记忆相关，就直接基于这些记忆回答。',
    '如果答案已经包含在这些记忆里，不要再声称自己记不住，或声称自己没有记忆能力。',
    '如果这些记忆仍然不足以回答，就明确说你不确定，不要编造细节。',
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
    '你要为单个 agent 整理已经存储的 sqlite 记忆。',
    '只允许使用提供的记忆列表，不要补充外部信息。',
    '请严格返回如下 JSON 结构：',
    '{"actions": Array<keep|rewrite|merge>}',
    'keep 动作：{"op":"keep","id":"memory-id"}',
    'rewrite 动作：{"op":"rewrite","id":"memory-id","summary":string,"tags":string[],"importance":number}',
    'merge 动作：{"op":"merge","sourceIds":string[],"summary":string,"tags":string[],"importance":number}',
    '除非内容重复，或者可以改写得更清晰，否则尽量保留事实。',
    '同一个 memory id 最多只能出现在一个动作里。',
    'merge 时 sourceIds 至少要包含 2 个 id。',
    'importance 必须是 0 到 1 之间的数字。',
    TAG_GUIDANCE,
    '不要输出 markdown、代码块或任何额外说明。',
  ].join('\n')
}

export function buildMemoryConsolidationSourceText(memories: MemoryRecord[]): string {
  return [
    '待整理的记忆（按时间从旧到新）：',
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
      reasoning: { effort: 'none' },
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
      reasoning: { effort: 'none' },
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
