import { getDefaultTools, resolveAgentTools } from '@mas/core'
import { agentRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function buildToolsPayload(agent: NonNullable<ReturnType<typeof agentRepo.getAgent>>) {
  const resolved = resolveAgentTools({
    tools: getDefaultTools(),
    modules: agent.modules,
    config: agent.tools ?? null,
  })

  return {
    agentId: agent.id,
    tools: resolved.catalog,
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const agent = agentRepo.getAgent(id)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  return Response.json(buildToolsPayload(agent))
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const agent = agentRepo.getAgent(id)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  if (!isRecord(body)) {
    return Response.json({ error: 'body must be an object' }, { status: 400 })
  }

  if (!('tools' in body)) {
    return Response.json({ error: 'tools is required' }, { status: 400 })
  }

  if (body.tools !== undefined && body.tools !== null && !isRecord(body.tools)) {
    return Response.json({ error: 'tools must be an object or null' }, { status: 400 })
  }

  const nextTools: Record<string, { enabled?: boolean; description?: string }> = {}

  if (isRecord(body.tools)) {
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
  }

  const updated = agentRepo.updateAgent(id, {
    tools: body.tools === null || Object.keys(nextTools).length === 0 ? null : nextTools,
  })

  if (!updated) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  return Response.json(buildToolsPayload(updated))
}
