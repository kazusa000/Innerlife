import { agentRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function GET() {
  initDb()
  const agents = agentRepo.listAgents()
  return Response.json({ agents })
}

export async function POST(request: Request) {
  initDb()
  const body = await request.json()
  const name = body.name as string
  const description = (body.description as string) || ''
  const model = (body.model as string) || 'claude-sonnet-4-6'
  const modules = (body.modules as Record<string, unknown> | null | undefined) ?? null

  if (!name?.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  const agent = agentRepo.createAgent({
    name: name.trim(),
    description,
    model,
    modules,
  })
  return Response.json({ agent }, { status: 201 })
}
