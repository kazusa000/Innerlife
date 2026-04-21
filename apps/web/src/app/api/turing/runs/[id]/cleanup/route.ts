import { turingRunRepo } from '@mas/db'
import { cleanupRunData } from '@mas/turing/runner'
import { initDb } from '@/lib/db-init'
import { serializeTuringRun } from '../../../shared'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const run = turingRunRepo.getRun(id)
  if (!run) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const cleaned = cleanupRunData(id)
  return Response.json({ run: serializeTuringRun(cleaned) })
}
