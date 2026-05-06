import {
  agentRepo,
  episodicMemoryGraphRepo,
  appSettingsRepo,
  memoryRepo,
  relationshipCounterpartRepo,
  sessionRelationshipBindingRepo,
} from '@mas/db'
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
  ShortTermToLongTermMemoryWriteResult,
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
const DEFAULT_MEMORY_MIN_SIMILARITY = 0.6
const MAX_MEMORY_CONTENT_CHARS = 500
const DEFAULT_CONTEXT_WINDOW_MESSAGES = 50
const DEFAULT_CONTEXT_OVERFLOW_BATCH_SIZE = 25
const DEFAULT_CONTEXT_IDLE_FLUSH_MINUTES = 30
const DEFAULT_MAX_SHORT_TERM_MEMORIES_PER_FLUSH = 3
const DEFAULT_SEMANTIC_ANALYZER_HISTORY_MESSAGES = 6
const MAX_SEMANTIC_HISTORY_MESSAGE_CHARS = 180
const DEFAULT_LONG_TERM_SEARCH_TOP_K = 3
const DEFAULT_EPISODIC_ACTIVATION_MAX_ACTIVE = 5
const DEFAULT_SLEEP_TIME_LOCAL = '03:00'
const DEFAULT_SLEEP_INTERVAL_DAYS = 1
const DEFAULT_SHOW_NO_HIT_MEMORY_FRAGMENTS = true
const SHORT_TERM_MEMORY_MISS_TEXT = '短期记忆检索结果：未搜索到相关记忆。'
const FIXED_MEMORY_MISS_TEXT = '固化记忆检索结果：未搜索到相关记忆。'
type AppLocale = appSettingsRepo.AppLocale
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
        detail: { type: 'string' },
        retrieval_text: { type: 'string' },
        importance: { type: 'number' },
      },
      required: ['detail', 'retrieval_text', 'importance'],
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
              detail: { type: 'string' },
              retrieval_text: { type: 'string' },
              importance: { type: 'number' },
            },
            required: ['detail', 'retrieval_text', 'importance'],
            additionalProperties: false,
          },
        },
      },
      required: ['memories'],
      additionalProperties: false,
    },
  },
}
export const SHORT_TERM_TO_LONG_TERM_RESPONSE_FORMAT: MemoryResponseFormat = {
  type: 'json_schema',
  jsonSchema: {
    name: 'short_term_to_long_term_memory',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        memories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              detail: { type: 'string' },
              retrieval_text: { type: 'string' },
              importance: { type: 'number' },
              source_stm_ids: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['detail', 'retrieval_text', 'importance', 'source_stm_ids'],
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
  shortTermRetrieveTopK: number
  fixedRetrieveTopK: number
  shortTermMinSimilarity: number
  fixedMinSimilarity: number
  contextWindowMessages: number
  contextOverflowBatchSize: number
  contextIdleFlushMinutes: number
  maxShortTermMemoriesPerFlush: number
  semanticAnalyzerHistoryMessages: number
  longTermSearchDefaultTopK: number
  showNoHitMemoryFragments: boolean
  sleepEnabled: boolean
  sleepTimeLocal: string
  sleepIntervalDays: number
  embedder: MemoryEmbedder
  timeParser: (userText: string, referenceDate?: Date) => MemoryTimeAnalysisResult
  retrievePrompt: string | null
  semanticAnalyzerPrompt: string | null
  contextToShortTermPrompt: string | null
  shortTermToLongTermPrompt: string | null
  entityMentionPrompt: string | null
  episodicExtractionPrompt: string | null
  entityResolutionPrompt: string | null
  fragmentPrompt: string | null
  shortTermFragmentPrompt: string | null
  fixedFragmentPrompt: string | null
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

export interface MemoryActorLabels {
  selfLabel: string
  recallSelfLabel: string
  counterpartLabel: string
  currentMessageHeader: string
}

const FALLBACK_MEMORY_ACTOR_LABELS: MemoryActorLabels = {
  selfLabel: '我',
  recallSelfLabel: '我',
  counterpartLabel: '用户',
  currentMessageHeader: '当前用户消息：',
}

const WRITE_GUIDANCE = [
  'detail 用简体中文，写成内部整理用的详细语境说明。',
  'retrieval_text 用自然语言完整描述可检索的事实、场景或事件，不要写成标签列表。',
  '如果 source_text 或上文里已经明确出现当前对话对象的名字，detail 和 retrieval_text 优先直接使用这个名字，不要退回成泛化的“用户”。',
  '描述助手自身时默认使用第一人称“我”，不要把“AI”或“助手”当成记忆主体，除非是在直接引用原话。',
].join('\n')

const SHORT_TERM_WRITE_GUIDANCE = [
  'detail 字段不是展示摘要；它是 context detail，用简体中文写成给后续 Stage A 抽实体和情景记忆使用的详细语境说明。',
  'detail 不参与 embedding，可以比 retrieval_text 更详细；必须保留原文 surface、昵称、名字、简称、别称、回指解释，以及“X 是 Y 的名字/简称/别称”等指向关系。',
  'retrieval_text 用于 embedding、检索和 UI 阅读；用自然语言完整描述可检索的事实、场景或事件，不要写成标签列表。',
  '如果上文里已经明确出现当前对话对象的名字，detail 和 retrieval_text 优先直接使用这个名字，不要退回成泛化的“用户”。',
  '描述助手自身时默认使用第一人称“我”，不要把“AI”或“助手”当成记忆主体，除非是在直接引用原话。',
].join('\n')

function formatMemoryLayerLabel(layer: MemoryRecord['layer'], locale: AppLocale = 'zh-CN'): string {
  if (locale === 'en-US') {
    switch (layer) {
      case 'long_term':
        return 'long-term memory'
      case 'fixed':
        return 'fixed memory'
      default:
        return 'short-term memory'
    }
  }

  switch (layer) {
    case 'long_term':
      return '长期记忆'
    case 'fixed':
      return '固化记忆'
    default:
      return '短期记忆'
  }
}

function joinPromptLines(lines: Array<string | null | undefined>) {
  return lines
    .map((line) => typeof line === 'string' ? line.trim() : '')
    .filter(Boolean)
    .join('\n')
}

function readOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readLocalizedText(record: Record<string, unknown>, key: string, locale: AppLocale): string | null {
  const localized = record[`${key}ByLocale`]
  if (localized && typeof localized === 'object' && !Array.isArray(localized)) {
    const value = (localized as Record<string, unknown>)[locale]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return locale === 'zh-CN' ? readOptionalText(record[key]) : null
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

function readProbability(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value))
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.min(1, Math.max(0, parsed))
    }
  }
  return fallback
}

