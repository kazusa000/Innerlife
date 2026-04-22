import { initDb } from '@/lib/db-init'
import { getDaemonTuringRunSummaries } from '../handler'

export async function GET() {
  initDb()
  return getDaemonTuringRunSummaries()
}
