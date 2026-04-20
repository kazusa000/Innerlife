import { agentRepo, memoryRepo } from '@mas/db'
import { isSqliteMemoryConfig } from '@mas/systems'

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
