import { agentRepo } from '@mas/db'

type AgentPatchBody = {
  name?: unknown
  description?: unknown
  provider?: unknown
  model?: unknown
  systemPrompt?: unknown
  personaPrompt?: unknown
  modules?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function getAgentDetail(id: string) {
  const agent = agentRepo.getAgent(id)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  return Response.json(agent)
}

export function updateAgentDetail(id: string, body: AgentPatchBody) {
  const existing = agentRepo.getAgent(id)
  if (!existing) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const updates: {
    name?: string
    description?: string
    provider?: 'anthropic' | 'openrouter'
    model?: string
    systemPrompt?: string
    personaPrompt?: string
    modules?: Record<string, unknown> | null
  } = {}

  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return Response.json({ error: 'name must be a string' }, { status: 400 })
    }
    updates.name = body.name
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      return Response.json({ error: 'description must be a string' }, { status: 400 })
    }
    updates.description = body.description
  }

  if (body.provider !== undefined) {
    if (body.provider !== 'anthropic' && body.provider !== 'openrouter') {
      return Response.json({ error: 'provider must be anthropic or openrouter' }, { status: 400 })
    }
    updates.provider = body.provider
  }

  if (body.model !== undefined) {
    if (typeof body.model !== 'string') {
      return Response.json({ error: 'model must be a string' }, { status: 400 })
    }
    updates.model = body.model
  }

  if (body.systemPrompt !== undefined) {
    if (typeof body.systemPrompt !== 'string') {
      return Response.json({ error: 'systemPrompt must be a string' }, { status: 400 })
    }
    updates.systemPrompt = body.systemPrompt
  }

  if (body.personaPrompt !== undefined) {
    if (typeof body.personaPrompt !== 'string') {
      return Response.json({ error: 'personaPrompt must be a string' }, { status: 400 })
    }
    updates.personaPrompt = body.personaPrompt
  }

  if (body.modules !== undefined) {
    if (body.modules !== null && !isRecord(body.modules)) {
      return Response.json({ error: 'modules must be an object or null' }, { status: 400 })
    }
    updates.modules = body.modules as Record<string, unknown> | null
  }

  const agent = agentRepo.updateAgent(id, updates)
  return Response.json(agent)
}
