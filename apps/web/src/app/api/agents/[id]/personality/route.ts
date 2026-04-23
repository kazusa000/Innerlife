import { initDb } from '@/lib/db-init'
import { getPersonalityConfig, updatePersonalityConfig } from './handler'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params

  return getPersonalityConfig(id)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const body = await request.json()

  return updatePersonalityConfig(id, body)
}
