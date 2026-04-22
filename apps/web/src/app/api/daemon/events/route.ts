import { initDb } from '@/lib/db-init'
import { getDaemonEventsFeed } from '../handler'

export async function GET() {
  initDb()
  return getDaemonEventsFeed()
}