function readPositiveIntWithMax(value: unknown, fallback: number, max: number) {
  return Math.min(max, readPositiveInt(value, fallback))
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

function readRelationshipScheme(modules: unknown) {
  if (!modules || typeof modules !== 'object' || Array.isArray(modules)) {
    return null
  }

  const relationship = (modules as Record<string, unknown>).relationship
  if (!relationship || typeof relationship !== 'object' || Array.isArray(relationship)) {
    return null
  }

  const scheme = (relationship as Record<string, unknown>).scheme
  return typeof scheme === 'string' && scheme.trim() ? scheme.trim() : null
}

export function resolveMemoryActorLabels(input: {
  agentId: string
  sessionId: string
  agentModules?: unknown
}): MemoryActorLabels {
  try {
    const agent = agentRepo.getAgent(input.agentId)
    const agentName = typeof agent?.name === 'string' && agent.name.trim()
      ? agent.name.trim()
      : null
    const fallbackLabels = {
      ...FALLBACK_MEMORY_ACTOR_LABELS,
      recallSelfLabel: agentName ?? FALLBACK_MEMORY_ACTOR_LABELS.recallSelfLabel,
    }
    const agentModules = input.agentModules ?? agent?.modules
    if (readRelationshipScheme(agentModules) !== 'named-multi-dim') {
      return fallbackLabels
    }

    const binding = sessionRelationshipBindingRepo.getSessionRelationshipBinding(input.sessionId)
    if (!binding) {
      return fallbackLabels
    }

    const counterpart = relationshipCounterpartRepo.getRelationshipCounterpart(binding.counterpartId)
    if (!counterpart || counterpart.agentId !== input.agentId) {
      return fallbackLabels
    }

    const counterpartName = counterpart.name.trim()
    if (!counterpartName) {
      return fallbackLabels
    }

    return {
      selfLabel: '我',
      recallSelfLabel: agentName ?? FALLBACK_MEMORY_ACTOR_LABELS.recallSelfLabel,
      counterpartLabel: counterpartName,
      currentMessageHeader: `当前消息（来自${counterpartName}）：`,
    }
  } catch {
    return FALLBACK_MEMORY_ACTOR_LABELS
  }
}

function readConfig(config: unknown, locale: AppLocale = 'zh-CN'): MemoryModuleConfig {
  const embedder = createOpenRouterMemoryEmbedder()

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      summarizeModel: null,
      embeddingModel: DEFAULT_MEMORY_EMBEDDING_MODEL,
      retrieveTopK: DEFAULT_RETRIEVE_TOP_K,
      shortTermRetrieveTopK: DEFAULT_RETRIEVE_TOP_K,
      fixedRetrieveTopK: DEFAULT_RETRIEVE_TOP_K,
      shortTermMinSimilarity: DEFAULT_MEMORY_MIN_SIMILARITY,
      fixedMinSimilarity: DEFAULT_MEMORY_MIN_SIMILARITY,
      contextWindowMessages: DEFAULT_CONTEXT_WINDOW_MESSAGES,
      contextOverflowBatchSize: DEFAULT_CONTEXT_OVERFLOW_BATCH_SIZE,
      contextIdleFlushMinutes: DEFAULT_CONTEXT_IDLE_FLUSH_MINUTES,
      maxShortTermMemoriesPerFlush: DEFAULT_MAX_SHORT_TERM_MEMORIES_PER_FLUSH,
      semanticAnalyzerHistoryMessages: DEFAULT_SEMANTIC_ANALYZER_HISTORY_MESSAGES,
      longTermSearchDefaultTopK: DEFAULT_LONG_TERM_SEARCH_TOP_K,
      showNoHitMemoryFragments: DEFAULT_SHOW_NO_HIT_MEMORY_FRAGMENTS,
      sleepEnabled: true,
      sleepTimeLocal: DEFAULT_SLEEP_TIME_LOCAL,
      sleepIntervalDays: DEFAULT_SLEEP_INTERVAL_DAYS,
      embedder,
      timeParser: analyzeMemoryTimeText,
      retrievePrompt: null,
      semanticAnalyzerPrompt: null,
      contextToShortTermPrompt: null,
      shortTermToLongTermPrompt: null,
      entityMentionPrompt: null,
      episodicExtractionPrompt: null,
      entityResolutionPrompt: null,
      fragmentPrompt: null,
      shortTermFragmentPrompt: null,
      fixedFragmentPrompt: null,
    }
  }

  const record = config as Record<string, unknown>
  const legacyRetrieveTopK = typeof record.retrieveTopK === 'number' && record.retrieveTopK > 0
    ? Math.floor(record.retrieveTopK)
    : DEFAULT_RETRIEVE_TOP_K

  return {
    summarizeModel: typeof record.summarizeModel === 'string'
      ? record.summarizeModel.trim() || null
      : null,
    embeddingModel: typeof record.embeddingModel === 'string'
      ? record.embeddingModel.trim() || DEFAULT_MEMORY_EMBEDDING_MODEL
      : DEFAULT_MEMORY_EMBEDDING_MODEL,
    retrieveTopK: legacyRetrieveTopK,
    shortTermRetrieveTopK: readPositiveInt(record.shortTermRetrieveTopK, legacyRetrieveTopK),
    fixedRetrieveTopK: readPositiveInt(record.fixedRetrieveTopK, legacyRetrieveTopK),
    shortTermMinSimilarity: readProbability(record.shortTermMinSimilarity, DEFAULT_MEMORY_MIN_SIMILARITY),
    fixedMinSimilarity: readProbability(record.fixedMinSimilarity, DEFAULT_MEMORY_MIN_SIMILARITY),
    contextWindowMessages: readPositiveInt(record.contextWindowMessages, DEFAULT_CONTEXT_WINDOW_MESSAGES),
    contextOverflowBatchSize: readPositiveInt(record.contextOverflowBatchSize, DEFAULT_CONTEXT_OVERFLOW_BATCH_SIZE),
    contextIdleFlushMinutes: readPositiveInt(record.contextIdleFlushMinutes, DEFAULT_CONTEXT_IDLE_FLUSH_MINUTES),
    maxShortTermMemoriesPerFlush: readPositiveInt(record.maxShortTermMemoriesPerFlush, DEFAULT_MAX_SHORT_TERM_MEMORIES_PER_FLUSH),
    semanticAnalyzerHistoryMessages: readPositiveInt(record.semanticAnalyzerHistoryMessages, DEFAULT_SEMANTIC_ANALYZER_HISTORY_MESSAGES),
    longTermSearchDefaultTopK: readPositiveIntWithMax(
      record.longTermSearchDefaultTopK,
      DEFAULT_LONG_TERM_SEARCH_TOP_K,
      5,
    ),
    showNoHitMemoryFragments: readBoolean(record.showNoHitMemoryFragments, DEFAULT_SHOW_NO_HIT_MEMORY_FRAGMENTS),
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
    retrievePrompt: readLocalizedText(record, 'retrievePrompt', locale),
    semanticAnalyzerPrompt: readLocalizedText(record, 'semanticAnalyzerPrompt', locale),
    contextToShortTermPrompt: readLocalizedText(record, 'contextToShortTermPrompt', locale),
    shortTermToLongTermPrompt: readLocalizedText(record, 'shortTermToLongTermPrompt', locale),
    entityMentionPrompt: readLocalizedText(record, 'entityMentionPrompt', locale),
    episodicExtractionPrompt: readLocalizedText(record, 'episodicExtractionPrompt', locale),
    entityResolutionPrompt: readLocalizedText(record, 'entityResolutionPrompt', locale),
    fragmentPrompt: readLocalizedText(record, 'fragmentPrompt', locale),
    shortTermFragmentPrompt: readLocalizedText(record, 'shortTermFragmentPrompt', locale),
    fixedFragmentPrompt: readLocalizedText(record, 'fixedFragmentPrompt', locale),
  }
}

