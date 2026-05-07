import { agentRepo, episodicMemoryGraphRepo } from '@mas/db'
import {
  buildEntityMentionPrompt,
  buildLongTermSearchToolPrompt,
  buildSemanticAnalyzerPrompt,
  createMemoryEmbedder,
  DEFAULT_MEMORY_EMBEDDING_MODEL,
  isSqliteMemoryConfig,
  parseEntityMentionResponse,
  resolveMemorySqliteConfig,
} from '@mas/systems'
import type { Tool } from './types'
import { createProvider } from '../provider/factory'
import type { LLMProvider } from '../provider/types'
import type { Message, TextBlock } from '../types'

const SEARCH_LONG_TERM_MEMORY_DESCRIPTION = [
  buildLongTermSearchToolPrompt('zh-CN'),
  '拿到工具结果后，继续完成本轮回复。',
].join(' ')
type AppLocale = 'zh-CN' | 'en-US'
const SEMANTIC_QUERY_WEIGHT = 0.8
const TOOL_QUERY_WEIGHT = 0.2
const EPISODIC_GRAPH_WEIGHT = 0.4
const EPISODIC_TEXT_WEIGHT = 0.5
const EPISODIC_IMPORTANCE_WEIGHT = 0.1
const EPISODIC_SUMMARY_EMBEDDING_BACKFILL_BATCH_SIZE = 100
const DEFAULT_EPISODIC_ACTIVATION_TTL_MINUTES = 20
const DEFAULT_EPISODIC_ACTIVATION_MAX_ACTIVE = 5

async function ensureEpisodicSummaryEmbeddings(input: {
  agentId: string
  model: string
  embedder: ReturnType<typeof createMemoryEmbedder>
}) {
  while (true) {
    const memories = episodicMemoryGraphRepo.listEpisodicMemoriesNeedingSummaryEmbedding({
      agentId: input.agentId,
      embeddingModel: input.model,
      limit: EPISODIC_SUMMARY_EMBEDDING_BACKFILL_BATCH_SIZE,
    })
    if (memories.length === 0) {
      return
    }

    const embeddings = await input.embedder.embed(
      memories.map((memory) => memory.summary),
      {
        model: input.model,
        inputType: 'search_document',
      },
    )

    for (const [index, memory] of memories.entries()) {
      episodicMemoryGraphRepo.updateEpisodicSummaryEmbedding({
        memoryId: memory.id,
        embedding: embeddings[index] ?? [],
        embeddingModel: input.model,
      })
    }
  }
}

function readQueryText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function resolveEpisodicActivationConfig(agent: NonNullable<ReturnType<typeof agentRepo.getAgent>>) {
  const config = agent.tools?.search_long_term_memory?.episodicActivation
  return {
    enabled: config?.enabled ?? true,
    ttlMinutes: Math.max(1, Math.min(24 * 60, Math.floor(config?.ttlMinutes ?? DEFAULT_EPISODIC_ACTIVATION_TTL_MINUTES))),
    maxActive: Math.max(1, Math.min(20, Math.floor(config?.maxActive ?? DEFAULT_EPISODIC_ACTIVATION_MAX_ACTIVE))),
  }
}

function extractMessageText(message: Message) {
  if (typeof message.content === 'string') {
    return message.content.trim()
  }

  return message.content
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n')
}

function formatRecentContext(messages: Message[] | undefined, currentQuery: string, assistantLabel = '我') {
  const recent = (messages ?? [])
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      text: extractMessageText(message),
    }))
    .filter((message) => message.text)
    .slice(-6)

  if (recent.length === 0) {
    return currentQuery
  }

  const recentText = recent
    .map((message) => `${message.role === 'user' ? '用户' : assistantLabel}：${message.text}`)
    .join('\n')

  return [
    '最近对话（仅供补全当前检索问题里的代词、省略、回指，不要顺手抽取上下文里的额外实体）：',
    recentText,
    '',
    '当前检索问题：',
    currentQuery,
  ].join('\n')
}

