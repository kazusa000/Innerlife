import { memoryRepo } from '@mas/db'
import type {
  AgentSystem,
  ConversationMessage,
  MemoryRecord,
  MemoryQueryResult,
  MemoryLayeredRetrieveResult,
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
import { analyzeMemoryTimeText } from './time-parser'

const DEFAULT_RETRIEVE_TOP_K = 5
const MAX_MEMORY_CONTENT_CHARS = 500
const DEFAULT_CONTEXT_WINDOW_MESSAGES = 50
const DEFAULT_CONTEXT_OVERFLOW_BATCH_SIZE = 25
const DEFAULT_CONTEXT_IDLE_FLUSH_MINUTES = 30
const DEFAULT_MAX_SHORT_TERM_MEMORIES_PER_FLUSH = 3
const DEFAULT_SEMANTIC_ANALYZER_HISTORY_MESSAGES = 6
const MAX_SEMANTIC_HISTORY_MESSAGE_CHARS = 180
const DEFAULT_SLEEP_TIME_LOCAL = '03:00'
const DEFAULT_SLEEP_INTERVAL_DAYS = 1
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
      },
      required: ['retrieval_query'],
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
export const MEMORY_BATCH_WRITE_RESPONSE_FORMAT: MemoryResponseFormat = {
  type: 'json_schema',
  jsonSchema: {
    name: 'memory_batch_write',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        memories: {
          type: 'array',
          items: {
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
      },
      required: ['memories'],
      additionalProperties: false,
    },
  },
}

interface MemoryModuleConfig {
  summarizeModel: string | null
  embeddingModel: string
  retrieveTopK: number
  contextWindowMessages: number
  contextOverflowBatchSize: number
  contextIdleFlushMinutes: number
  maxShortTermMemoriesPerFlush: number
  sleepEnabled: boolean
  sleepTimeLocal: string
  sleepIntervalDays: number
  embedder: MemoryEmbedder
  timeParser: (userText: string, referenceDate?: Date) => MemoryTimeAnalysisResult
  retrievePrompt: string | null
  semanticAnalyzerPrompt: string | null
  summarizePrompt: string | null
  contextToShortTermPrompt: string | null
  shortTermToLongTermPrompt: string | null
  fragmentPrompt: string | null
  shortTermFragmentPrompt: string | null
  fixedFragmentPrompt: string | null
  consolidatePrompt: string | null
}

export interface MemoryPipelineSettings {
  contextWindowMessages: number
  contextOverflowBatchSize: number
  contextIdleFlushMinutes: number
  maxShortTermMemoriesPerFlush: number
  sleepEnabled: boolean
  sleepTimeLocal: string
  sleepIntervalDays: number
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

function buildPromptWithRequiredJsonContract(
  promptOverride: string | null | undefined,
  defaultLines: string[],
  contractLines: string[],
): string {
  const override = promptOverride?.trim()
  if (!override) {
    return defaultLines.join('\n')
  }

  return [override, ...contractLines].join('\n')
}

function readOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPositiveInt(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed)
    }
  }
  return fallback
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function readSleepTime(value: unknown) {
  if (typeof value !== 'string') {
    return DEFAULT_SLEEP_TIME_LOCAL
  }

  const trimmed = value.trim()
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : DEFAULT_SLEEP_TIME_LOCAL
}

