import { initDb } from '@/lib/db-init'
import { resolveActiveSession } from './handler'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  let reset = false
  try {
    const body = await request.json() as { reset?: unknown }
    reset = body.reset === true
  } catch {
    reset = false
  }
  return resolveActiveSession(id, { reset })
}
