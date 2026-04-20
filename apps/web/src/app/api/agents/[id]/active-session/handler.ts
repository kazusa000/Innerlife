import { agentRepo, sessionRepo } from '@mas/db'

export function resolveActiveSession(agentId: string, options: { reset?: boolean } = {}) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const session = options.reset
    ? (() => {
        sessionRepo.archiveActiveSessionsByAgent(agentId)
        return sessionRepo.createSession(agentId)
      })()
    : (sessionRepo.getLatestActiveSessionByAgent(agentId) ?? sessionRepo.createSession(agentId))
  return Response.json({ session })
}
