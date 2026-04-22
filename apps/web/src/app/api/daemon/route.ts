import { initDb } from '@/lib/db-init'
import { getDaemonOverview } from './handler'

export async function GET() {
  initDb()
  return getDaemonOverview()
}
