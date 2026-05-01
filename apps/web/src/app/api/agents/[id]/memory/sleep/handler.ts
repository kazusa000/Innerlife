import { runEpisodicConsolidationForAgent } from '@mas/daemon'
import { agentRepo } from '@mas/db'
import { isSqliteMemoryConfig } from '@mas/systems'

export async function sleepAgentMemory(
  agentId: string,
  deps: {
    runEpisodicConsolidationForAgent?: typeof runEpisodicConsolidationForAgent
  } = {},
) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  const runConsolidation = deps.runEpisodicConsolidationForAgent ?? runEpisodicConsolidationForAgent
  const result = await runConsolidation({
    agentId,
  })

  return Response.json({
    agentId,
    result,
  })
}
