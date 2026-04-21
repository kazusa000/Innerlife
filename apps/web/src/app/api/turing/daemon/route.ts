import { initDb } from '@/lib/db-init'
import { serializeDaemonState } from '../shared'

export async function GET() {
  initDb()
  return Response.json({ daemon: serializeDaemonState() })
}
