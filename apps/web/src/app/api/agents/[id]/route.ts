import { agentRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'
import { deleteAgentCascade } from './handler'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  const agent = agentRepo.getAgent(id)
  if (!agent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  return Response.json(agent)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  const existing = agentRepo.getAgent(id)
  if (!existing) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await request.json()
  const updates: {
    name?: string
    description?: string
    provider?: 'anthropic' | 'openrouter'
    model?: string
    modules?: Record<string, unknown> | null
  } = {}
  if (body.name !== undefined) updates.name = body.name
  if (body.description !== undefined) updates.description = body.description
  if (body.provider !== undefined) {
    if (body.provider !== 'anthropic' && body.provider !== 'openrouter') {
      return Response.json({ error: 'provider must be anthropic or openrouter' }, { status: 400 })
    }
    updates.provider = body.provider
  }
  if (body.model !== undefined) updates.model = body.model
  if (body.modules !== undefined) updates.modules = body.modules

  const agent = agentRepo.updateAgent(id, updates)
  return Response.json(agent)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  return deleteAgentCascade(id)
}
