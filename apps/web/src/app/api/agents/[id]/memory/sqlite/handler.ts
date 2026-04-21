import { agentRepo, memoryRepo } from '@mas/db'
import {
  buildMemoryConsolidationPrompt,
  buildMemoryFragmentPrompt,
  buildRetrievePrompt,
  buildSummaryPrompt,
  isSqliteMemoryConfig,
  resolveMemorySqliteConfig,
} from '@mas/systems'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

type MemoryListOptions = {
  page?: number
  pageSize?: number
  layer?: 'short_term' | 'long_term' | 'fixed'
}

function readOptionalText(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed || null
}

export function listSqliteMemories(agentId: string, query?: string, options: MemoryListOptions = {}) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory)
  const page = typeof options.page === 'number' ? options.page : 1
  const pageSize = typeof options.pageSize === 'number' ? options.pageSize : 20
  const result = memoryRepo.listSqliteMemoriesPageByAgent({
    agentId,
    query,
    layer: options.layer,
    page,
    pageSize,
  })

  return Response.json({
    agentId,
    scheme: 'sqlite',
    query: query?.trim() ?? '',
    layer: options.layer ?? null,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    summarizeModel: memoryConfig.summarizeModel,
    embeddingModel: memoryConfig.embeddingModel,
    retrievePrompt: readOptionalText((agent.modules?.memory as Record<string, unknown> | undefined)?.retrievePrompt),
    summarizePrompt: readOptionalText((agent.modules?.memory as Record<string, unknown> | undefined)?.summarizePrompt),
    fragmentPrompt: readOptionalText((agent.modules?.memory as Record<string, unknown> | undefined)?.fragmentPrompt),
    consolidatePrompt: readOptionalText((agent.modules?.memory as Record<string, unknown> | undefined)?.consolidatePrompt),
    retrievePromptDefault: buildRetrievePrompt(),
    retrievePromptEffective: buildRetrievePrompt(memoryConfig.retrievePrompt),
    summarizePromptDefault: buildSummaryPrompt(),
    summarizePromptEffective: buildSummaryPrompt(memoryConfig.summarizePrompt),
    fragmentPromptDefault: buildMemoryFragmentPrompt(),
    fragmentPromptEffective: buildMemoryFragmentPrompt(memoryConfig.fragmentPrompt),
    consolidatePromptDefault: buildMemoryConsolidationPrompt(),
    consolidatePromptEffective: buildMemoryConsolidationPrompt(memoryConfig.consolidatePrompt),
    memories: result.memories.map((memory) => ({
      id: memory.id,
      sessionId: memory.sessionId,
      layer: memory.layer,
      summary: memory.displaySummary,
      retrievalText: memory.retrievalText,
      tags: memory.tags,
      importance: memory.importance,
      createdAt: memory.createdAt.toISOString(),
    })),
  })
}

export function updateSqliteMemorySettings(agentId: string, input: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return Response.json({ error: 'Request body must be an object' }, { status: 400 })
  }

  const body = input as Record<string, unknown>
  const stringOrNullFields = [
    'summarizeModel',
    'embeddingModel',
    'retrievePrompt',
    'summarizePrompt',
    'fragmentPrompt',
    'consolidatePrompt',
  ] as const

  for (const field of stringOrNullFields) {
    const value = body[field]
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return Response.json(
        { error: `${field} must be a string or null` },
        { status: 400 },
      )
    }
  }

  const nextModules = isRecord(agent.modules) ? { ...agent.modules } : {}
  const nextMemory: Record<string, unknown> = isRecord(nextModules.memory)
    ? { ...nextModules.memory }
    : { scheme: 'sqlite' }
  const nextValues = {
    summarizeModel: readOptionalText(body.summarizeModel),
    embeddingModel: readOptionalText(body.embeddingModel),
    retrievePrompt: readOptionalText(body.retrievePrompt),
    summarizePrompt: readOptionalText(body.summarizePrompt),
    fragmentPrompt: readOptionalText(body.fragmentPrompt),
    consolidatePrompt: readOptionalText(body.consolidatePrompt),
  }

  nextMemory.scheme = 'sqlite'
  for (const [key, value] of Object.entries(nextValues)) {
    if (value) {
      nextMemory[key] = value
    } else {
      delete nextMemory[key]
    }
  }
  nextModules.memory = nextMemory

  agentRepo.updateAgent(agentId, { modules: nextModules })

  return Response.json({
    agentId,
    scheme: 'sqlite',
    summarizeModel: nextValues.summarizeModel,
    embeddingModel: nextValues.embeddingModel,
    retrievePrompt: nextValues.retrievePrompt,
    summarizePrompt: nextValues.summarizePrompt,
    fragmentPrompt: nextValues.fragmentPrompt,
    consolidatePrompt: nextValues.consolidatePrompt,
    retrievePromptDefault: buildRetrievePrompt(),
    retrievePromptEffective: buildRetrievePrompt(nextValues.retrievePrompt),
    summarizePromptDefault: buildSummaryPrompt(),
    summarizePromptEffective: buildSummaryPrompt(nextValues.summarizePrompt),
    fragmentPromptDefault: buildMemoryFragmentPrompt(),
    fragmentPromptEffective: buildMemoryFragmentPrompt(nextValues.fragmentPrompt),
    consolidatePromptDefault: buildMemoryConsolidationPrompt(),
    consolidatePromptEffective: buildMemoryConsolidationPrompt(nextValues.consolidatePrompt),
  })
}
