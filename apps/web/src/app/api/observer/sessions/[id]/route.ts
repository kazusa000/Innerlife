import { llmCallsRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  const turns = llmCallsRepo.getSessionTurnTree(id)
  return Response.json({ turns })
}
