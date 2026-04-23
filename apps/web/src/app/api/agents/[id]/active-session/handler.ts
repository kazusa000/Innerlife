import { runContextFlushForSession } from '@mas/daemon'
import { agentRepo, sessionRepo } from '@mas/db'
import { isSqliteMemoryConfig } from '@mas/systems'

const SOFT_CONTEXT_FLUSH_REASONS = new Set([
  'no_messages',
  'no_active_context',
  'nothing_to_flush',
])

type ContextFlushResult = Awaited<ReturnType<typeof runContextFlushForSession>>

function isSoftContextFlushResult(result: ContextFlushResult) {
  return !result.ok && SOFT_CONTEXT_FLUSH_REASONS.has(result.reason)
}

export async function resolveActiveSession(
  agentId: string,
  options: {
    reset?: boolean
    flushContext?: boolean
    runContextFlushForSession?: typeof runContextFlushForSession
  } = {},
) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  let contextFlush: ContextFlushResult | undefined

  if (options.reset && options.flushContext) {
    if (!isSqliteMemoryConfig(agent.modules?.memory)) {
      return Response.json({ error: 'Agent memory scheme must be sqlite' }, { status: 400 })
    }

    const currentSession = sessionRepo.getLatestActiveSessionByAgent(agentId)
    if (currentSession) {
      const runFlush = options.runContextFlushForSession ?? runContextFlushForSession

      try {
        contextFlush = await runFlush({
          sessionId: currentSession.id,
          mode: 'manual',
        })
      } catch {
        return Response.json({ error: 'Failed to flush active context' }, { status: 500 })
      }

      if (!contextFlush.ok && !isSoftContextFlushResult(contextFlush)) {
        return Response.json({ error: 'Failed to flush active context' }, { status: 500 })
      }
    }
  }

  const session = options.reset
    ? (() => {
        sessionRepo.archiveActiveSessionsByAgent(agentId)
        return sessionRepo.createSession(agentId)
      })()
    : (sessionRepo.getLatestActiveSessionByAgent(agentId) ?? sessionRepo.createSession(agentId))
  return Response.json({
    session,
    ...(contextFlush ? { contextFlush } : {}),
  })
}
