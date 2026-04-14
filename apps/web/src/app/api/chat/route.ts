import { runAgent, AnthropicProvider, BashTool } from '@mas/core'
import type { AgentConfig, Message } from '@mas/core'
import { messageRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function POST(request: Request) {
  initDb()
  const body = await request.json()
  const userMessage = body.message as string
  const sessionId = body.sessionId as string

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  messageRepo.addMessage({
    sessionId,
    role: 'user',
    content: JSON.stringify([{ type: 'text', text: userMessage }]),
  })

  const dbMessages = messageRepo.getSessionMessages(sessionId)
  const messages: Message[] = dbMessages.map((m) => ({
    role: m.role as Message['role'],
    content: JSON.parse(m.content),
  }))

  const provider = new AnthropicProvider()
  const config: AgentConfig = {
    id: 'default',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'You are a helpful AI assistant. You can execute bash commands to help the user. Be concise.',
    tools: [BashTool],
    maxTurns: 10,
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgent(config, messages, provider)) {
          if (event.type === 'error') {
            console.error('[agent error]', event.error)
          }
          const serializable =
            event.type === 'error'
              ? { type: 'error', error: event.error.message || String(event.error) }
              : event
          const data = JSON.stringify(serializable)
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))

          if (event.type === 'complete') {
            messageRepo.addMessage({
              sessionId,
              role: 'assistant',
              content: JSON.stringify(event.response.content),
              tokenCount: event.response.usage.outputTokens,
            })
          }
        }
      } catch (err) {
        const errorEvent = JSON.stringify({
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
        controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`))
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
