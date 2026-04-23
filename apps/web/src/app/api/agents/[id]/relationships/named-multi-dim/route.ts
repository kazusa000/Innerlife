import { initDb } from '@/lib/db-init'
import {
  getNamedMultiDimRelationshipConfig,
  updateNamedMultiDimRelationshipConfig,
} from './handler'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const url = new URL(request.url)
  const counterpartId = url.searchParams.get('counterpartId')
  return getNamedMultiDimRelationshipConfig(id, counterpartId)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const body = await request.json()
  return updateNamedMultiDimRelationshipConfig(id, body)
}
