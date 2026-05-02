import { runPromptTest } from '../handler'
import { initDb } from '@/lib/db-init'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  const body = await request.json().catch(() => null)
  return runPromptTest(id, body)
}