function readConfig(config: unknown): MemoryModuleConfig {
  const embedder = createOpenRouterMemoryEmbedder()

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      summarizeModel: null,
      embeddingModel: DEFAULT_MEMORY_EMBEDDING_MODEL,
      retrieveTopK: DEFAULT_RETRIEVE_TOP_K,
      contextWindowMessages: DEFAULT_CONTEXT_WINDOW_MESSAGES,
      contextOverflowBatchSize: DEFAULT_CONTEXT_OVERFLOW_BATCH_SIZE,
      contextIdleFlushMinutes: DEFAULT_CONTEXT_IDLE_FLUSH_MINUTES,
      maxShortTermMemoriesPerFlush: DEFAULT_MAX_SHORT_TERM_MEMORIES_PER_FLUSH,
      sleepEnabled: true,
      sleepTimeLocal: DEFAULT_SLEEP_TIME_LOCAL,
      sleepIntervalDays: DEFAULT_SLEEP_INTERVAL_DAYS,
      embedder,
      timeParser: analyzeMemoryTimeText,
      retrievePrompt: null,
      semanticAnalyzerPrompt: null,
      summarizePrompt: null,
      contextToShortTermPrompt: null,
      shortTermToLongTermPrompt: null,
      fragmentPrompt: null,
      shortTermFragmentPrompt: null,
      fixedFragmentPrompt: null,
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
    contextWindowMessages: readPositiveInt(record.contextWindowMessages, DEFAULT_CONTEXT_WINDOW_MESSAGES),
    contextOverflowBatchSize: readPositiveInt(record.contextOverflowBatchSize, DEFAULT_CONTEXT_OVERFLOW_BATCH_SIZE),
    contextIdleFlushMinutes: readPositiveInt(record.contextIdleFlushMinutes, DEFAULT_CONTEXT_IDLE_FLUSH_MINUTES),
    maxShortTermMemoriesPerFlush: readPositiveInt(record.maxShortTermMemoriesPerFlush, DEFAULT_MAX_SHORT_TERM_MEMORIES_PER_FLUSH),
    sleepEnabled: readBoolean(record.sleepEnabled, true),
    sleepTimeLocal: readSleepTime(record.sleepTimeLocal),
    sleepIntervalDays: readPositiveInt(record.sleepIntervalDays, DEFAULT_SLEEP_INTERVAL_DAYS),
    embedder:
      record.embedder && typeof record.embedder === 'object' && 'embed' in record.embedder
        ? record.embedder as MemoryEmbedder
        : embedder,
    timeParser:
      typeof record.timeParser === 'function'
        ? record.timeParser as (userText: string, referenceDate?: Date) => MemoryTimeAnalysisResult
        : analyzeMemoryTimeText,
    retrievePrompt: readOptionalText(record.retrievePrompt),
    semanticAnalyzerPrompt: readOptionalText(record.semanticAnalyzerPrompt),
    summarizePrompt: readOptionalText(record.summarizePrompt),
    contextToShortTermPrompt: readOptionalText(record.contextToShortTermPrompt),
    shortTermToLongTermPrompt: readOptionalText(record.shortTermToLongTermPrompt),
    fragmentPrompt: readOptionalText(record.fragmentPrompt),
    shortTermFragmentPrompt: readOptionalText(record.shortTermFragmentPrompt),
    fixedFragmentPrompt: readOptionalText(record.fixedFragmentPrompt),
    consolidatePrompt: readOptionalText(record.consolidatePrompt),
  }
}

export function resolveMemorySqliteConfig(config: unknown) {
  const resolved = readConfig(config)
  return {
    summarizeModel: resolved.summarizeModel,
    embeddingModel: resolved.embeddingModel,
    retrieveTopK: resolved.retrieveTopK,
    contextWindowMessages: resolved.contextWindowMessages,
    contextOverflowBatchSize: resolved.contextOverflowBatchSize,
    contextIdleFlushMinutes: resolved.contextIdleFlushMinutes,
    maxShortTermMemoriesPerFlush: resolved.maxShortTermMemoriesPerFlush,
    sleepEnabled: resolved.sleepEnabled,
    sleepTimeLocal: resolved.sleepTimeLocal,
    sleepIntervalDays: resolved.sleepIntervalDays,
    retrievePrompt: resolved.retrievePrompt,
    semanticAnalyzerPrompt: resolved.semanticAnalyzerPrompt,
    summarizePrompt: resolved.summarizePrompt,
    contextToShortTermPrompt: resolved.contextToShortTermPrompt,
    shortTermToLongTermPrompt: resolved.shortTermToLongTermPrompt,
    fragmentPrompt: resolved.fragmentPrompt,
    shortTermFragmentPrompt: resolved.shortTermFragmentPrompt,
    fixedFragmentPrompt: resolved.fixedFragmentPrompt,
    consolidatePrompt: resolved.consolidatePrompt,
  }
}

