import { sessionRepo } from '@mas/db'
import { initDb, getDefaultAgent } from '@/lib/db-init'

export async function GET() {
  initDb()
  const sessions = sessionRepo.listAllSessions()
  return Response.json({ sessions })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const agent = getDefaultAgent()
  const session = sessionRepo.createSession(agent.id, body.title ?? 'New Chat')
  return Response.json({ session })
}
