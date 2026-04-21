import { memoryRepo } from '@mas/db'
import type {
  AgentSystem,
  MemoryRecord,
  MemoryQueryResult,
  MemorySemanticAnalysisResult,
  MemoryTimeAnalysisResult,
  MemoryResponseFormat,
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
const MEMORY_TIME_ANALYZER_RESPONSE_FORMAT: MemoryResponseFormat = {
  type: 'json_schema',
  jsonSchema: {
    name: 'memory_time_query',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        time_range: {
          type: ['object', 'null'],
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
          required: ['start', 'end'],
          additionalProperties: false,
        },
      },
      required: ['time_range'],
      additionalProperties: false,
    },
  },
}
const MEMORY_SEMANTIC_ANALYZER_RESPONSE_FORMAT: MemoryResponseFormat = {
  type: 'json_schema',
  jsonSchema: {
    name: 'memory_semantic_query',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        retrieval_query: {
          type: ['string', 'null'],
        },
        focus: {
          type: ['string', 'null'],
        },
      },
      required: ['retrieval_query', 'focus'],
      additionalProperties: false,
    },
  },
}
const MEMORY_WRITE_RESPONSE_FORMAT: MemoryResponseFormat = {
  type: 'json_schema',
  jsonSchema: {
    name: 'memory_write',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        display_summary: { type: 'string' },
        retrieval_text: { type: 'string' },
        tags: {
          type: 'array',
          items: { type: 'string' },
        },
        importance: { type: 'number' },
      },
      required: ['display_summary', 'retrieval_text', 'tags', 'importance'],
      additionalProperties: false,
    },
  },
}

interface MemoryModuleConfig {
  summarizeModel: string | null
  embeddingModel: string
  retrieveTopK: number
  embedder: MemoryEmbedder
  retrievePrompt: string | null
  timeAnalyzerPrompt: string | null
  semanticAnalyzerPrompt: string | null
  summarizePrompt: string | null
  fragmentPrompt: string | null
  consolidatePrompt: string | null
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

function formatMemoryLayerLabel(layer: MemoryRecord['layer']): string {
  switch (layer) {
    case 'long_term':
      return '长期记忆'
    case 'fixed':
      return '固化记忆'
    default:
      return '短期记忆'
  }
}

function readOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readConfig(config: unknown): MemoryModuleConfig {
  const embedder = createOpenRouterMemoryEmbedder()

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      summarizeModel: null,
      embeddingModel: DEFAULT_MEMORY_EMBEDDING_MODEL,
      retrieveTopK: DEFAULT_RETRIEVE_TOP_K,
      embedder,
      retrievePrompt: null,
      timeAnalyzerPrompt: null,
      semanticAnalyzerPrompt: null,
      summarizePrompt: null,
      fragmentPrompt: null,
      consolidatePrompt: null,
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
    retrievePrompt: readOptionalText(record.retrievePrompt),
    timeAnalyzerPrompt: readOptionalText(record.timeAnalyzerPrompt),
    semanticAnalyzerPrompt: readOptionalText(record.semanticAnalyzerPrompt),
    summarizePrompt: readOptionalText(record.summarizePrompt),
    fragmentPrompt: readOptionalText(record.fragmentPrompt),
    consolidatePrompt: readOptionalText(record.consolidatePrompt),
  }
}

export function resolveMemorySqliteConfig(config: unknown) {
  const resolved = readConfig(config)
  return {
    summarizeModel: resolved.summarizeModel,
    embeddingModel: resolved.embeddingModel,
    retrieveTopK: resolved.retrieveTopK,
    retrievePrompt: resolved.retrievePrompt,
    timeAnalyzerPrompt: resolved.timeAnalyzerPrompt,
    semanticAnalyzerPrompt: resolved.semanticAnalyzerPrompt,
    summarizePrompt: resolved.summarizePrompt,
    fragmentPrompt: resolved.fragmentPrompt,
    consolidatePrompt: resolved.consolidatePrompt,
  }
}