export function resolveMemoryPipelineSettings(config: unknown): MemoryPipelineSettings {
  const resolved = readConfig(config)
  return {
    contextWindowMessages: resolved.contextWindowMessages,
    contextOverflowBatchSize: resolved.contextOverflowBatchSize,
    contextIdleFlushMinutes: resolved.contextIdleFlushMinutes,
    maxShortTermMemoriesPerFlush: resolved.maxShortTermMemoriesPerFlush,
    sleepEnabled: resolved.sleepEnabled,
    sleepTimeLocal: resolved.sleepTimeLocal,
    sleepIntervalDays: resolved.sleepIntervalDays,
  }
}

export function isSqliteMemoryConfig(config: unknown): boolean {
  return !!config
    && typeof config === 'object'
    && !Array.isArray(config)
    && (config as Record<string, unknown>).scheme === 'sqlite'
}

export function buildSummaryPrompt(promptOverride?: string | null): string {
  const defaultLines = [
    '你负责把一轮已经完成的对话整理成后续可用的长期记忆。',
    '只允许使用提供的本轮对话文本，不要补充不存在的信息。',
    '请严格返回只有以下键的 JSON：',
    '{"display_summary": string, "retrieval_text": string, "tags": string[], "importance": number}',
    WRITE_GUIDANCE,
    'importance 必须是 0 到 1 之间的数字。',
    '不要输出 markdown、代码块或任何额外说明。',
  ]
  const contractLines = [
    '请严格返回 json，对象键只能是：',
    '{"display_summary": string, "retrieval_text": string, "tags": string[], "importance": number}',
    WRITE_GUIDANCE,
    'importance 必须是 0 到 1 之间的数字。',
    '不要输出 markdown、代码块或任何额外说明。',
  ]

  return buildPromptWithRequiredJsonContract(promptOverride, defaultLines, contractLines)
}

export function buildContextToShortTermPrompt(promptOverride?: string | null, maxMemories = DEFAULT_MAX_SHORT_TERM_MEMORIES_PER_FLUSH): string {
  const defaultLines = [
    '你负责把一大段旧上下文整理成短期记忆。',
    `请从提供的消息片段里提炼最多 ${maxMemories} 条短期记忆。`,
    '不要逐句复述聊天记录，只保留对后续对话最有价值的几个近期印象。',
    '请严格返回如下 JSON 结构：',
    '{"memories": Array<{"display_summary": string, "retrieval_text": string, "tags": string[], "importance": number}>}',
    WRITE_GUIDANCE,
    '如果这段上下文里没有值得留下的短期记忆，也必须返回 {"memories": []}。',
    '不要输出 markdown、代码块或任何额外说明。',
  ]
  const contractLines = [
    `请从提供的消息片段里提炼最多 ${maxMemories} 条短期记忆。`,
    '请严格返回 json，结构必须是：',
    '{"memories": Array<{"display_summary": string, "retrieval_text": string, "tags": string[], "importance": number}>}',
    WRITE_GUIDANCE,
    '如果这段上下文里没有值得留下的短期记忆，也必须返回 {"memories": []}。',
    '不要输出 markdown、代码块或任何额外说明。',
  ]

  return buildPromptWithRequiredJsonContract(promptOverride, defaultLines, contractLines)
}

