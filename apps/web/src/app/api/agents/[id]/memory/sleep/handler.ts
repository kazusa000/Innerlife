import { runSleepForAgent } from '@mas/daemon'
import { agentRepo } from '@mas/db'
import { isSqliteMemoryConfig } from '@mas/systems'

export async function sleepAgentMemory(
  agentId: string,
  deps: {
    runSleepForAgent?: typeof runSleepForAgent
  } = {},
) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  const runSleep = deps.runSleepForAgent ?? runSleepForAgent
  const result = await runSleep({
    agentId,
    mode: 'manual',
  })

  return Response.json({
    agentId,
    result,
  })
}
