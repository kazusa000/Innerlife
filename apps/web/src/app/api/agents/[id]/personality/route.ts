import { initDb } from '@/lib/db-init'
import { getPersonalityManagerMeta } from './handler'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params

  return getPersonalityManagerMeta(id)
}
