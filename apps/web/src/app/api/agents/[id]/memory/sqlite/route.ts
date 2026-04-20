import { initDb } from '@/lib/db-init'
import { listSqliteMemories, updateSqliteMemorySettings } from './handler'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const url = new URL(request.url)

  return listSqliteMemories(id, url.searchParams.get('q') ?? undefined)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const body = await request.json()
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('summarizeModel' in body)) {
    return Response.json({ error: 'summarizeModel is required' }, { status: 400 })
  }

  return updateSqliteMemorySettings(
    id,
    (body as { summarizeModel: unknown }).summarizeModel,
  )
}
