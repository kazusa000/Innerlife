import { initDb } from '@/lib/db-init'
import {
  getMultiDimRelationshipConfig,
  updateMultiDimRelationshipConfig,
} from './handler'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params

  return getMultiDimRelationshipConfig(id)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const body = await request.json()

  return updateMultiDimRelationshipConfig(id, body)
}
