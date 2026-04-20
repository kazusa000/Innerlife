import { agentRepo, sessionRepo } from '@mas/db'

export function resolveActiveSession(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const session = sessionRepo.getLatestActiveSessionByAgent(agentId) ?? sessionRepo.createSession(agentId)
  return Response.json({ session })
}
