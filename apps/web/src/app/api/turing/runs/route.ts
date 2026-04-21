import { agentRepo, turingRunRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'
import { serializeTuringRun } from '../shared'

export async function GET(request: Request) {
  initDb()
  const url = new URL(request.url)
  const sourceAgentId = url.searchParams.get('sourceAgentId')?.trim()

  if (!sourceAgentId) {
    return Response.json({ error: 'sourceAgentId is required' }, { status: 400 })
  }

  const sourceAgent = agentRepo.getAgent(sourceAgentId)
  if (!sourceAgent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const runs = turingRunRepo.listRunsBySourceAgent(sourceAgentId).map(serializeTuringRun)
  return Response.json({ runs })
}

export async function POST(request: Request) {
  initDb()
  const body = await request.json() as {
    sourceAgentId?: unknown
    judgeProvider?: unknown
    judgeModel?: unknown
  }

  const sourceAgentId = typeof body.sourceAgentId === 'string' ? body.sourceAgentId.trim() : ''
  if (!sourceAgentId) {
    return Response.json({ error: 'sourceAgentId is required' }, { status: 400 })
  }

  const sourceAgent = agentRepo.getAgent(sourceAgentId)
  if (!sourceAgent) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const judgeProvider =
    body.judgeProvider === 'anthropic' || body.judgeProvider === 'openrouter'
      ? body.judgeProvider
      : sourceAgent.provider
  const judgeModel =
    typeof body.judgeModel === 'string' && body.judgeModel.trim()
      ? body.judgeModel.trim()
      : sourceAgent.model

  const run = turingRunRepo.createRun({
    sourceAgentId,
    judgeProvider,
    judgeModel,
  })

  return Response.json({ run: serializeTuringRun(run) }, { status: 201 })
}