async function extractEntityMentions(input: {
  text: string
  model: string
  provider: Pick<LLMProvider, 'sendMessage'>
  promptOverride?: string | null
  locale?: AppLocale
  signal?: AbortSignal
}) {
  if (!input.text.trim()) {
    return []
  }

  const response = await input.provider.sendMessage({
    model: input.model,
    systemPrompt: buildEntityMentionPrompt(input.promptOverride, input.locale),
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: input.text }],
      },
    ],
    reasoning: { effort: 'none' },
    signal: input.signal,
  })

  return parseEntityMentionResponse(
    response.content
      .map((block) => block.type === 'text' ? block.text : '')
      .join('\n'),
  )
}

function parseRetrievalQuery(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return ''
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  try {
    const parsed = JSON.parse(candidate) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return ''
    }
    const value = (parsed as { retrieval_query?: unknown }).retrieval_query
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  } catch {
    return ''
  }
}

async function extractEpisodicTextQuery(input: {
  text: string
  fallbackQuery: string
  model: string
  provider: Pick<LLMProvider, 'sendMessage'>
  promptOverride?: string | null
  locale?: AppLocale
  signal?: AbortSignal
}) {
  if (!input.text.trim()) {
    return input.fallbackQuery
  }

  const response = await input.provider.sendMessage({
    model: input.model,
    systemPrompt: buildSemanticAnalyzerPrompt(input.promptOverride, input.locale),
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: input.text }],
      },
    ],
    reasoning: { effort: 'none' },
    signal: input.signal,
  })
  const parsed = parseRetrievalQuery(
    response.content
      .map((block) => block.type === 'text' ? block.text : '')
      .join('\n'),
  )

  return parsed || input.fallbackQuery
}

function scoreByRank(index: number) {
  return Math.max(0, 1 - index * 0.08)
}

