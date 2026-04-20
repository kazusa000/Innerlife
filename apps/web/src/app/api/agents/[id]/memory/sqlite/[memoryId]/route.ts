import { initDb } from '@/lib/db-init'
import { deleteSqliteMemory } from './handler'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; memoryId: string }> },
) {
  initDb()
  const { id, memoryId } = await params

  return deleteSqliteMemory(id, memoryId)
}
