import { agentRepo, memoryRepo } from '@mas/db'
import { isSqliteMemoryConfig, resolveMemorySqliteConfig } from '@mas/systems'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function listSqliteMemories(agentId: string, query?: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  const memories = memoryRepo.listSqliteMemoriesByAgent(agentId, query)
  const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory)

  return Response.json({
    agentId,
    scheme: 'sqlite',
    query: query?.trim() ?? '',
    summarizeModel: memoryConfig.summarizeModel,
    memories: memories.map((memory) => ({
      id: memory.id,
      sessionId: memory.sessionId,
      summary: memory.displaySummary,
      retrievalText: memory.retrievalText,
      tags: memory.tags,
      importance: memory.importance,
      createdAt: memory.createdAt.toISOString(),
    })),
  })
}

export function updateSqliteMemorySettings(agentId: string, summarizeModel: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  if (
    summarizeModel !== undefined
    && summarizeModel !== null
    && typeof summarizeModel !== 'string'
  ) {
    return Response.json(
      { error: 'summarizeModel must be a string or null' },
      { status: 400 },
    )
  }

  const nextModules = isRecord(agent.modules) ? { ...agent.modules } : {}
  const nextMemory: Record<string, unknown> = isRecord(nextModules.memory)
    ? { ...nextModules.memory }
    : { scheme: 'sqlite' }
  const nextSummarizeModel = typeof summarizeModel === 'string'
    ? summarizeModel.trim() || null
    : null

  nextMemory.scheme = 'sqlite'
  if (nextSummarizeModel) {
    nextMemory.summarizeModel = nextSummarizeModel
  } else {
    delete nextMemory.summarizeModel
  }
  nextModules.memory = nextMemory

  agentRepo.updateAgent(agentId, { modules: nextModules })

  return Response.json({
    agentId,
    scheme: 'sqlite',
    summarizeModel: nextSummarizeModel,
  })
}
