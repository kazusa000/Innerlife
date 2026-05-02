import { getPromptTestSamples, runPromptTest, updatePromptTestSamples } from './handler'
import { initDb } from '@/lib/db-init'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  return getPromptTestSamples(id)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const body = await request.json().catch(() => null)
  return updatePromptTestSamples(id, body)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const body = await request.json().catch(() => null)
  return runPromptTest(id, body)
}
