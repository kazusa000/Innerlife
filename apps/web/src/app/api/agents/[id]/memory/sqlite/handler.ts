import { agentRepo, memoryRepo } from '@mas/db'
import { isSqliteMemoryConfig } from '@mas/systems'

export function listSqliteMemories(agentId: string, query?: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  const memories = memoryRepo.listSqliteMemoriesByAgent(agentId, query)

  return Response.json({
    agentId,
    scheme: 'sqlite',
    query: query?.trim() ?? '',
    memories,
  })
}
