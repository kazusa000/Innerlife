import { messageRepo } from '@mas/db'
import { createDbObserver } from '@mas/observer'
import { initDb } from '@/lib/db-init'
import { consolidateSqliteMemories } from './handler'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb()
  const { id } = await params
  return consolidateSqliteMemories(id, {
    resolveObserver(input) {
      if (process.env.OBSERVER_ENABLED !== '1') {
        return undefined
      }

      const anchorMemory = input.memories.at(-1) ?? input.memories[0]
      if (!anchorMemory) {
        return undefined
      }

      const sessionMessages = messageRepo.getSessionMessages(anchorMemory.sessionId)
      const lastUserMessage = [...sessionMessages]
        .reverse()
        .find((message) => message.role === 'user')
      const userMessageId = lastUserMessage?.id ?? messageRepo.addMessage({
        sessionId: anchorMemory.sessionId,
        role: 'user',
        content: JSON.stringify([{ type: 'text', text: '[memory consolidate]' }]),
      })

      return createDbObserver({
        sessionId: anchorMemory.sessionId,
        userMessageId,
        model: input.model,
      })
    },
  })
}
