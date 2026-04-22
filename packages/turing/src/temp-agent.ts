import {
  agentRepo,
  sessionRepo,
  messageRepo,
  llmCallsRepo,
  memoryRepo,
  emotionStateRepo,
  relationshipRepo,
  turingEventRepo,
  turingRunRepo,
} from '@mas/db'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function forceModulesOn(modules: Record<string, unknown> | null) {
  const next: Record<string, unknown> = isRecord(modules) ? { ...modules } : {}
  const personality = isRecord(next.personality) ? { ...next.personality } : {}
  const emotion = isRecord(next.emotion) ? { ...next.emotion } : {}
  const relationship = isRecord(next.relationship) ? { ...next.relationship } : {}
  const memory = isRecord(next.memory) ? { ...next.memory } : {}

  next.personality = { ...personality, scheme: 'big-five' }
  next.emotion = { ...emotion, scheme: 'dimensional' }
  next.relationship = { ...relationship, scheme: 'multi-dim' }
  next.memory = { ...memory, scheme: 'sqlite' }

  return next
}

export function createTemporaryTestAgent(input: {
  sourceAgentId: string
  runId: string
}) {
  const source = agentRepo.getAgent(input.sourceAgentId)
  if (!source) {
    throw new Error(`Source agent ${input.sourceAgentId} was not found`)
  }

  const tempAgent = agentRepo.createAgent({
    name: `${source.name} · Turing Test`,
    description: source.description
      ? `${source.description}\n\n[Test clone for run ${input.runId}]`
      : `[Test clone for run ${input.runId}]`,
    provider: source.provider === 'openrouter' ? 'openrouter' : 'anthropic',
    model: source.model,
    systemPrompt: source.systemPrompt,
    personaPrompt: source.personaPrompt,
    modules: forceModulesOn(source.modules),
  })

  const session = sessionRepo.createSession(tempAgent.id, `Turing test run ${input.runId}`)

  return {
    sourceAgent: source,
    tempAgent,
    session,
  }
}

export function cleanupTemporaryTestAgent(input: {
  runId: string
  tempAgentId: string
}) {
  turingRunRepo.detachTempResources(input.runId)

  const sessions = sessionRepo.listSessionsByAgent(input.tempAgentId)
  for (const session of sessions) {
    llmCallsRepo.deleteCallsBySession(session.id)
    messageRepo.deleteSessionMessages(session.id)
    sessionRepo.deleteSession(session.id)
  }

  memoryRepo.deleteMemoriesByAgent(input.tempAgentId)
  emotionStateRepo.deleteEmotionStatesByAgent(input.tempAgentId)
  relationshipRepo.deleteRelationshipsByAgent(input.tempAgentId)
  turingEventRepo.deleteEvents(input.runId)
  agentRepo.deleteAgent(input.tempAgentId)
}
