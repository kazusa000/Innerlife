import { llmCallsRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function DELETE() {
  initDb()
  llmCallsRepo.clearAllCalls()
  return Response.json({ ok: true })
}
