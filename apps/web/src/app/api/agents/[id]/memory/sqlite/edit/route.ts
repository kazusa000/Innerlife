import { initDb } from '@/lib/db-init'
import { editSqliteMemoryGraph } from './handler'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const body = await request.json()
  return editSqliteMemoryGraph(id, body)
}
