import { agentRepo, episodicMemoryGraphRepo, memoryRepo } from '@mas/db'
import {
  buildEntityMentionPrompt,
  buildLongTermSearchToolPrompt,
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
  signal?: AbortSignal
}) {
  if (!input.text.trim()) {
    return []
  }

  const response = await input.provider.sendMessage({
    model: input.model,
    systemPrompt: buildEntityMentionPrompt(),
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
    const mentions = episodicMemoryGraphRepo.hasEntitiesForAgent(agentId)
      ? await extractEntityMentions({
        text: graphQuery,
        model: memoryConfig.summarizeModel ?? agent.model,
        provider: graphProvider,
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
    const directCandidates = mentions.length === 0 && graphQuery
      ? episodicMemoryGraphRepo.findEntityCandidates({
        agentId,
        surface: graphQuery,
        limit: 10,
      }).map((candidate) => ({
        ...candidate,
        mention: null,
      }))
      : []
    const graphCandidates = mentionCandidates.length > 0 ? mentionCandidates : directCandidates

    if (graphCandidates.length > 0) {
      const activation = graphCandidates.length === 1 ? 1 : 0.7
      episodicMemoryGraphRepo.activateEntities({
        agentId,
        activations: graphCandidates.map((candidate) => ({
          entityId: candidate.entity.id,
          activation,
          reason: 'tool_recall',
        })),
        ttlMs: 30 * 60 * 1000,
        maxActive: 20,
        spreadFactor: 0.35,
      })
      const episodic = episodicMemoryGraphRepo.recallEpisodicMemories({
        agentId,
        topK,
      })

      if (episodic.length > 0) {
        return {
          output: [
            '情景记忆召回结果：',
            ...episodic.map((memory) => `[情景记忆] ${memory.summary}`),
          ].join('\n'),
          metadata: {
            noResults: false,
            mode: 'episodic_entity_graph',
            effectiveQueries,
            entityMentions: mentions,
            hits: episodic.map((memory) => ({
              id: memory.id,
              sessionId: memory.sessionId,
              summary: memory.summary,
              observedStartAt: memory.observedStartAt?.toISOString() ?? null,
              observedEndAt: memory.observedEndAt?.toISOString() ?? null,
              importance: memory.importance,
            })),
          },
        }
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
        ...hits.map((memory) => `[长期记忆][${formatLocalMemoryPromptTime(memory.createdAt)}] ${memory.displaySummary}`),
      ].join('\n'),
      metadata: {
        noResults: false,
        effectiveQueries,
        hits: hits.map((memory) => ({
          id: memory.id,
          sessionId: memory.sessionId,
          layer: memory.layer,
          displaySummary: memory.displaySummary,
          createdAt: memory.createdAt.toISOString(),
          importance: memory.importance,
        })),
      },
    }
  },
}
