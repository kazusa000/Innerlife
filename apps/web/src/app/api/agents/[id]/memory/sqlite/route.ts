import { initDb } from '@/lib/db-init'
import { listSqliteMemories } from './handler'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const url = new URL(request.url)

  return listSqliteMemories(id, url.searchParams.get('q') ?? undefined)
}
