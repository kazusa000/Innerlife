import { executeChatTurn } from '@mas/turing'
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

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false

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

      try {
        const result = await executeChatTurn({
          sessionId,
          userMessage,
          signal: request.signal,
          onEvent: (event) => {
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
          },
        })
        if (result.status === 'error') {
          console.error('[agent error] turn ended with error status')
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
