import { initDb } from '@/lib/db-init'
import { deleteSqliteMemory, updateSqliteMemory } from './handler'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; memoryId: string }> },
) {
  initDb()
  const { id, memoryId } = await params

  return deleteSqliteMemory(id, memoryId)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; memoryId: string }> },
) {
  initDb()
  const { id, memoryId } = await params
  const body = await request.json()

  return updateSqliteMemory(id, memoryId, body)
}
