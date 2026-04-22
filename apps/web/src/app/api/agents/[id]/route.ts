import { initDb } from '@/lib/db-init'
import { deleteAgentCascade } from './handler'
import { getAgentDetail, updateAgentDetail } from './agent-handler'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  return getAgentDetail(id)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  const body = await request.json()
  return updateAgentDetail(id, body)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  return deleteAgentCascade(id)
}
