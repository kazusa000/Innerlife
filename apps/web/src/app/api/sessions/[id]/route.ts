import { sessionRepo, messageRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  messageRepo.deleteSessionMessages(id)
  sessionRepo.deleteSession(id)
  return Response.json({ ok: true })
}
