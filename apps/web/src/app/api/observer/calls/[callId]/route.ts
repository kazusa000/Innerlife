import { llmCallsRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ callId: string }> }
) {
  initDb()
  const { callId } = await params
  const call = llmCallsRepo.getCall(callId)
  if (!call) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  return Response.json({
    ...call,
    tools: JSON.parse(call.toolsJson),
    messages: JSON.parse(call.messagesJson),
    response: call.responseJson ? JSON.parse(call.responseJson) : null,
  })
}
