import { initDb } from '@/lib/db-init'
import {
  createNamedRelationshipCounterpart,
  getNamedMultiDimRelationshipConfig,
} from '../handler'

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const body = await request.json()
  return createNamedRelationshipCounterpart(id, body)
}