export const SearchLongTermMemoryTool: Tool = {
  name: 'search_long_term_memory',
  description: SEARCH_LONG_TERM_MEMORY_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      time_start: { type: 'string' },
      time_end: { type: 'string' },
      top_k: { type: 'integer', minimum: 1, maximum: 5 },
    },
    additionalProperties: false,
  },
  async call(input, options) {
    const locale = options?.locale ?? 'zh-CN'
    const noLongTermResults = locale === 'en-US'
      ? 'Long-term memory search: no relevant memory found.'
      : '长期记忆检索结果：未搜索到相关记忆。'
    if (!options?.agentId) {
      return {
        output: noLongTermResults,
        isError: true,
        metadata: { noResults: true, reason: 'missing_agent' },
      }
    }

    const agent = agentRepo.getAgent(options.agentId)
    if (!agent || !isSqliteMemoryConfig(agent.modules?.memory)) {
      return {
        output: noLongTermResults,
        isError: false,
        metadata: { noResults: true, reason: 'memory_not_sqlite' },
      }
    }

    const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory, locale)
    const agentId = options.agentId
    const embedder = createMemoryEmbedder(memoryConfig.embeddingProvider)
    const semanticQuery = readQueryText(options?.memoryRetrievalQuery)
    const toolQuery = readQueryText(input.query)
    const topK = typeof input.top_k === 'number' && Number.isFinite(input.top_k)
      ? Math.max(1, Math.min(5, Math.floor(input.top_k)))
      : Math.max(1, Math.min(5, memoryConfig.longTermSearchDefaultTopK ?? 3))
    const episodicActivationConfig = resolveEpisodicActivationConfig(agent)
    const effectiveQueries = [
      semanticQuery
        ? { source: 'semantic_analyzer', query: semanticQuery, weight: SEMANTIC_QUERY_WEIGHT }
        : null,
      toolQuery && toolQuery !== semanticQuery
        ? {
          source: 'tool_input',
          query: toolQuery,
          weight: semanticQuery ? TOOL_QUERY_WEIGHT : 1,
        }
        : null,
    ].filter((entry): entry is { source: 'semantic_analyzer' | 'tool_input'; query: string; weight: number } => Boolean(entry))

    if (effectiveQueries.length === 0) {
      return {
        output: noLongTermResults,
        isError: false,
        metadata: { noResults: true, reason: 'empty_query' },
      }
    }

    const graphQuery = [toolQuery, semanticQuery]
      .filter(Boolean)
      .join('\n')
    const assistantLabel = agent.name.trim() || (locale === 'en-US' ? 'assistant' : '我')
    const analyzerInput = formatRecentContext(options?.recentMessages, graphQuery, assistantLabel)
    const graphProvider = options.provider ?? createProvider(agent.provider)
    const textQuery = await extractEpisodicTextQuery({
      text: analyzerInput,
      fallbackQuery: semanticQuery || toolQuery,
      model: memoryConfig.summarizeModel ?? agent.model,
      provider: graphProvider,
      promptOverride: memoryConfig.semanticAnalyzerPrompt ?? memoryConfig.retrievePrompt,
      locale,
      signal: options.signal,
    }).catch(() => semanticQuery || toolQuery)
    const mentions = episodicMemoryGraphRepo.hasEntitiesForAgent(agentId)
      ? await extractEntityMentions({
        text: analyzerInput,
        model: memoryConfig.summarizeModel ?? agent.model,
        provider: graphProvider,
        promptOverride: memoryConfig.entityMentionPrompt,
        locale,
        signal: options.signal,
      }).catch(() => [])
      : []
    const mentionCandidates = mentions.flatMap((mention) =>
      episodicMemoryGraphRepo.findEntityCandidates({
        agentId,
        type: mention.type,
        surface: mention.surface,
        limit: 10,
      }).map((candidate) => ({
        ...candidate,
        mention,
      })),
    )
    const graphCandidates = mentionCandidates
    const graphActivation = graphCandidates.length === 1 ? 1 : 0.7
    const activatedEntityById = new Map<string, {
      id: string
      canonicalName: string
      type: string
      description: string | null
      activation: number
    }>()
    for (const candidate of graphCandidates) {
      const existing = activatedEntityById.get(candidate.entity.id)
      activatedEntityById.set(candidate.entity.id, {
        id: candidate.entity.id,
        canonicalName: candidate.entity.canonicalName,
        type: candidate.entity.type,
        description: candidate.entity.description,
        activation: Math.max(existing?.activation ?? 0, graphActivation),
      })
    }

    let graphHits: ReturnType<typeof episodicMemoryGraphRepo.recallEpisodicMemories> = []
    if (graphCandidates.length > 0) {
      graphHits = episodicMemoryGraphRepo.recallEpisodicMemories({
        agentId,
        topK: Math.max(5, topK * 3),
        activations: graphCandidates.map((candidate) => ({
          entityId: candidate.entity.id,
          activation: graphActivation,
        })),
        spreadFactor: 0.35,
      })
    }

    const episodicEmbeddingModel = memoryConfig.embeddingModel || DEFAULT_MEMORY_EMBEDDING_MODEL
    await ensureEpisodicSummaryEmbeddings({
      agentId,
      model: episodicEmbeddingModel,
      embedder,
    }).catch(() => undefined)

    const episodicTextHits = textQuery
      ? await embedder.embed(
        [textQuery],
        {
          model: episodicEmbeddingModel,
          inputType: 'search_query',
        },
      ).then((queryEmbeddings) => episodicMemoryGraphRepo.findRelevantEpisodicMemories({
        agentId,
        queryEmbeddings,
        topK: Math.max(5, topK * 3),
      })).catch(() => [])
      : []
    const fused = new Map<string, {
      memory: NonNullable<ReturnType<typeof episodicMemoryGraphRepo.getEpisodicMemory>>
      graphScore: number
      textScore: number
      finalScore: number
    }>()

    graphHits.forEach((memory, index) => {
      fused.set(memory.id, {
        memory,
        graphScore: scoreByRank(index),
        textScore: 0,
        finalScore: 0,
      })
    })
    episodicTextHits.forEach((hit) => {
      const existing = fused.get(hit.memory.id)
      fused.set(hit.memory.id, {
        memory: hit.memory,
        graphScore: existing?.graphScore ?? 0,
        textScore: Math.max(existing?.textScore ?? 0, hit.similarity),
        finalScore: 0,
      })
    })

    const episodic = [...fused.values()]
      .map((hit) => ({
        ...hit,
        finalScore:
          hit.graphScore * EPISODIC_GRAPH_WEIGHT
          + hit.textScore * EPISODIC_TEXT_WEIGHT
          + hit.memory.importance * EPISODIC_IMPORTANCE_WEIGHT,
      }))
      .sort((left, right) => {
        if (right.finalScore !== left.finalScore) {
          return right.finalScore - left.finalScore
        }
        return right.memory.createdAt.getTime() - left.memory.createdAt.getTime()
      })
      .slice(0, topK)

    if (episodic.length > 0) {
      const now = new Date()
      if (episodicActivationConfig.enabled) {
        episodicMemoryGraphRepo.activateEpisodicMemories({
          agentId,
          memories: episodic
            .slice(0, episodicActivationConfig.maxActive)
            .map((hit) => ({ memoryId: hit.memory.id, score: hit.finalScore })),
          sourceToolName: SearchLongTermMemoryTool.name,
          activatedAt: now,
          expiresAt: new Date(now.getTime() + episodicActivationConfig.ttlMinutes * 60_000),
        })
      }

      return {
        output: [
          locale === 'en-US' ? 'Episodic memory recall results:' : '情景记忆召回结果：',
          ...episodic.map((hit) => `${locale === 'en-US' ? '[Episodic memory]' : '[情景记忆]'} ${hit.memory.detail || hit.memory.summary}`),
        ].join('\n'),
        metadata: {
          noResults: false,
          mode: 'episodic_hybrid',
          effectiveQueries,
          textQuery,
          episodicActivation: {
            enabled: episodicActivationConfig.enabled,
            ttlMinutes: episodicActivationConfig.ttlMinutes,
            maxActive: episodicActivationConfig.maxActive,
          },
          entityMentions: mentions,
          entityCandidates: mentionCandidates.map((candidate) => ({
            mention: {
              surface: candidate.mention.surface,
              type: candidate.mention.type,
              contextHint: candidate.mention.contextHint,
              confidence: candidate.mention.confidence,
            },
            entity: {
              id: candidate.entity.id,
              canonicalName: candidate.entity.canonicalName,
              type: candidate.entity.type,
              description: candidate.entity.description,
            },
            matchKind: candidate.matchKind,
          })),
          activatedEntities: [...activatedEntityById.values()],
          hits: episodic.map((hit) => ({
            id: hit.memory.id,
            sessionId: hit.memory.sessionId,
            detail: hit.memory.detail,
            summary: hit.memory.summary,
            observedStartAt: hit.memory.observedStartAt?.toISOString() ?? null,
            observedEndAt: hit.memory.observedEndAt?.toISOString() ?? null,
            importance: hit.memory.importance,
            graphScore: hit.graphScore,
            textScore: hit.textScore,
            score: hit.finalScore,
            entities: episodicMemoryGraphRepo.getEpisodicMemoryWithEntities(hit.memory.id)?.entities.map((link) => ({
              id: link.entity.id,
              canonicalName: link.entity.canonicalName,
              type: link.entity.type,
              description: link.entity.description,
              weight: link.weight,
            })) ?? [],
          })),
        },
      }
    }

    return {
      output: noLongTermResults,
      isError: false,
      metadata: { noResults: true, mode: 'episodic_hybrid', hits: [], effectiveQueries, textQuery },
    }
  },
}
