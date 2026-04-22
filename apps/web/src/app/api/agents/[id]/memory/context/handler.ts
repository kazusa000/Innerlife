import { runContextFlushForSession } from '@mas/daemon'
import { agentRepo, sessionRepo } from '@mas/db'
import { isSqliteMemoryConfig } from '@mas/systems'

export async function flushAgentContext(
  agentId: string,
  deps: {
    runContextFlushForSession?: typeof runContextFlushForSession
  } = {},
) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isSqliteMemoryConfig(agent.modules?.memory)) {
    return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
  }

  const session = sessionRepo.getLatestActiveSessionByAgent(agentId)
  if (!session) {
    return Response.json({ error: 'No active session to flush' }, { status: 400 })
  }

  const runFlush = deps.runContextFlushForSession ?? runContextFlushForSession
  const result = await runFlush({
    sessionId: session.id,
    mode: 'manual',
  })

  return Response.json({
    agentId,
    sessionId: session.id,
    result,
  })
}
