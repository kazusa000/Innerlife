import { turingEventRepo, turingRunRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'
import { serializeTuringEvent } from '../../../shared'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const run = turingRunRepo.getRun(id)
  if (!run) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const events = turingEventRepo.listEvents(id).map(serializeTuringEvent)
  return Response.json({ events })
}