export function buildShortTermToLongTermPrompt(promptOverride?: string | null, maxMemories = DEFAULT_MAX_SHORT_TERM_MEMORIES_PER_FLUSH): string {
  const defaultLines = [
    '你负责在睡眠阶段把短期记忆沉淀成更稳定的长期记忆。',
    `请从提供的短期记忆里整理出最多 ${maxMemories} 条长期记忆。`,
    '长期记忆应更稳定、更抽象，不要保留太多转瞬即逝的聊天细节。',
    '请严格返回如下 JSON 结构：',
    '{"memories": Array<{"display_summary": string, "retrieval_text": string, "tags": string[], "importance": number}>}',
    WRITE_GUIDANCE,
    '如果没有值得沉淀的长期记忆，也必须返回 {"memories": []}。',
    '不要输出 markdown、代码块或任何额外说明。',
  ]
  const contractLines = [
    `请从提供的短期记忆里整理出最多 ${maxMemories} 条长期记忆。`,
    '请严格返回 json，结构必须是：',
    '{"memories": Array<{"display_summary": string, "retrieval_text": string, "tags": string[], "importance": number}>}',
    WRITE_GUIDANCE,
    '如果没有值得沉淀的长期记忆，也必须返回 {"memories": []}。',
    '不要输出 markdown、代码块或任何额外说明。',
  ]

  return buildPromptWithRequiredJsonContract(promptOverride, defaultLines, contractLines)
}

function resolveSemanticAnalyzerPromptOverride(config: Pick<MemoryModuleConfig, 'semanticAnalyzerPrompt' | 'retrievePrompt'>) {
  return config.semanticAnalyzerPrompt ?? config.retrievePrompt
}

export function buildSemanticAnalyzerPrompt(promptOverride?: string | null): string {
  const defaultLines = [
    '你是 sqlite 记忆系统的语义分析器。',
    '你会收到一小段最近对话，以及当前用户最新一条消息。',
    '请严格返回如下 JSON 结构：',
    '{"retrieval_query": string | null}',
    '最近对话只用于补全当前用户消息里的代词、省略、回指，不用于扩写主题或替用户猜答案。',
    '最终只为当前用户消息生成 retrieval_query。',
    '如果当前用户消息本身已经自足，就忽略最近对话。',
    '如果历史里有多个可能指向、无法唯一补全，返回 "retrieval_query": null，不要替用户猜。',
    'retrieval_query 必须是一句短而完整的话。',
    'retrieval_query 只保留最短、最稳定、最能检索的主题锚点，不要写成长解释。',
    'retrieval_query 绝不能带时间信息；时间交给 time analyzer。',
    '不要把答案本身直接塞进 query。',
    '不要把历史里的额外主题顺手带进 query。',
    'retrieval_query 不要包含说话者、提问动作、讨论动作，也不要包含“内容/事情/对话/讨论”这类回顾外壳，也不要复述整个时间回顾问句。',
    '去掉时间和回顾外壳后，如果还剩下具体对象、主题、画面、名字、食物、bug、地点、关系或意象，就保留它，不要误判成 null。',
    '必要时把残缺主题补成一句短完整的话，例如“那只猫叫什么名字”“我的生日是哪天”“登录 bug 是怎么修好的”“海边灯塔和红伞的画面是什么样的”。',
    '不要把“它叫什么来着”原样输出成“它叫什么名字”。',
    '如果用户在问“我的是哪天来着”，而最近对话足够明确是在问生日，就补成“我的生日是哪天”，不要误判成 null。',
    '不要把“你还记得我喜欢那个吗”扩写成“用户喜欢拿铁还是乌龙茶”。',
    'retrieval_query 默认使用与用户消息相同的语言；中文提问就用中文，不要改成英文。',
    '不要输出 markdown、代码块或任何额外说明。',
  ]
  const contractLines = [
    '请严格返回 json，结构只能是：',
    '{"retrieval_query": string | null}',
    '不要输出 markdown、代码块或任何额外说明。',
  ]

  return buildPromptWithRequiredJsonContract(promptOverride, defaultLines, contractLines)
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

export function buildShortTermFragmentPrompt(promptOverride?: string | null): string {
  if (promptOverride?.trim()) {
    return promptOverride.trim()
  }

  return [
    '下面是本轮检索到的短期记忆。',
    '它们代表你近期还能想起的印象和刚过去不久的互动。',
    '如果这些短期记忆足以回答，就直接基于它们回答。',
  ].join('\n')
}

export function buildFixedMemoryFragmentPrompt(promptOverride?: string | null): string {
  if (promptOverride?.trim()) {
    return promptOverride.trim()
  }

  return [
    '下面是本轮检索到的固化记忆。',
    '它们代表稳定、长期成立的事实或偏好。',
    '如果这些固化记忆相关，就把它们当作可靠背景来使用。',
  ].join('\n')
}

export function buildLongTermSearchToolPrompt() {
  return [
    '只在当前上下文、短期记忆和固化记忆仍不足以回答时，才搜索长期记忆。',
    '不要把长期记忆搜索当成默认动作。',
    '每轮最多调用一次。',
    '如果工具返回未搜索到相关记忆，就直接接受这个结果，不要继续重复搜索或编造旧事。',
  ].join(' ')
}

function renderMemoryLayerResult(input: {
  title: string
  missText: string
  memories: MemoryRecord[]
  prompt: string
}): string {
  if (input.memories.length === 0) {
    return [input.prompt, input.missText].join('\n')
  }

  const [primaryMemory, ...secondaryMemories] = input.memories
  const renderMemoryLine = (label: string, memory: MemoryRecord) =>
    `${label}：[${formatMemoryLayerLabel(memory.layer)}][${formatLocalMemoryPromptTime(memory.createdAt)}] ${memory.displaySummary}`

  return [
    input.prompt,
    renderMemoryLine(`${input.title}最相关记忆`, primaryMemory),
    ...secondaryMemories.map((memory) => renderMemoryLine(`${input.title}补充记忆`, memory)),
  ].join('\n')
}

function renderLayeredMemoryFragment(input: {
  shortTermMemories: MemoryRecord[]
  fixedMemories: MemoryRecord[]
  shortTermPrompt?: string | null
  fixedPrompt?: string | null
}): string {
  return [
    renderMemoryLayerResult({
      title: '短期',
      memories: input.shortTermMemories,
      prompt: buildShortTermFragmentPrompt(input.shortTermPrompt),
      missText: '短期记忆检索结果：未搜索到相关记忆。',
    }),
    renderMemoryLayerResult({
      title: '固化',
      memories: input.fixedMemories,
      prompt: buildFixedMemoryFragmentPrompt(input.fixedPrompt),
      missText: '固化记忆检索结果：未搜索到相关记忆。',
    }),
  ].join('\n\n')
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

function extractSemanticHistoryMessageText(message: ConversationMessage): string | null {
  const shorten = (value: string) => truncate(
    value.replace(/\s+/g, ' ').trim(),
    MAX_SEMANTIC_HISTORY_MESSAGE_CHARS,
  )

  if (typeof message.content === 'string') {
    const trimmed = shorten(message.content)
    return trimmed || null
  }

  const text = message.content
    .flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text.trim()] : []))
    .filter(Boolean)
    .join('\n')
    .trim()

  return text ? shorten(text) : null
}

