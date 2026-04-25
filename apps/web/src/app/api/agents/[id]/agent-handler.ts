import { agentRepo } from '@mas/db'

type AgentPatchBody = {
  name?: unknown
  description?: unknown
  provider?: unknown
  model?: unknown
  systemPrompt?: unknown
  personaPrompt?: unknown
  avatarUrl?: unknown
  modules?: unknown
  tools?: unknown
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
    avatarUrl?: string
    modules?: Record<string, unknown> | null
    tools?: Record<string, { enabled?: boolean; description?: string }> | null
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

  if (body.avatarUrl !== undefined) {
    if (typeof body.avatarUrl !== 'string') {
      return Response.json({ error: 'avatarUrl must be a string' }, { status: 400 })
    }
    updates.avatarUrl = body.avatarUrl
  }

  if (body.modules !== undefined) {
    if (body.modules !== null && !isRecord(body.modules)) {
      return Response.json({ error: 'modules must be an object or null' }, { status: 400 })
    }
    updates.modules = body.modules as Record<string, unknown> | null
  }

  if (body.tools !== undefined) {
    if (body.tools !== null && !isRecord(body.tools)) {
      return Response.json({ error: 'tools must be an object or null' }, { status: 400 })
    }

    if (body.tools === null) {
      updates.tools = null
    } else {
      const nextTools: Record<string, { enabled?: boolean; description?: string }> = {}

      for (const [toolName, rawEntry] of Object.entries(body.tools)) {
        if (!isRecord(rawEntry)) {
          return Response.json({ error: `tools.${toolName} must be an object` }, { status: 400 })
        }

        const nextEntry: { enabled?: boolean; description?: string } = {}
        if (rawEntry.enabled !== undefined) {
          if (typeof rawEntry.enabled !== 'boolean') {
            return Response.json({ error: `tools.${toolName}.enabled must be a boolean` }, { status: 400 })
          }
          nextEntry.enabled = rawEntry.enabled
        }

        if (rawEntry.description !== undefined) {
          if (typeof rawEntry.description !== 'string') {
            return Response.json({ error: `tools.${toolName}.description must be a string` }, { status: 400 })
          }

          const trimmed = rawEntry.description.trim()
          if (trimmed) {
            nextEntry.description = trimmed
          }
        }

        if (nextEntry.enabled !== undefined || nextEntry.description !== undefined) {
          nextTools[toolName] = nextEntry
        }
      }

      updates.tools = Object.keys(nextTools).length > 0 ? nextTools : null
    }
  }

  const agent = agentRepo.updateAgent(id, updates)
  return Response.json(agent)
}
