import { agentRepo, memoryRepo } from '@mas/db'
import { isSqliteMemoryConfig } from '@mas/systems'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function deleteSqliteMemory(agentId: string, memoryId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  const deleted = memoryRepo.deleteSqliteMemoryByAgent(agentId, memoryId)
  if (!deleted) {
    return Response.json({ error: 'Memory not found' }, { status: 404 })
  }

  return Response.json({ ok: true })
}

export function updateSqliteMemory(agentId: string, memoryId: string, input: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  if (!isRecord(input)) {
    return Response.json({ error: 'Request body must be an object' }, { status: 400 })
  }

  const layer = input.layer
  if (layer !== 'short_term' && layer !== 'long_term' && layer !== 'fixed') {
    return Response.json({ error: 'layer must be one of short_term, long_term, fixed' }, { status: 400 })
  }

  const updated = memoryRepo.updateSqliteMemoryLayerByAgent(agentId, memoryId, layer)
  if (!updated) {
    return Response.json({ error: 'Memory not found' }, { status: 404 })
  }

  const memory = memoryRepo.getMemory(memoryId)
  return Response.json({
    ok: true,
    memory: memory
      ? {
          id: memory.id,
          sessionId: memory.sessionId,
          layer: memory.layer,
          summary: memory.displaySummary,
          retrievalText: memory.retrievalText,
          tags: memory.tags,
          importance: memory.importance,
          createdAt: memory.createdAt.toISOString(),
        }
      : null,
  })
}