export function isSqliteMemoryConfig(config: unknown): boolean {
  return !!config
    && typeof config === 'object'
    && !Array.isArray(config)
    && (config as Record<string, unknown>).scheme === 'sqlite'
}

export function buildSummaryPrompt(promptOverride?: string | null): string {
  if (promptOverride?.trim()) {
    return promptOverride.trim()
  }

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

function resolveTimeAnalyzerPromptOverride(config: Pick<MemoryModuleConfig, 'timeAnalyzerPrompt' | 'retrievePrompt'>) {
  return config.timeAnalyzerPrompt ?? config.retrievePrompt
}

function resolveSemanticAnalyzerPromptOverride(config: Pick<MemoryModuleConfig, 'semanticAnalyzerPrompt' | 'retrievePrompt'>) {
  return config.semanticAnalyzerPrompt ?? config.retrievePrompt
}

export function buildTimeAnalyzerPrompt(promptOverride?: string | null): string {
  if (promptOverride?.trim()) {
    return promptOverride.trim()
  }

  return [
    '你是 sqlite 记忆系统的时间分析器。',
    '你会收到电脑当前的本地时间，以及用户最新一条消息。',
    '请严格返回如下 JSON 结构：',
    '{"time_range": {"start": string, "end": string} | null}',
    '如果用户没有表达时间意图，返回 "time_range": null。',
    '如果用户表达了时间意图，请基于当前本地时间返回尽量精确的绝对 time_range。',
    '如果问题明显是在回顾已经发生过的内容，time_range 必须落在已经过去的时间窗口里，不要返回未来时间；优先选择最近一个已经结束的过去时段。',
    '如果用户是在泛指过去互动、先前对话、此前提到过的事，即使没有明确时间粒度，也视为时间意图；返回覆盖足够宽的过去区间并以当前本地时间为结束的非空 time_range，不要返回 null。',
    '这类泛指过去互动的问法，start 不要贴近当前时间到只剩几秒或几分钟；应覆盖明显更长的过去区间。',
    '如果去掉回顾语气后仍然存在明确的主题锚点，而原句又没有明确时间表达，则不要仅因为“记得/聊过/提到过”就补一个 time_range；这种情况下 time_range 应为 null。',
    '如果用户只是在回顾某个时间段里聊过什么、说过什么、讨论过什么，time_range 不应为 null。',
    '“今天”表示当前本地自然日，“昨天”表示前一个本地自然日，不是滚动的 24 小时窗口。',
    '上午=06:00-11:59，下午=12:00-17:59，晚上=18:00-23:59，凌晨=00:00-05:59，全部按本地时间理解。',
    '“刚刚/刚才/前面/上一句”要对应最近几分钟的短时间窗口，不是单一时间点。',
    '“今天上午/今天下午/今晚/昨晚/今早/昨天上午”要对应最窄、最贴近原话的局部时间窗口，不要扩大成整天，不要跨到其他时段，也不要跨到下一天；如果该时段尚未发生，就回指最近一个已经结束的同类过去时段。',
    '"start" 和 "end" 必须是 ISO 8601 datetime 字符串。',
    '不要输出 markdown、代码块或任何额外说明。',
  ].join('\n')
}

export function buildSemanticAnalyzerPrompt(promptOverride?: string | null): string {
  if (promptOverride?.trim()) {
    return promptOverride.trim()
  }

  return [
    '你是 sqlite 记忆系统的语义分析器。',
    '你会收到用户最新一条消息。',
    '请严格返回如下 JSON 结构：',
    '{"retrieval_query": string | null, "focus": string | null}',
    'retrieval_query 只保留最短、最稳定、最能检索的主题锚点，通常就是一个名词或很短的名词短语；不要写解释句。',
    '时间信息绝不进入 retrieval_query。',
    'retrieval_query 不要包含说话者、提问动作、讨论动作，也不要包含“内容/事情/对话/讨论”这类回顾外壳，也不要复述整个时间回顾问句。',
    '去掉时间和回顾外壳后，如果还剩下具体对象、主题、画面、名字、食物、bug、地点、关系或意象，就保留它，不要误判成 null。',
    'retrieval_query 必须是一个自足的短语，不要输出“猫的”这类残缺片段；必要时补成“猫名字”“bug 修复”“海边灯塔画面”这种完整但简短的主题表达。',
    '如果原句是在回顾某个时间段里聊过的对象、场景、画面、名字或事件类型，去掉时间后剩下的那部分仍然是主题锚点。',
    '只要存在稳定主题锚点，就必须把它放进 retrieval_query；focus 只能补充说明，不能替代 retrieval_query。',
    '如果原句里明确出现了“画面”“场景”“名字”“地点”“食物”“bug”这类名词短语，而去掉时间后它们仍然存在，则 retrieval_query 不能为 null。',
    '如果剩下的主题本身就是一个抽象名词，但它已经明确指向用户要找的对象，例如“画面”“场景”“名字”“梦境”“氛围”，就直接把这个词作为 retrieval_query，不要返回 null。',
    '去掉时间和回顾外壳后，如果没有稳定主题锚点，就返回 "retrieval_query": null；纯回顾问法本身不是主题锚点。',
    'retrieval_query 和 focus 默认使用与用户消息相同的语言；中文提问就用中文，不要改成英文。',
    'focus 只写简短关注点；没有明显 focus 就返回 null。',
    '不要输出 markdown、代码块或任何额外说明。',
  ].join('\n')
}

export function buildMemoryFragmentPrompt(promptOverride?: string | null): string {
  if (promptOverride?.trim()) {
    return promptOverride.trim()
  }

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
  ].join('\n')
}

