import { agentRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readMemoryScheme(modules: Record<string, unknown> | null | undefined) {
  const memory = modules?.memory
  if (typeof memory === 'string') {
    return memory
  }

  if (isRecord(memory)) {
    return typeof memory.scheme === 'string' ? memory.scheme : null
  }

  return null
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

  const scheme = readMemoryScheme(agent.modules)

  return Response.json({
    agentId: id,
    scheme,
    supportedSchemes: ['sqlite'],
    configured: Boolean(scheme && scheme !== 'noop'),
  })
}
