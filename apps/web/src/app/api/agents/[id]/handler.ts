import {
  agentMemorySleepStateRepo,
  agentRepo,
  emotionStateRepo,
  llmCallsRepo,
  memoryRepo,
  messageRepo,
  relationshipRepo,
  sessionContextStateRepo,
  sessionRepo,
  turingEventRepo,
  turingRunRepo,
} from '@mas/db'

export function deleteAgentCascade(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  for (const run of turingRunRepo.listRunsBySourceAgent(agentId)) {
    turingEventRepo.deleteEvents(run.id)
    turingRunRepo.deleteRun(run.id)
  }

  emotionStateRepo.deleteEmotionStatesByAgent(agentId)
  relationshipRepo.deleteRelationshipsByAgent(agentId)
  agentMemorySleepStateRepo.deleteAgentMemorySleepState(agentId)
  memoryRepo.deleteMemoriesByAgent(agentId)

  const sessions = sessionRepo.listSessionsByAgent(agentId)
  for (const session of sessions) {
    sessionContextStateRepo.deleteSessionContextState(session.id)
    llmCallsRepo.deleteCallsBySession(session.id)
    messageRepo.deleteSessionMessages(session.id)
    sessionRepo.deleteSession(session.id)
  }

  agentRepo.deleteAgent(agentId)
  return Response.json({ ok: true })
}
