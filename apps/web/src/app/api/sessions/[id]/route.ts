import { sessionRepo, messageRepo, llmCallsRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  llmCallsRepo.deleteCallsBySession(id)
  messageRepo.deleteSessionMessages(id)
  sessionRepo.deleteSession(id)
  return Response.json({ ok: true })
}