function buildSemanticAnalyzerHistoryWindow(
  messages: ConversationMessage[],
  maxMessages = DEFAULT_SEMANTIC_ANALYZER_HISTORY_MESSAGES,
) {
  const history: string[] = []
  let skippedCurrentUser = false

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user' && message?.role !== 'assistant') {
      continue
    }

    const text = extractSemanticHistoryMessageText(message)
    if (!text) {
      continue
    }

    if (!skippedCurrentUser && message.role === 'user') {
      skippedCurrentUser = true
      continue
    }

    history.unshift(`${message.role === 'user' ? '用户' : '助手'}：${text}`)
    if (history.length >= maxMessages) {
      break
    }
  }

  return history
}

function buildSemanticAnalyzerInputText(messages: ConversationMessage[], userText: string) {
  const historyWindow = buildSemanticAnalyzerHistoryWindow(messages)
  return [
    '最近对话（仅供补全当前问题）：',
    ...(historyWindow.length > 0 ? historyWindow : ['（无）']),
    '',
    '当前用户消息：',
    userText.trim() || '（空）',
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

export function buildContextToShortTermSourceText(messages: ConversationMessage[]): string {
  const lines: string[] = ['待整理的旧上下文：']
  for (const message of messages) {
    lines.push(`${message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : '系统'}：${extractConversationMessageText(message)}`)
  }
  return truncate(lines.join('\n'), MAX_MEMORY_CONTENT_CHARS * 4)
}

export function buildShortTermToLongTermSourceText(memories: MemoryRecord[]): string {
  return [
    '待沉淀的短期记忆：',
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

function extractConversationMessageText(message: ConversationMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }

  return message.content
    .map((block) => {
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text
      }
      if (block.type === 'tool_use' && block.name) {
        return `[tool_use:${block.name}]`
      }
      if (block.type === 'tool_result' && typeof block.content === 'string') {
        return `[tool_result] ${block.content}`
      }
      return JSON.stringify(block)
    })
    .join('\n')
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

export function parseMemoryWriteResponse(responseText: string): MemoryWriteResult {
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

export function parseMemoryBatchWriteResponse(responseText: string, maxCount: number): MemoryWriteResult[] {
  const parsed = extractJson(responseText)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Memory batch call did not return a JSON object')
  }

  const rawMemories = (parsed as { memories?: unknown }).memories
  if (!Array.isArray(rawMemories)) {
    throw new Error('Memory batch call did not return a memories array')
  }

  return rawMemories
    .slice(0, maxCount)
    .map((memory, index) => {
      if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
        throw new Error(`Memory batch item ${index} is not an object`)
      }

      const record = memory as Record<string, unknown>
      const displaySummary = typeof record.display_summary === 'string' ? record.display_summary.trim() : ''
      const retrievalText = typeof record.retrieval_text === 'string' ? record.retrieval_text.trim() : ''

      if (!displaySummary || !retrievalText) {
        throw new Error(`Memory batch item ${index} is missing display_summary or retrieval_text`)
      }

      return {
        displaySummary,
        retrievalText,
        tags: normalizeTags(record.tags),
        importance: normalizeImportance(record.importance),
      }
    })
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

  return { retrievalQuery }
}

function normalizeSemanticAnalyzerResult(
  userText: string,
  result: MemorySemanticAnalysisResult,
): MemorySemanticAnalysisResult {
  const retrievalQuery = result.retrievalQuery?.trim() ?? null
  if (!retrievalQuery) {
    return { retrievalQuery: null }
  }

  const compactUserText = userText.replace(/\s+/g, '')
  const isAmbiguousPreferenceRecall =
    /(那个|哪一个|哪个)/.test(compactUserText)
    && /喜欢/.test(retrievalQuery)
    && /还是/.test(retrievalQuery)

  return {
    retrievalQuery: isAmbiguousPreferenceRecall ? null : retrievalQuery,
  }
}

export function buildMemoryConsolidationPrompt(promptOverride?: string | null): string {
  const defaultLines = [
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
  ]
  const contractLines = [
    '请严格返回 json，结构必须是：',
    '{"actions": Array<keep|rewrite|merge>}',
    'keep 动作：{"op":"keep","id":"memory-id"}',
    'rewrite 动作：{"op":"rewrite","id":"memory-id","display_summary":string,"retrieval_text":string,"tags":string[],"importance":number}',
    'merge 动作：{"op":"merge","sourceIds":string[],"display_summary":string,"retrieval_text":string,"tags":string[],"importance":number}',
    '同一个 memory id 最多只能出现在一个动作里。',
    'merge 时 sourceIds 至少要包含 2 个 id。',
    WRITE_GUIDANCE,
    'importance 必须是 0 到 1 之间的数字。',
    '不要输出 markdown、代码块或任何额外说明。',
  ]

  return buildPromptWithRequiredJsonContract(promptOverride, defaultLines, contractLines)
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
  private readonly contextWindowMessages: number
  private readonly contextOverflowBatchSize: number
  private readonly contextIdleFlushMinutes: number
  private readonly maxShortTermMemoriesPerFlush: number
  private readonly sleepEnabled: boolean
  private readonly sleepTimeLocal: string
  private readonly sleepIntervalDays: number
  private readonly legacyRetrievePrompt: string | null
  private readonly timeParser: (userText: string, referenceDate?: Date) => MemoryTimeAnalysisResult
  private readonly semanticAnalyzerPrompt: string | null
  private readonly summarizePrompt: string | null
  private readonly contextToShortTermPrompt: string | null
  private readonly shortTermToLongTermPrompt: string | null
  private readonly fragmentPrompt: string | null
  private readonly shortTermFragmentPrompt: string | null
  private readonly fixedFragmentPrompt: string | null

  constructor(config?: unknown) {
    const resolved = readConfig(config)
    this.summarizeModel = resolved.summarizeModel
    this.embeddingModel = resolved.embeddingModel
    this.retrieveTopK = resolved.retrieveTopK
    this.embedder = resolved.embedder
    this.contextWindowMessages = resolved.contextWindowMessages
    this.contextOverflowBatchSize = resolved.contextOverflowBatchSize
    this.contextIdleFlushMinutes = resolved.contextIdleFlushMinutes
    this.maxShortTermMemoriesPerFlush = resolved.maxShortTermMemoriesPerFlush
    this.sleepEnabled = resolved.sleepEnabled
    this.sleepTimeLocal = resolved.sleepTimeLocal
    this.sleepIntervalDays = resolved.sleepIntervalDays
    this.legacyRetrievePrompt = resolved.retrievePrompt
    this.timeParser = resolved.timeParser
    this.semanticAnalyzerPrompt = resolved.semanticAnalyzerPrompt
    this.summarizePrompt = resolved.summarizePrompt
    this.contextToShortTermPrompt = resolved.contextToShortTermPrompt
    this.shortTermToLongTermPrompt = resolved.shortTermToLongTermPrompt
    this.fragmentPrompt = resolved.fragmentPrompt
    this.shortTermFragmentPrompt = resolved.shortTermFragmentPrompt
    this.fixedFragmentPrompt = resolved.fixedFragmentPrompt
  }

  async beforeTurn(ctx: TurnContext): Promise<void> {
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
        kind: 'local',
        analyze: () => this.timeParser(ctx.input.text, new Date()),
      },
      semanticAnalyzer: {
        kind: 'llm',
        prompt: buildSemanticAnalyzerPrompt(semanticPromptOverride),
        inputText: buildSemanticAnalyzerInputText(ctx.messages, ctx.input.text),
        responseFormat: MEMORY_SEMANTIC_ANALYZER_RESPONSE_FORMAT,
        parse: (responseText) => normalizeSemanticAnalyzerResult(
          ctx.input.text,
          parseSemanticAnalyzerResponse(responseText),
        ),
      },
      merge: ({ time, semantic }) => {
        const merged = {
          retrievalQuery: semantic.retrievalQuery,
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

        const [shortTerm, fixed] = await Promise.all([
          Promise.resolve(memoryRepo.findRelevantMemories({
            agentId: ctx.agentId,
            queryEmbeddings,
            topK: this.retrieveTopK,
            layers: ['short_term'],
            timeRange: query.timeRange,
          })),
          Promise.resolve(memoryRepo.findRelevantMemories({
            agentId: ctx.agentId,
            queryEmbeddings,
            topK: this.retrieveTopK,
            layers: ['fixed'],
            timeRange: query.timeRange,
          })),
        ])

        return { shortTerm, fixed }
      },
    }

    ctx.pendingMemoryQuery = pending
  }

  async beforeLLM(ctx: TurnContext): Promise<void> {
    const shortTermMemories = Array.isArray(ctx.state.shortTermMemories) ? ctx.state.shortTermMemories : []
    const fixedMemories = Array.isArray(ctx.state.fixedMemories) ? ctx.state.fixedMemories : []
    const content = renderLayeredMemoryFragment({
      shortTermMemories,
      fixedMemories,
      shortTermPrompt: this.shortTermFragmentPrompt ?? this.fragmentPrompt,
      fixedPrompt: this.fixedFragmentPrompt ?? this.fragmentPrompt,
    })

    ctx.promptFragments.push({
      source: this.name,
      priority: 30,
      content,
    })
  }

  async afterTurn(ctx: TurnContext): Promise<void> {
    ctx.pendingMemoryWrite = undefined
  }
}
