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
  try {
    return Response.json({
      ...call,
      kind: call.kind ?? 'turn',
      tools: JSON.parse(call.toolsJson),
      messages: JSON.parse(call.messagesJson),
      metadata: call.metadataJson ? JSON.parse(call.metadataJson) : null,
      response: call.responseJson ? JSON.parse(call.responseJson) : null,
    })
  } catch (e) {
    return Response.json(
      { error: 'Failed to parse call data' },
      { status: 500 }
    )
  }
}
