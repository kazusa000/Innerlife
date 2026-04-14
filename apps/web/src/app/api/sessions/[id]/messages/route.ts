import { messageRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  const messages = messageRepo.getSessionMessages(id)
  return Response.json({ messages })
}
