import { sessionRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function GET() {
  initDb()
  const sessions = sessionRepo.listAllSessions()
  return Response.json({ sessions })
}
