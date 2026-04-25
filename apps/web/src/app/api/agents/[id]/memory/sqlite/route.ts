import { initDb } from '@/lib/db-init'
import { clearSqliteMemories, listSqliteMemories, updateSqliteMemorySettings } from './handler'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const url = new URL(request.url)
  const page = Number(url.searchParams.get('page') ?? '1')
  const pageSize = Number(url.searchParams.get('pageSize') ?? '20')
  const layer = url.searchParams.get('layer')

  return listSqliteMemories(id, url.searchParams.get('q') ?? undefined, {
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    layer: layer === 'short_term' || layer === 'long_term' || layer === 'fixed' ? layer : undefined,
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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  return clearSqliteMemories(id)
}
