import { initDb } from '@/lib/db-init'
import { getDaemonContextFlushList, runDaemonContextFlush } from '../handler'

export async function GET() {
  initDb()
  return getDaemonContextFlushList()
}

export async function POST(request: Request) {
  initDb()
  const body = await request.json().catch(() => ({}))
  return runDaemonContextFlush(body)
}
