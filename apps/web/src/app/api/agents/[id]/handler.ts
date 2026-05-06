import {
  agentMemorySleepStateRepo,
  agentRepo,
  emotionStateRepo,
  llmCallsRepo,
  memoryRepo,
  messageRepo,
  relationshipCounterpartRepo,
  relationshipRepo,
  sessionRelationshipBindingRepo,
  sessionContextStateRepo,
  sessionRepo,
} from '@mas/db'

export function deleteAgentCascade(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  emotionStateRepo.deleteEmotionStatesByAgent(agentId)
  relationshipRepo.deleteRelationshipsByAgent(agentId)
  agentMemorySleepStateRepo.deleteAgentMemorySleepState(agentId)
  memoryRepo.deleteMemoriesByAgent(agentId)

  const sessions = sessionRepo.listSessionsByAgent(agentId)
  for (const session of sessions) {
    sessionRelationshipBindingRepo.unbindSessionRelationshipCounterpart(session.id)
    sessionContextStateRepo.deleteSessionContextState(session.id)
    llmCallsRepo.deleteCallsBySession(session.id)
    messageRepo.deleteSessionMessages(session.id)
    sessionRepo.deleteSession(session.id)
  }

  relationshipCounterpartRepo.deleteRelationshipCounterpartsByAgent(agentId)

  agentRepo.deleteAgent(agentId)
  return Response.json({ ok: true })
}
