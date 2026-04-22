import { initDb } from '@/lib/db-init'
import { getDaemonSleepList, runDaemonSleep } from '../handler'

export async function GET() {
  initDb()
  return getDaemonSleepList()
}

export async function POST(request: Request) {
  initDb()
  const body = await request.json().catch(() => ({}))
  return runDaemonSleep(body)
}
