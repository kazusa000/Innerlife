import { initDb } from '@/lib/db-init'
import { sleepAgentMemory } from './handler'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  return sleepAgentMemory(id)
}
