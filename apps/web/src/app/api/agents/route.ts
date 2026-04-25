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
  const provider = body.provider as string | undefined
  const model = (body.model as string) || 'claude-sonnet-4-6'
  const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt : ''
  const personaPrompt = typeof body.personaPrompt === 'string' ? body.personaPrompt : ''
  const avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl : ''
  const modules = (body.modules as Record<string, unknown> | null | undefined) ?? null

  if (!name?.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  if (provider !== undefined && provider !== 'anthropic' && provider !== 'openrouter') {
    return Response.json({ error: 'provider must be anthropic or openrouter' }, { status: 400 })
  }

  const agent = agentRepo.createAgent({
    name: name.trim(),
    description,
    provider,
    model,
    systemPrompt,
    personaPrompt,
    avatarUrl,
    modules,
  })
  return Response.json({ agent }, { status: 201 })
}