export function resolveMemorySqliteConfig(config: unknown, locale: AppLocale = 'zh-CN') {
  const resolved = readConfig(config, locale)
  return {
    summarizeModel: resolved.summarizeModel,
    embeddingModel: resolved.embeddingModel,
    retrieveTopK: resolved.retrieveTopK,
    shortTermRetrieveTopK: resolved.shortTermRetrieveTopK,
    fixedRetrieveTopK: resolved.fixedRetrieveTopK,
    shortTermMinSimilarity: resolved.shortTermMinSimilarity,
    fixedMinSimilarity: resolved.fixedMinSimilarity,
    contextWindowMessages: resolved.contextWindowMessages,
    contextOverflowBatchSize: resolved.contextOverflowBatchSize,
    contextIdleFlushMinutes: resolved.contextIdleFlushMinutes,
    maxShortTermMemoriesPerFlush: resolved.maxShortTermMemoriesPerFlush,
    semanticAnalyzerHistoryMessages: resolved.semanticAnalyzerHistoryMessages,
    longTermSearchDefaultTopK: resolved.longTermSearchDefaultTopK,
    showNoHitMemoryFragments: resolved.showNoHitMemoryFragments,
    sleepEnabled: resolved.sleepEnabled,
    sleepTimeLocal: resolved.sleepTimeLocal,
    sleepIntervalDays: resolved.sleepIntervalDays,
    retrievePrompt: resolved.retrievePrompt,
    semanticAnalyzerPrompt: resolved.semanticAnalyzerPrompt,
    contextToShortTermPrompt: resolved.contextToShortTermPrompt,
    shortTermToLongTermPrompt: resolved.shortTermToLongTermPrompt,
    entityMentionPrompt: resolved.entityMentionPrompt,
    episodicExtractionPrompt: resolved.episodicExtractionPrompt,
    entityResolutionPrompt: resolved.entityResolutionPrompt,
    fragmentPrompt: resolved.fragmentPrompt,
    shortTermFragmentPrompt: resolved.shortTermFragmentPrompt,
    fixedFragmentPrompt: resolved.fixedFragmentPrompt,
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

export function buildContextToShortTermPrompt(
  promptOverride?: string | null,
  maxMemories = DEFAULT_MAX_SHORT_TERM_MEMORIES_PER_FLUSH,
  locale: AppLocale = 'zh-CN',
): string {
  const override = promptOverride?.trim()
  if (override) {
    return override
  }

  if (locale === 'en-US') {
    return [
      'You convert an older conversation context into short-term memories.',
      `Extract at most ${maxMemories} short-term memories from the provided messages.`,
      'Do not restate the transcript line by line; keep only recent impressions that are valuable for future turns.',
      'Return strict JSON in this shape:',
      '{"memories": Array<{"detail": string, "retrieval_text": string, "importance": number}>}',
      'detail is an internal context detail. Write it in the same language as the source context and preserve original surfaces, nicknames, aliases, abbreviations, pronoun resolutions, and statements like "X is the name/alias/abbreviation of Y".',
      'retrieval_text is for embedding, retrieval, and UI reading. Write a complete natural-language fact, scene, or event, not a tag list.',
      'If the conversation already names the current counterpart, use that name in detail and retrieval_text instead of generic "the user".',
      'When describing yourself, use first person by default; do not call yourself "AI" or "assistant" unless that is the original wording.',
      'Use this importance scale: 0.8-1.0 durable identity/preference/relationship/project facts; 0.5-0.8 useful recent facts or unresolved tasks; 0.2-0.5 weak context; below 0.2 should usually be omitted.',
      'If there is nothing worth keeping, still return {"memories": []}.',
      'Do not output markdown, code fences, or any extra explanation.',
    ].join('\n')
  }

  const defaultLines = [
    '你负责把一大段旧上下文整理成短期记忆。',
    `请从提供的消息片段里提炼最多 ${maxMemories} 条短期记忆。`,
    '不要逐句复述聊天记录，只保留对后续对话最有价值的几个近期印象。',
    '请严格返回如下 JSON 结构：',
    '{"memories": Array<{"detail": string, "retrieval_text": string, "importance": number}>}',
    SHORT_TERM_WRITE_GUIDANCE,
    '如果这段上下文里没有值得留下的短期记忆，也必须返回 {"memories": []}。',
    '不要输出 markdown、代码块或任何额外说明。',
  ]
  return defaultLines.join('\n')
}

export function buildShortTermToLongTermPrompt(
  promptOverride?: string | null,
  maxMemories = DEFAULT_MAX_SHORT_TERM_MEMORIES_PER_FLUSH,
  locale: AppLocale = 'zh-CN',
): string {
  const override = promptOverride?.trim()
  if (override) {
    return override
  }

  if (locale === 'en-US') {
    return [
      'During the sleep stage, consolidate short-term memories into more stable long-term memories.',
      `Create at most ${maxMemories} long-term memories from the provided short-term memories.`,
      'Long-term memories should be more stable and abstract; do not keep too many fleeting chat details.',
      'Each long-term memory must reference the short-term memory ids it is based on through source_stm_ids.',
      'Only reference ids that exist in the input, and do not reference unrelated short-term memories.',
      'If you cannot tell which short-term memories support a long-term memory, omit that memory.',
      'Return strict JSON in this shape:',
      '{"memories": Array<{"detail": string, "retrieval_text": string, "importance": number, "source_stm_ids": string[]}>}',
      'detail should preserve useful context and original names/aliases. retrieval_text should be a complete retrievable fact, scene, or event.',
      'If there is nothing worth consolidating, still return {"memories": []}.',
      'Do not output markdown, code fences, or any extra explanation.',
    ].join('\n')
  }

  const defaultLines = [
    '你负责在睡眠阶段把短期记忆沉淀成更稳定的长期记忆。',
    `请从提供的短期记忆里整理出最多 ${maxMemories} 条长期记忆。`,
    '长期记忆应更稳定、更抽象，不要保留太多转瞬即逝的聊天细节。',
    '每条长期记忆都必须通过 source_stm_ids 引用它实际依据的短期记忆 id。',
    '只能引用输入中存在的短期记忆 id；不要引用与该长期记忆无关的短期记忆。',
    '如果无法判断一条长期记忆来自哪些短期记忆，就不要输出这条长期记忆。',
    '请严格返回如下 JSON 结构：',
    '{"memories": Array<{"detail": string, "retrieval_text": string, "importance": number, "source_stm_ids": string[]}>}',
    WRITE_GUIDANCE,
    '如果没有值得沉淀的长期记忆，也必须返回 {"memories": []}。',
    '不要输出 markdown、代码块或任何额外说明。',
  ]
  return defaultLines.join('\n')
}

function resolveSemanticAnalyzerPromptOverride(config: Pick<MemoryModuleConfig, 'semanticAnalyzerPrompt' | 'retrievePrompt'>) {
  return config.semanticAnalyzerPrompt ?? config.retrievePrompt
}

export function buildSemanticAnalyzerPrompt(promptOverride?: string | null, locale: AppLocale = 'zh-CN'): string {
  const override = promptOverride?.trim()
  if (override) {
    return override
  }

  if (locale === 'en-US') {
    return [
      'You are the semantic analyzer for the sqlite memory system.',
      'You receive a short recent conversation and the latest user message.',
      'Return strict JSON in this shape:',
      '{"retrieval_query": string | null}',
      'Recent conversation is only for resolving pronouns, omissions, and references in the current user message. Do not expand topics or guess answers for the user.',
      'Generate retrieval_query only for the current user message.',
      'If the current user message is already self-contained, ignore recent conversation.',
      'If multiple references are possible and cannot be resolved uniquely, return "retrieval_query": null.',
      'retrieval_query must be one short complete sentence.',
      'Keep only the shortest, most stable retrieval anchor. Do not write a long explanation.',
      'Never include time information; time is handled by the time analyzer.',
      'Do not put the answer itself into the query.',
      'Do not pull extra topics from recent conversation into the query.',
      'If the recent conversation clearly names the counterpart, preserve that name instead of generalizing to "the user".',
      'When referring to yourself, use "I" by default; do not use "AI" or "assistant" unless that is the original wording.',
      'Remove speaker labels, asking/discussion wrappers, and vague retrospective shells such as "content", "thing", "conversation", or "discussion".',
      'After removing time and wrapper phrasing, keep concrete objects, topics, scenes, names, foods, bugs, places, relationships, or imagery.',
      'If no stable topic anchor remains, return "retrieval_query": null.',
      'Use the same language as the user message by default.',
      'Do not output markdown, code fences, or any extra explanation.',
    ].join('\n')
  }

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
    '如果最近对话里已经明确出现对话对象名字，例如张三、李四，retrieval_query 优先保留这个名字，不要泛化成“用户”。',
    '涉及你自己时默认写“我”，不要把“AI”或“助手”当成检索主体，除非那就是原话中的称呼。',
    'retrieval_query 不要包含说话者、提问动作、讨论动作，也不要包含“内容/事情/对话/讨论”这类回顾外壳，也不要复述整个时间回顾问句。',
    '去掉时间和回顾外壳后，如果还剩下具体对象、主题、画面、名字、食物、bug、地点、关系或意象，就保留它，不要误判成 null。',
    '如果原句是在回顾某个时间段里聊过的对象、场景、画面、名字或事件类型，去掉时间后剩下的那部分仍然是主题锚点。',
    '如果原句里明确出现了“画面”“场景”“名字”“地点”“食物”“bug”这类名词短语，而去掉时间后它们仍然存在，则 retrieval_query 不能为 null。',
    '如果剩下的主题本身就是一个抽象对象，但它已经明确指向用户要找的内容，例如“画面”“场景”“名字”“梦境”“氛围”，就把它补成一句短完整的话，不要直接只丢一个词，也不要返回 null。',
    '必要时把残缺主题补成一句短完整的话，例如“那只猫叫什么名字”“我的生日是哪天”“登录 bug 是怎么修好的”“海边灯塔和红伞的画面是什么样的”。',
    '不要把“它叫什么来着”原样输出成“它叫什么名字”。',
    '如果用户在问“我的是哪天来着”，而最近对话足够明确是在问生日，就补成“我的生日是哪天”，不要误判成 null。',
    '不要把“你还记得我喜欢那个吗”扩写成“用户喜欢拿铁还是乌龙茶”。',
    '去掉时间和回顾外壳后，如果没有稳定主题锚点，就返回 "retrieval_query": null；纯回顾问法本身不是主题锚点。',
    'retrieval_query 默认使用与用户消息相同的语言；中文提问就用中文，不要改成英文。',
    '不要输出 markdown、代码块或任何额外说明。',
  ]
  return defaultLines.join('\n')
}

export function buildMemoryFragmentPrompt(promptOverride?: string | null, locale: AppLocale = 'zh-CN'): string {
  if (promptOverride?.trim()) {
    return promptOverride.trim()
  }

  if (locale === 'en-US') {
    return [
      'The following memories are relevant and can be used directly in this reply:',
      'Treat them as memories available for this turn.',
      'If the user asks about prior interactions, past facts, or recent events and these memories are relevant, answer from them directly.',
      'Start with the newest and most relevant hits; do not let older memories override a sufficient newer memory.',
      'If the memories are still insufficient, say you are not sure instead of inventing details.',
    ].join('\n')
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

export function buildShortTermFragmentPrompt(promptOverride?: string | null, locale: AppLocale = 'zh-CN'): string {
  if (promptOverride?.trim()) {
    return promptOverride.trim()
  }

  if (locale === 'en-US') {
    return [
      'Below are short-term memories retrieved for this turn.',
      'They represent recent impressions and interactions that are still fresh.',
      'If these short-term memories are enough to answer, answer directly from them.',
    ].join('\n')
  }

  return [
    '下面是本轮检索到的短期记忆。',
    '它们代表你近期还能想起的印象和刚过去不久的互动。',
    '如果这些短期记忆足以回答，就直接基于它们回答。',
  ].join('\n')
}

export function buildFixedMemoryFragmentPrompt(promptOverride?: string | null, locale: AppLocale = 'zh-CN'): string {
  if (promptOverride?.trim()) {
    return promptOverride.trim()
  }

  if (locale === 'en-US') {
    return [
      'Below are fixed memories retrieved for this turn.',
      'They represent stable facts or preferences.',
      'If these fixed memories are relevant, use them as reliable background.',
    ].join('\n')
  }

  return [
    '下面是本轮检索到的固化记忆。',
    '它们代表稳定、长期成立的事实或偏好。',
    '如果这些固化记忆相关，就把它们当作可靠背景来使用。',
  ].join('\n')
}

export function buildLongTermSearchToolPrompt(locale: AppLocale = 'zh-CN') {
  if (locale === 'en-US') {
    return [
      'Search long-term memory only when the current context, short-term memory, and fixed memory are still not enough; if visible memory is enough, answer directly instead of treating long-term search as the default.',
      'When the user clearly asks about previously mentioned facts, preferences, relationships, events, places, or scenes and current context is insufficient, search long-term memory before deciding you are unsure.',
      'If you call this tool, query must be one short complete retrieval sentence: resolve necessary references, but do not copy vague shells like "that thing", "it", or "last time"; do not write only keywords or tags.',
      'The system combines this query with the semantic analyzer query for weighted long-term matching; do not pad extra keywords.',
      'Call at most once per turn. If the tool returns no relevant memory, accept that result and do not repeat the search or invent old events.',
    ].join(' ')
  }

  return [
    '只在当前上下文、短期记忆和固化记忆仍不足以回答时，才搜索长期记忆；如果眼前记忆已经足够，就直接回答，不要把长期记忆搜索当成默认动作。',
    '当用户明显在追问以前提过的事实、偏好、关系、事件或画面，而当前上下文又不够时，应优先搜索长期记忆，再决定是否表示不确定。',
    '如果要调用这个工具，query 必须是一句短而完整的检索句：可以补全必要指代，但不要照抄“那个、它、上次那个”这类口语外壳，不要只写词语、标签或关键词列表，也不要把时间答案直接塞进 query。',
    '系统会把这句 query 和本轮 semantic analyser 产出的检索句一起用于长期记忆匹配，并对两者加权；不要为了调用工具额外堆关键词或另造词汇。',
    '例如：那只猫叫什么名字、海边灯塔画面是什么样的、登录 bug 是怎么修好的。',
    '每轮最多调用一次。如果工具返回未搜索到相关记忆，就直接接受这个结果，不要继续重复搜索或编造旧事。',
  ].join(' ')
}

function renderMemoryLayerResult(input: {
  title: string
  missText: string
  memories: MemoryRecord[]
  prompt: string
  showNoHitMemoryFragments: boolean
  locale: AppLocale
}): string {
  if (input.memories.length === 0) {
    return input.showNoHitMemoryFragments
      ? joinPromptLines([input.prompt, input.missText])
      : ''
  }

  const [primaryMemory, ...secondaryMemories] = input.memories
  const renderMemoryLine = (label: string, memory: MemoryRecord) =>
    input.locale === 'en-US'
      ? `${label}: [${formatMemoryLayerLabel(memory.layer, input.locale)}][${formatMemoryPromptTime(memory, input.locale)}] ${memory.retrievalText}`
      : `${label}：[${formatMemoryLayerLabel(memory.layer, input.locale)}][${formatMemoryPromptTime(memory, input.locale)}] ${memory.retrievalText}`

  return [
    input.prompt,
    renderMemoryLine(input.locale === 'en-US' ? `Most relevant ${input.title} memory` : `${input.title}最相关记忆`, primaryMemory),
    ...secondaryMemories.map((memory) => renderMemoryLine(input.locale === 'en-US' ? `Additional ${input.title} memory` : `${input.title}补充记忆`, memory)),
  ].join('\n')
}

export function renderLayeredMemoryFragment(input: {
  shortTermMemories: MemoryRecord[]
  fixedMemories: MemoryRecord[]
  shortTermPrompt?: string | null
  fixedPrompt?: string | null
  showNoHitMemoryFragments: boolean
  locale?: AppLocale
}): string {
  const locale = input.locale ?? 'zh-CN'
  return joinPromptLines([
    renderMemoryLayerResult({
      title: locale === 'en-US' ? 'short-term' : '短期',
      memories: input.shortTermMemories,
      prompt: buildShortTermFragmentPrompt(input.shortTermPrompt, locale),
      missText: locale === 'en-US' ? 'Short-term memory retrieval: no relevant memory found.' : SHORT_TERM_MEMORY_MISS_TEXT,
      showNoHitMemoryFragments: input.showNoHitMemoryFragments,
      locale,
    }),
    renderMemoryLayerResult({
      title: locale === 'en-US' ? 'fixed' : '固化',
      memories: input.fixedMemories,
      prompt: buildFixedMemoryFragmentPrompt(input.fixedPrompt, locale),
      missText: locale === 'en-US' ? 'Fixed memory retrieval: no relevant memory found.' : FIXED_MEMORY_MISS_TEXT,
      showNoHitMemoryFragments: input.showNoHitMemoryFragments,
      locale,
    }),
  ])
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

function formatMemoryPromptTime(memory: MemoryRecord, locale: AppLocale = 'zh-CN'): string {
  if (memory.layer === 'short_term') {
    if (!memory.observedStartAt || !memory.observedEndAt) {
      return locale === 'en-US' ? 'time unknown' : '时间未知'
    }

    return locale === 'en-US'
      ? `occurred at ${formatLocalMemoryPromptTime(memory.observedStartAt)} - ${formatLocalMemoryPromptTime(memory.observedEndAt)}`
      : `发生于 ${formatLocalMemoryPromptTime(memory.observedStartAt)} - ${formatLocalMemoryPromptTime(memory.observedEndAt)}`
  }

  return formatLocalMemoryPromptTime(memory.createdAt)
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

function getConversationSpeakerLabel(
  role: ConversationMessage['role'],
  labels: MemoryActorLabels,
  options: { useRecallSelfLabel?: boolean } = {},
) {
  if (role === 'user') {
    return labels.counterpartLabel
  }
  if (role === 'assistant') {
    return options.useRecallSelfLabel ? (labels.recallSelfLabel || labels.selfLabel) : labels.selfLabel
  }
  return '系统'
}

function buildSemanticAnalyzerHistoryWindow(
  messages: ConversationMessage[],
  labels: MemoryActorLabels = FALLBACK_MEMORY_ACTOR_LABELS,
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

    history.unshift(`${getConversationSpeakerLabel(message.role, labels, { useRecallSelfLabel: true })}：${text}`)
    if (history.length >= maxMessages) {
      break
    }
  }

  return history
}

export function buildSemanticAnalyzerInputText(
  messages: ConversationMessage[],
  userText: string,
  labels: MemoryActorLabels = FALLBACK_MEMORY_ACTOR_LABELS,
  maxMessages = DEFAULT_SEMANTIC_ANALYZER_HISTORY_MESSAGES,
) {
  const historyWindow = buildSemanticAnalyzerHistoryWindow(messages, labels, maxMessages)
  return [
    '最近对话（仅供补全当前问题）：',
    ...(historyWindow.length > 0 ? historyWindow : ['（无）']),
    '',
    labels.currentMessageHeader,
    userText.trim() || '（空）',
  ].join('\n')
}

function buildSourceText(ctx: TurnContext, labels: MemoryActorLabels = FALLBACK_MEMORY_ACTOR_LABELS): string {
  const userText = ctx.input.text.trim()
  const assistantText = extractResponseText(ctx)

  if (!userText && !assistantText) {
    return ''
  }

  return truncate([
    `${labels.counterpartLabel}：${userText || '（空）'}`,
    `${labels.selfLabel}：${assistantText || '（空）'}`,
  ].join('\n'), MAX_MEMORY_CONTENT_CHARS)
}

export function buildContextToShortTermSourceText(
  messages: ConversationMessage[],
  labels: MemoryActorLabels = FALLBACK_MEMORY_ACTOR_LABELS,
): string {
  const lines: string[] = ['待整理的旧上下文：']
  const observedDates = messages
    .map((message) => message.createdAt)
    .filter((date): date is Date => date instanceof Date && Number.isFinite(date.getTime()))

  if (observedDates.length > 0) {
    const observedStartAt = new Date(Math.min(...observedDates.map((date) => date.getTime())))
    const observedEndAt = new Date(Math.max(...observedDates.map((date) => date.getTime())))
    lines.push(`整理窗口时间范围：${formatLocalMemoryPromptTime(observedStartAt)} - ${formatLocalMemoryPromptTime(observedEndAt)}`)
  }

  for (const message of messages) {
    const timePrefix = message.createdAt instanceof Date && Number.isFinite(message.createdAt.getTime())
      ? `[${formatLocalMemoryPromptTime(message.createdAt)}] `
      : ''
    lines.push(`${getConversationSpeakerLabel(message.role, labels)}：${timePrefix}${extractConversationMessageText(message)}`)
  }
  return truncate(lines.join('\n'), MAX_MEMORY_CONTENT_CHARS * 4)
}

export function buildShortTermToLongTermSourceText(memories: MemoryRecord[]): string {
  return [
    '待沉淀的短期记忆：',
    JSON.stringify(
      memories.map((memory) => ({
        id: memory.id,
        detail: memory.detail,
        retrieval_text: memory.retrievalText,
        importance: memory.importance,
        observedStartAt: memory.observedStartAt?.toISOString() ?? null,
        observedEndAt: memory.observedEndAt?.toISOString() ?? null,
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

function normalizeImportance(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0.5
}

function normalizeSourceStmIds(value: unknown, validSourceIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return [...new Set(
    value
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter((id) => id && validSourceIds.has(id)),
  )]
}

export function parseMemoryWriteResponse(responseText: string): MemoryWriteResult {
  const parsed = extractJson(responseText)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Memory summarize call did not return a JSON object')
  }

  const record = parsed as Record<string, unknown>
  const detail = typeof record.detail === 'string'
    ? record.detail.trim()
    : (typeof record.display_summary === 'string' ? record.display_summary.trim() : '')
  const retrievalText = typeof record.retrieval_text === 'string' ? record.retrieval_text.trim() : ''

  if (!detail || !retrievalText) {
    throw new Error('Memory summarize call returned missing detail or retrieval_text')
  }

  return {
    detail,
    retrievalText,
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
      const detail = typeof record.detail === 'string'
        ? record.detail.trim()
        : (typeof record.display_summary === 'string' ? record.display_summary.trim() : '')
      const retrievalText = typeof record.retrieval_text === 'string' ? record.retrieval_text.trim() : ''

      if (!detail || !retrievalText) {
        throw new Error(`Memory batch item ${index} is missing detail or retrieval_text`)
      }

      return {
        detail,
        retrievalText,
        importance: normalizeImportance(record.importance),
      }
    })
}

export function parseShortTermToLongTermResponse(
  responseText: string,
  maxCount: number,
  validSourceIds: ReadonlySet<string>,
): ShortTermToLongTermMemoryWriteResult[] {
  const parsed = extractJson(responseText)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Short-term to long-term memory call did not return a JSON object')
  }

  const rawMemories = (parsed as { memories?: unknown }).memories
  if (!Array.isArray(rawMemories)) {
    throw new Error('Short-term to long-term memory call did not return a memories array')
  }

  const results: ShortTermToLongTermMemoryWriteResult[] = []
  for (const [index, memory] of rawMemories.entries()) {
    if (results.length >= maxCount) {
      break
    }
    if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
      throw new Error(`Short-term to long-term memory item ${index} is not an object`)
    }

    const record = memory as Record<string, unknown>
    const detail = typeof record.detail === 'string'
      ? record.detail.trim()
      : (typeof record.display_summary === 'string' ? record.display_summary.trim() : '')
    const retrievalText = typeof record.retrieval_text === 'string' ? record.retrieval_text.trim() : ''

    if (!detail || !retrievalText) {
      throw new Error(`Short-term to long-term memory item ${index} is missing detail or retrieval_text`)
    }

    const sourceStmIds = normalizeSourceStmIds(record.source_stm_ids, validSourceIds)
    if (sourceStmIds.length === 0) {
      continue
    }

    results.push({
      detail,
      retrievalText,
      importance: normalizeImportance(record.importance),
      sourceStmIds,
    })
  }

  return results
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

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0
  }

  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function overlapsTimeRange(
  memory: Pick<MemoryRecord, 'observedStartAt' | 'observedEndAt' | 'createdAt'>,
  timeRange: MemoryTimeAnalysisResult['timeRange'],
) {
  if (!timeRange) {
    return true
  }

  const start = memory.observedStartAt ?? memory.createdAt
  const end = memory.observedEndAt ?? memory.observedStartAt ?? memory.createdAt
  return start.getTime() <= timeRange.end.getTime() && end.getTime() >= timeRange.start.getTime()
}

function episodicMemoryToTemporaryShortTerm(
  memory: ReturnType<typeof episodicMemoryGraphRepo.listActiveEpisodicMemories>[number]['memory'],
): MemoryRecord {
  const text = memory.detail?.trim() || memory.summary
  return {
    id: memory.id,
    agentId: memory.agentId,
    sessionId: memory.sessionId,
    layer: 'short_term',
    sourceText: memory.sourceText,
    detail: text,
    retrievalText: text,
    retrievalEmbedding: memory.retrievalEmbedding,
    retrievalModel: memory.retrievalModel,
    tags: ['activated_episodic'],
    importance: memory.importance,
    observedStartAt: memory.observedStartAt,
    observedEndAt: memory.observedEndAt,
    createdAt: memory.createdAt,
  }
}

function retrieveActiveEpisodicAsShortTerm(input: {
  agentId: string
  queryEmbeddings: number[][]
  topK: number
  minSimilarity: number
  timeRange: MemoryTimeAnalysisResult['timeRange']
}) {
  const queries = input.queryEmbeddings
    .map((embedding) => embedding.filter((value) => typeof value === 'number' && Number.isFinite(value)))
    .filter((embedding) => embedding.length > 0)

  if (queries.length === 0 && !input.timeRange) {
    return []
  }

  return episodicMemoryGraphRepo
    .listActiveEpisodicMemories({
      agentId: input.agentId,
      limit: Math.max(1, Math.min(20, Math.floor(input.topK))),
    })
    .map((item) => {
      const memory = item.memory
      const similarity = queries.length > 0
        ? Math.max(...queries.map((query) => cosineSimilarity(query, memory.retrievalEmbedding)))
        : 1
      return { memory, similarity, activationScore: item.score, activatedAt: item.activatedAt }
    })
    .filter((hit) => overlapsTimeRange({
      observedStartAt: hit.activatedAt,
      observedEndAt: hit.activatedAt,
      createdAt: hit.activatedAt,
    }, input.timeRange))
    .filter((hit) => queries.length === 0 || hit.similarity >= input.minSimilarity)
    .sort((left, right) => {
      if (right.similarity !== left.similarity) {
        return right.similarity - left.similarity
      }
      if (right.activationScore !== left.activationScore) {
        return right.activationScore - left.activationScore
      }
      if (right.memory.importance !== left.memory.importance) {
        return right.memory.importance - left.memory.importance
      }
      return right.memory.createdAt.getTime() - left.memory.createdAt.getTime()
    })
    .slice(0, Math.max(1, Math.floor(input.topK)))
    .map((hit) => episodicMemoryToTemporaryShortTerm(hit.memory))
}

export class MemorySqliteSystem implements AgentSystem {
  name = 'memory:sqlite'
  type = 'memory'

  private readonly summarizeModel: string | null
  private readonly embeddingModel: string
  private readonly retrieveTopK: number
  private readonly shortTermRetrieveTopK: number
  private readonly fixedRetrieveTopK: number
  private readonly shortTermMinSimilarity: number
  private readonly fixedMinSimilarity: number
  private readonly embedder: MemoryEmbedder
  private readonly contextWindowMessages: number
  private readonly contextOverflowBatchSize: number
  private readonly contextIdleFlushMinutes: number
  private readonly maxShortTermMemoriesPerFlush: number
  private readonly semanticAnalyzerHistoryMessages: number
  private readonly longTermSearchDefaultTopK: number
  private readonly showNoHitMemoryFragments: boolean
  private readonly sleepEnabled: boolean
  private readonly sleepTimeLocal: string
  private readonly sleepIntervalDays: number
  private readonly legacyRetrievePrompt: string | null
  private readonly timeParser: (userText: string, referenceDate?: Date) => MemoryTimeAnalysisResult
  private readonly semanticAnalyzerPrompt: string | null
  private readonly contextToShortTermPrompt: string | null
  private readonly shortTermToLongTermPrompt: string | null
  private readonly fragmentPrompt: string | null
  private readonly shortTermFragmentPrompt: string | null
  private readonly fixedFragmentPrompt: string | null
  private readonly locale: AppLocale

  constructor(config?: unknown, locale: AppLocale = 'zh-CN') {
    const resolved = readConfig(config, locale)
    this.locale = locale
    this.summarizeModel = resolved.summarizeModel
    this.embeddingModel = resolved.embeddingModel
    this.retrieveTopK = resolved.retrieveTopK
    this.shortTermRetrieveTopK = resolved.shortTermRetrieveTopK
    this.fixedRetrieveTopK = resolved.fixedRetrieveTopK
    this.shortTermMinSimilarity = resolved.shortTermMinSimilarity
    this.fixedMinSimilarity = resolved.fixedMinSimilarity
    this.embedder = resolved.embedder
    this.contextWindowMessages = resolved.contextWindowMessages
    this.contextOverflowBatchSize = resolved.contextOverflowBatchSize
    this.contextIdleFlushMinutes = resolved.contextIdleFlushMinutes
    this.maxShortTermMemoriesPerFlush = resolved.maxShortTermMemoriesPerFlush
    this.semanticAnalyzerHistoryMessages = resolved.semanticAnalyzerHistoryMessages
    this.longTermSearchDefaultTopK = resolved.longTermSearchDefaultTopK
    this.showNoHitMemoryFragments = resolved.showNoHitMemoryFragments
    this.sleepEnabled = resolved.sleepEnabled
    this.sleepTimeLocal = resolved.sleepTimeLocal
    this.sleepIntervalDays = resolved.sleepIntervalDays
    this.legacyRetrievePrompt = resolved.retrievePrompt
    this.timeParser = resolved.timeParser
    this.semanticAnalyzerPrompt = resolved.semanticAnalyzerPrompt
    this.contextToShortTermPrompt = resolved.contextToShortTermPrompt
    this.shortTermToLongTermPrompt = resolved.shortTermToLongTermPrompt
    this.fragmentPrompt = resolved.fragmentPrompt
    this.shortTermFragmentPrompt = resolved.shortTermFragmentPrompt
    this.fixedFragmentPrompt = resolved.fixedFragmentPrompt
  }

  async beforeTurn(ctx: TurnContext): Promise<void> {
    let agent: ReturnType<typeof agentRepo.getAgent> | null = null
    try {
      agent = agentRepo.getAgent(ctx.agentId)
    } catch {
      agent = null
    }
    const activeEpisodicLimit = agent?.tools?.search_long_term_memory?.episodicActivation?.maxActive
      ?? DEFAULT_EPISODIC_ACTIVATION_MAX_ACTIVE
    try {
      episodicMemoryGraphRepo.pruneExpiredEpisodicMemoryActivations({ agentId: ctx.agentId })
    } catch {
      // Expired activation cleanup should not block the normal memory query.
    }

    const actorLabels = resolveMemoryActorLabels({
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
    })
    ctx.state.memoryActorLabels = actorLabels
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
        prompt: buildSemanticAnalyzerPrompt(semanticPromptOverride, this.locale),
        inputText: buildSemanticAnalyzerInputText(
          ctx.messages,
          ctx.input.text,
          actorLabels,
          this.semanticAnalyzerHistoryMessages,
        ),
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
            topK: this.shortTermRetrieveTopK || this.retrieveTopK,
            minSimilarity: this.shortTermMinSimilarity,
            layers: ['short_term'],
            timeRange: query.timeRange,
          })),
          Promise.resolve(memoryRepo.findRelevantMemories({
            agentId: ctx.agentId,
            queryEmbeddings,
            topK: this.fixedRetrieveTopK || this.retrieveTopK,
            minSimilarity: this.fixedMinSimilarity,
            layers: ['fixed'],
            timeRange: query.timeRange,
          })),
        ])

        const activeEpisodicShortTerm = retrieveActiveEpisodicAsShortTerm({
          agentId: ctx.agentId,
          queryEmbeddings,
          topK: activeEpisodicLimit,
          minSimilarity: this.shortTermMinSimilarity,
          timeRange: query.timeRange,
        })

        return { shortTerm: [...shortTerm, ...activeEpisodicShortTerm], fixed }
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
      showNoHitMemoryFragments: this.showNoHitMemoryFragments,
      locale: this.locale,
    })

    if (content) {
      ctx.promptFragments.push({
        source: this.name,
        priority: 30,
        content,
      })
    }
  }

  async afterTurn(ctx: TurnContext): Promise<void> {
    ctx.pendingMemoryWrite = undefined
  }
}

export function serializeMemoryHit(memory: MemoryRecord) {
  return {
    id: memory.id,
    detail: memory.detail,
    retrievalText: memory.retrievalText,
    layer: memory.layer,
    importance: memory.importance,
  }
}
