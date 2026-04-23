import { initDb } from '@/lib/db-init'
import {
  bindSessionRelationshipCounterpartHandler,
  getSessionRelationshipCounterpartHandler,
  unbindSessionRelationshipCounterpartHandler,
} from './handler'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  return getSessionRelationshipCounterpartHandler(id)
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const body = await request.json()
  return bindSessionRelationshipCounterpartHandler(id, body)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  return unbindSessionRelationshipCounterpartHandler(id)
}
