import { agentRepo, memoryRepo } from '@mas/db'
import {
  buildLongTermSearchToolPrompt,
  createOpenRouterMemoryEmbedder,
  DEFAULT_MEMORY_EMBEDDING_MODEL,
  isSqliteMemoryConfig,
  resolveMemorySqliteConfig,
} from '@mas/systems'
import type { Tool } from './types'

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
    const embedder = createOpenRouterMemoryEmbedder()
    const semanticQuery = readQueryText(options?.memoryRetrievalQuery)
    const toolQuery = readQueryText(input.query)
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

    const queryEmbeddings = await embedder.embed(
      effectiveQueries.map((entry) => entry.query),
      {
        model: memoryConfig.embeddingModel || DEFAULT_MEMORY_EMBEDDING_MODEL,
        inputType: 'search_query',
      },
    )

    const start = parseDate(input.time_start)
    const end = parseDate(input.time_end)
    const topK = typeof input.top_k === 'number' && Number.isFinite(input.top_k)
      ? Math.max(1, Math.min(5, Math.floor(input.top_k)))
      : Math.max(1, Math.min(5, memoryConfig.longTermSearchDefaultTopK ?? 3))

    const hits = memoryRepo.findRelevantMemories({
      agentId: options.agentId,
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
          tags: memory.tags,
        })),
      },
    }
  },
}
