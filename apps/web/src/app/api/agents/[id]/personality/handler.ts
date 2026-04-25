import { agentRepo } from '@mas/db'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readPrompt(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readPersonalityPrompts(modules: Record<string, unknown> | null | undefined) {
  const personality = isRecord(modules?.personality)
    ? modules?.personality as Record<string, unknown>
    : null

  return {
    systemPrompt: readPrompt(personality?.systemPrompt),
    personaPrompt: readPrompt(personality?.personaPrompt),
    avatarUrl: readPrompt(personality?.avatarUrl),
    thinkingRoleImmersionPrompt: readPrompt(personality?.thinkingRoleImmersionPrompt),
  }
}

export function getPersonalityConfig(agentId: string) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const prompts = readPersonalityPrompts(agent.modules)

  return Response.json({
    agentId,
    systemPrompt: prompts.systemPrompt,
    personaPrompt: prompts.personaPrompt,
    avatarUrl: prompts.avatarUrl,
    thinkingRoleImmersionPrompt: prompts.thinkingRoleImmersionPrompt,
  })
}

export function updatePersonalityConfig(agentId: string, body: unknown) {
  const agent = agentRepo.getAgent(agentId)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!isRecord(body)) {
    return Response.json({ error: 'body must be an object' }, { status: 400 })
  }

  const { systemPrompt, personaPrompt, avatarUrl, thinkingRoleImmersionPrompt } = body
  if (systemPrompt !== undefined && typeof systemPrompt !== 'string') {
    return Response.json({ error: 'systemPrompt must be a string' }, { status: 400 })
  }
  if (personaPrompt !== undefined && typeof personaPrompt !== 'string') {
    return Response.json({ error: 'personaPrompt must be a string' }, { status: 400 })
  }
  if (avatarUrl !== undefined && typeof avatarUrl !== 'string') {
    return Response.json({ error: 'avatarUrl must be a string' }, { status: 400 })
  }
  if (thinkingRoleImmersionPrompt !== undefined && typeof thinkingRoleImmersionPrompt !== 'string') {
    return Response.json({ error: 'thinkingRoleImmersionPrompt must be a string' }, { status: 400 })
  }

  const updated = agentRepo.updateAgent(agentId, {
    modules: agent.modules,
    systemPrompt,
    personaPrompt,
    avatarUrl,
    thinkingRoleImmersionPrompt,
  })
  if (!updated) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const prompts = readPersonalityPrompts(updated.modules)
  return Response.json({
    agentId,
    systemPrompt: prompts.systemPrompt,
    personaPrompt: prompts.personaPrompt,
    avatarUrl: prompts.avatarUrl,
    thinkingRoleImmersionPrompt: prompts.thinkingRoleImmersionPrompt,
  })
}
