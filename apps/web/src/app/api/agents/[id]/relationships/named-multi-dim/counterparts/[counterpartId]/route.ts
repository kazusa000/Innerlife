import { initDb } from '@/lib/db-init'
import {
  deleteNamedRelationshipCounterpart,
  renameNamedRelationshipCounterpart,
} from '../../handler'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; counterpartId: string }> },
) {
  initDb()
  const { id, counterpartId } = await params
  const body = await request.json()
  return renameNamedRelationshipCounterpart(id, counterpartId, body)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; counterpartId: string }> },
) {
  initDb()
  const { id, counterpartId } = await params
  return deleteNamedRelationshipCounterpart(id, counterpartId)
}
