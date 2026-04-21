import { initDb } from '@/lib/db-init'
import { listSqliteMemories, updateSqliteMemorySettings } from './handler'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const url = new URL(request.url)
  const page = Number(url.searchParams.get('page') ?? '1')
  const pageSize = Number(url.searchParams.get('pageSize') ?? '20')

  return listSqliteMemories(id, url.searchParams.get('q') ?? undefined, {
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 20,
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const body = await request.json()
  return updateSqliteMemorySettings(id, body)
}