function renderMemoryFragment(memories: MemoryRecord[], promptOverride?: string | null): string | null {
  if (memories.length === 0) {
    return null
  }

  const [primaryMemory, ...secondaryMemories] = memories
  const renderMemoryLine = (label: string, memory: MemoryRecord) =>
    `${label}：[${formatMemoryLayerLabel(memory.layer)}][${formatLocalMemoryPromptTime(memory.createdAt)}] ${memory.displaySummary}`

  if (promptOverride?.trim()) {
    return [
      buildMemoryFragmentPrompt(promptOverride),
      renderMemoryLine('最相关记忆', primaryMemory),
      ...secondaryMemories.map((memory) => renderMemoryLine('补充记忆', memory)),
    ].join('\n')
  }

  return [
    buildMemoryFragmentPrompt(),
    renderMemoryLine('最相关记忆（优先回答）', primaryMemory),
    ...secondaryMemories.map((memory) => renderMemoryLine('补充记忆', memory)),
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

function formatLocalMemoryPromptTime(date: Date): string {
  const localMinutes = date.getTimezoneOffset() * -1
  const localDate = new Date(date.getTime() + date.getTimezoneOffset() * 60_000 * -1)
  const year = localDate.getUTCFullYear()
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(localDate.getUTCDate()).padStart(2, '0')
  const hours = String(localDate.getUTCHours()).padStart(2, '0')
  const minutes = String(localDate.getUTCMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes} ${formatOffset(localMinutes)}`
}

function buildTimeAnalyzerInputText(userText: string, now = new Date()) {
  return [
    `当前本地时间：${formatLocalIsoDateTime(now)}`,
    `用户消息：${userText}`,
  ].join('\n')
}

function buildSemanticAnalyzerInputText(userText: string) {
  return `用户消息：${userText}`
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

function parseTimeAnalyzerResponse(responseText: string): MemoryTimeAnalysisResult {
  let parsed: unknown
  try {
    parsed = extractJson(responseText)
  } catch {
    throw new Error('Memory time analyzer returned invalid JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Memory time analyzer did not return a JSON object')
  }

  const record = parsed as Record<string, unknown>
  const timeRange = parseTimeRange(record.time_range)

  return { timeRange }
}

function parseSemanticAnalyzerResponse(responseText: string): MemorySemanticAnalysisResult {
  let parsed: unknown
  try {
    parsed = extractJson(responseText)
  } catch {
    throw new Error('Memory semantic analyzer returned invalid JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Memory semantic analyzer did not return a JSON object')
  }

  const record = parsed as Record<string, unknown>
  const retrievalQuery = typeof record.retrieval_query === 'string' && record.retrieval_query.trim()
    ? record.retrieval_query.trim()
    : null
  const focus = typeof record.focus === 'string' && record.focus.trim()
    ? record.focus.trim()
    : null

  return { retrievalQuery, focus }
}

export function buildMemoryConsolidationPrompt(promptOverride?: string | null): string {
  if (promptOverride?.trim()) {
    return promptOverride.trim()
  }

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
        layer: memory.layer,
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
  private readonly legacyRetrievePrompt: string | null
  private readonly timeAnalyzerPrompt: string | null
  private readonly semanticAnalyzerPrompt: string | null
  private readonly summarizePrompt: string | null
  private readonly fragmentPrompt: string | null

  constructor(config?: unknown) {
    const resolved = readConfig(config)
    this.summarizeModel = resolved.summarizeModel
    this.embeddingModel = resolved.embeddingModel
    this.retrieveTopK = resolved.retrieveTopK
    this.embedder = resolved.embedder
    this.legacyRetrievePrompt = resolved.retrievePrompt
    this.timeAnalyzerPrompt = resolved.timeAnalyzerPrompt
    this.semanticAnalyzerPrompt = resolved.semanticAnalyzerPrompt
    this.summarizePrompt = resolved.summarizePrompt
    this.fragmentPrompt = resolved.fragmentPrompt
  }

  async beforeTurn(ctx: TurnContext): Promise<void> {
    const timePromptOverride = resolveTimeAnalyzerPromptOverride({
      timeAnalyzerPrompt: this.timeAnalyzerPrompt,
      retrievePrompt: this.legacyRetrievePrompt,
    })
    const semanticPromptOverride = resolveSemanticAnalyzerPromptOverride({
      semanticAnalyzerPrompt: this.semanticAnalyzerPrompt,
      retrievePrompt: this.legacyRetrievePrompt,
    })
    const pending: PendingMemoryQuery = {
      kind: 'sqlite',
      system: this.name,
      model: this.summarizeModel,
      reasoning: { effort: 'none' },
      timeAnalyzer: {
        prompt: buildTimeAnalyzerPrompt(timePromptOverride),
        inputText: buildTimeAnalyzerInputText(ctx.input.text),
        responseFormat: MEMORY_TIME_ANALYZER_RESPONSE_FORMAT,
        parse: parseTimeAnalyzerResponse,
      },
      semanticAnalyzer: {
        prompt: buildSemanticAnalyzerPrompt(semanticPromptOverride),
        inputText: buildSemanticAnalyzerInputText(ctx.input.text),
        responseFormat: MEMORY_SEMANTIC_ANALYZER_RESPONSE_FORMAT,
        parse: parseSemanticAnalyzerResponse,
      },
      merge: ({ time, semantic }) => {
        const merged = {
          retrievalQuery: semantic.retrievalQuery,
          focus: semantic.focus,
          timeRange: time?.timeRange ?? null,
        }

        if (!merged.retrievalQuery && !merged.timeRange) {
          throw new Error('Memory query analyzers returned neither retrieval_query nor time_range')
        }

        return merged
      },
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
    const content = renderMemoryFragment(memories, this.fragmentPrompt)
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
      responseFormat: MEMORY_WRITE_RESPONSE_FORMAT,
      prompt: buildSummaryPrompt(this.summarizePrompt),
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
          layer: 'short_term',
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
