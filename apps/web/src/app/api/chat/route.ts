import {
  runAgent,
  AnthropicProvider,
  BashTool,
  FileReadTool,
  FileWriteTool,
  WebFetchTool,
} from '@mas/core'
import type { AgentConfig, Message } from '@mas/core'
import { messageRepo, sessionRepo, agentRepo } from '@mas/db'
import { createDbObserver, createNoopObserver } from '@mas/observer'
import { createSystems } from '@mas/systems'
import { initDb } from '@/lib/db-init'

const INTERRUPTED_SUFFIX = ' —（中断）'

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

  const userMessageId = messageRepo.addMessage({
    sessionId,
    role: 'user',
    content: JSON.stringify([{ type: 'text', text: userMessage }]),
  })

  const dbMessages = messageRepo.getSessionMessages(sessionId)
  const messages: Message[] = dbMessages.map((m) => ({
    role: m.role as Message['role'],
    content: JSON.parse(m.content),
  }))

  // Load agent config from session
  const session = sessionRepo.getSession(sessionId)
  const agent = session ? agentRepo.getAgent(session.agentId) : null

  const provider = new AnthropicProvider()
  const systems = createSystems(agent?.modules ?? null)
  const toolPrompt = 'You can use tools to execute bash commands, read files, write files, and fetch web pages. Be concise.'
  const config: AgentConfig = {
    id: agent?.id ?? 'default',
    model: agent?.model ?? 'claude-sonnet-4-6',
    systemPrompt: agent?.description
      ? `You are ${agent.name}. ${agent.description}. ${toolPrompt}`
      : `You are a helpful AI assistant. ${toolPrompt}`,
    tools: [BashTool, FileReadTool, FileWriteTool, WebFetchTool],
    maxTurns: 10,
    sessionId,
    userId: 'default-user',
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      let assistantText = ''

      const push = (payload: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      const close = () => {
        if (closed) return
        closed = true
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }

      const persistInterruptedMessage = () => {
        const content = assistantText
          ? `${assistantText}${INTERRUPTED_SUFFIX}`
          : '（中断）'

        messageRepo.addMessage({
          sessionId,
          role: 'assistant',
          content: JSON.stringify([{ type: 'text', text: content }]),
        })
      }

      const observer =
        process.env.OBSERVER_ENABLED === '1'
          ? createDbObserver({
              sessionId,
              userMessageId,
              model: config.model,
              onEvent: (event) => push(event),
            })
          : createNoopObserver()

      try {
        for await (const event of runAgent(
          config,
          messages,
          provider,
          systems,
          observer,
          request.signal,
        )) {
          if (event.type === 'error') {
            console.error('[agent error]', event.error)
          }

          if (event.type === 'text_delta') {
            assistantText += event.text
          }

          const serializable =
            event.type === 'error'
              ? { type: 'error', error: event.error.message || String(event.error) }
              : event.type === 'system_error'
                ? {
                    type: 'system_error',
                    system: event.system,
                    phase: event.phase,
                    error: event.error.message || String(event.error),
                  }
              : event
          push(serializable)

          if (event.type === 'complete') {
            messageRepo.addMessage({
              sessionId,
              role: 'assistant',
              content: JSON.stringify(event.response.content),
              tokenCount: event.response.usage.outputTokens,
            })
            assistantText = ''
          }

          if (event.type === 'aborted') {
            persistInterruptedMessage()
          }
        }
      } catch (err) {
        if (!request.signal.aborted) {
          push({
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      } finally {
        close()
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
