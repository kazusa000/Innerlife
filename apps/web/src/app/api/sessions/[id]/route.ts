import {
  emotionStateRepo,
  llmCallsRepo,
  messageRepo,
  sessionRelationshipBindingRepo,
  sessionContextStateRepo,
  sessionRepo,
} from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  sessionRelationshipBindingRepo.unbindSessionRelationshipCounterpart(id)
  sessionContextStateRepo.deleteSessionContextState(id)
  emotionStateRepo.deleteEmotionStatesBySession(id)
  llmCallsRepo.deleteCallsBySession(id)
  messageRepo.deleteSessionMessages(id)
  sessionRepo.deleteSession(id)
  return Response.json({ ok: true })
}
