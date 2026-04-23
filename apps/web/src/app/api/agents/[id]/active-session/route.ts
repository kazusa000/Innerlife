import { initDb } from '@/lib/db-init'
import { resolveActiveSession } from './handler'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  let reset = false
  let flushContext = false
  try {
    const body = await request.json() as { reset?: unknown; flushContext?: unknown }
    reset = body.reset === true
    flushContext = body.flushContext === true
  } catch {
    reset = false
    flushContext = false
  }
  return resolveActiveSession(id, { reset, flushContext })
}
