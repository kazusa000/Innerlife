import { agentRepo, episodicMemoryGraphRepo, memoryRepo } from '@mas/db'
import {
  buildEntityMentionPrompt,
  buildLongTermSearchToolPrompt,
  buildSemanticAnalyzerPrompt,
  createOpenRouterMemoryEmbedder,
  DEFAULT_MEMORY_EMBEDDING_MODEL,
  isSqliteMemoryConfig,
  parseEntityMentionResponse,
  resolveMemorySqliteConfig,
} from '@mas/systems'
import type { Tool } from './types'
import { createProvider } from '../provider/factory'
import type { LLMProvider } from '../provider/types'

const SEARCH_LONG_TERM_MEMORY_DESCRIPTION = [
  buildLongTermSearchToolPrompt(),
  '拿到工具结果后，继续完成本轮回复。',
].join(' ')
const SEMANTIC_QUERY_WEIGHT = 0.8
const TOOL_QUERY_WEIGHT = 0.2
const EPISODIC_GRAPH_WEIGHT = 0.4
const EPISODIC_TEXT_WEIGHT = 0.5
const EPISODIC_IMPORTANCE_WEIGHT = 0.1

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

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function readQueryText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

async function extractEntityMentions(input: {
  text: string
  model: string
  provider: Pick<LLMProvider, 'sendMessage'>
  promptOverride?: string | null
  signal?: AbortSignal
}) {
  if (!input.text.trim()) {
    return []
  }

  const response = await input.provider.sendMessage({
    model: input.model,
    systemPrompt: buildEntityMentionPrompt(input.promptOverride),
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
  signal?: AbortSignal
}) {
  if (!input.text.trim()) {
    return input.fallbackQuery
  }

  const response = await input.provider.sendMessage({
    model: input.model,
    systemPrompt: buildSemanticAnalyzerPrompt(input.promptOverride),
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
    if (!options?.agentId) {
      return {
        output: '长期记忆检索结果：未搜索到相关记忆。',
        isError: true,
        metadata: { noResults: true, reason: 'missing_agent' },
      }
    }

    const agent = agentRepo.getAgent(options.agentId)
    if (!agent || !isSqliteMemoryConfig(agent.modules?.memory)) {
      return {
        output: '长期记忆检索结果：未搜索到相关记忆。',
        isError: false,
        metadata: { noResults: true, reason: 'memory_not_sqlite' },
      }
    }

    const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory)
    const agentId = options.agentId
    const embedder = createOpenRouterMemoryEmbedder()
    const semanticQuery = readQueryText(options?.memoryRetrievalQuery)
    const toolQuery = readQueryText(input.query)
    const start = parseDate(input.time_start)
    const end = parseDate(input.time_end)
    const topK = typeof input.top_k === 'number' && Number.isFinite(input.top_k)
      ? Math.max(1, Math.min(5, Math.floor(input.top_k)))
      : Math.max(1, Math.min(5, memoryConfig.longTermSearchDefaultTopK ?? 3))
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
        output: '长期记忆检索结果：未搜索到相关记忆。',
        isError: false,
        metadata: { noResults: true, reason: 'empty_query' },
      }
    }

    const graphQuery = [toolQuery, semanticQuery]
      .filter(Boolean)
      .join('\n')
    const graphProvider = options.provider ?? createProvider(agent.provider)
    const textQuery = await extractEpisodicTextQuery({
      text: graphQuery,
      fallbackQuery: semanticQuery || toolQuery,
      model: memoryConfig.summarizeModel ?? agent.model,
      provider: graphProvider,
      promptOverride: memoryConfig.semanticAnalyzerPrompt ?? memoryConfig.retrievePrompt,
      signal: options.signal,
    }).catch(() => semanticQuery || toolQuery)
    const mentions = episodicMemoryGraphRepo.hasEntitiesForAgent(agentId)
      ? await extractEntityMentions({
        text: graphQuery,
        model: memoryConfig.summarizeModel ?? agent.model,
        provider: graphProvider,
        promptOverride: memoryConfig.entityMentionPrompt,
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

    let graphHits: ReturnType<typeof episodicMemoryGraphRepo.recallEpisodicMemories> = []
    if (graphCandidates.length > 0) {
      const activation = graphCandidates.length === 1 ? 1 : 0.7
      graphHits = episodicMemoryGraphRepo.recallEpisodicMemories({
        agentId,
        topK: Math.max(5, topK * 3),
        activations: graphCandidates.map((candidate) => ({
          entityId: candidate.entity.id,
          activation,
        })),
        spreadFactor: 0.35,
      })
    }

    const episodicTextHits = textQuery
      ? await embedder.embed(
        [textQuery],
        {
          model: memoryConfig.embeddingModel || DEFAULT_MEMORY_EMBEDDING_MODEL,
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
      return {
        output: [
          '情景记忆召回结果：',
          ...episodic.map((hit) => `[情景记忆] ${hit.memory.retrievalText || hit.memory.summary}`),
        ].join('\n'),
        metadata: {
          noResults: false,
          mode: 'episodic_hybrid',
          effectiveQueries,
          textQuery,
          entityMentions: mentions,
          hits: episodic.map((hit) => ({
            id: hit.memory.id,
            sessionId: hit.memory.sessionId,
            detail: hit.memory.summary,
            retrievalText: hit.memory.retrievalText,
            observedStartAt: hit.memory.observedStartAt?.toISOString() ?? null,
            observedEndAt: hit.memory.observedEndAt?.toISOString() ?? null,
            importance: hit.memory.importance,
            graphScore: hit.graphScore,
            textScore: hit.textScore,
            score: hit.finalScore,
          })),
        },
      }
    }

    const queryEmbeddings = await embedder.embed(
      effectiveQueries.map((entry) => entry.query),
      {
        model: memoryConfig.embeddingModel || DEFAULT_MEMORY_EMBEDDING_MODEL,
        inputType: 'search_query',
      },
    )

    const hits = memoryRepo.findRelevantMemories({
      agentId,
      queryEmbeddings,
      queryWeights: effectiveQueries.map((entry) => entry.weight),
      topK,
      layers: ['long_term'],
      timeRange: start && end ? { start, end } : null,
    })

    if (hits.length === 0) {
      return {
        output: '长期记忆检索结果：未搜索到相关记忆。',
        isError: false,
        metadata: { noResults: true, hits: [], effectiveQueries },
      }
    }

    return {
      output: [
        '长期记忆检索结果：',
        ...hits.map((memory) => `[长期记忆][${formatLocalMemoryPromptTime(memory.createdAt)}] ${memory.retrievalText}`),
      ].join('\n'),
      metadata: {
        noResults: false,
        effectiveQueries,
        hits: hits.map((memory) => ({
          id: memory.id,
          sessionId: memory.sessionId,
          layer: memory.layer,
          detail: memory.detail,
          retrievalText: memory.retrievalText,
          createdAt: memory.createdAt.toISOString(),
          importance: memory.importance,
        })),
      },
    }
  },
}
