'use client'

import { useState, useRef, useEffect } from 'react'
import { ObserverDrawer } from './ObserverDrawer'
import type {
  AgentModules,
  LiveCall,
  ObserverTab,
  ObserverTurnState,
  ObserverTurnSummary,
} from './observer-types'

const INTERRUPTED_SUFFIX = ' —（中断）'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ToolExecution {
  toolName: string
  input: Record<string, unknown>
  output?: string
  isError?: boolean
}

interface DbMessage {
  role: string
  content: string
}

function renderDbMessage(m: DbMessage): ChatMessage | null {
  if (m.role !== 'user' && m.role !== 'assistant') return null
  try {
    const blocks = JSON.parse(m.content) as Array<{ type: string; text?: string }>
    const text = blocks
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('')
    return { role: m.role, content: text }
  } catch {
    return { role: m.role as 'user' | 'assistant', content: m.content }
  }
}

interface Props {
  sessionId: string
  agentModules: AgentModules | null
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  )
}

function normalizeCallDetail(call: Record<string, unknown>): LiveCall | null {
  const id = typeof call.id === 'string' ? call.id : null
  const turnIndex = typeof call.turnIndex === 'number' ? call.turnIndex : null
  const kind = call.kind
  const model = typeof call.model === 'string' ? call.model : null
  const systemPrompt = typeof call.systemPrompt === 'string' ? call.systemPrompt : null
  const tools = Array.isArray(call.tools) ? call.tools : null
  const messages = Array.isArray(call.messages) ? call.messages : null
  const startedAt = typeof call.startedAt === 'number' ? call.startedAt : null
  const finishedAt = typeof call.finishedAt === 'number' ? call.finishedAt : null

  if (!id || turnIndex === null || !model || !systemPrompt || !tools || !messages) {
    return null
  }

  return {
    callId: id,
    turnIndex,
    kind:
      kind === 'memory'
      || kind === 'emotion'
      || kind === 'compaction'
      || kind === 'relationship'
        ? kind
        : 'turn',
    model,
    systemPrompt,
    tools,
    messages,
    metadata: typeof call.metadata === 'object' && call.metadata !== null
      ? call.metadata as Record<string, unknown>
      : null,
    response: call.response,
    stopReason: typeof call.stopReason === 'string' ? call.stopReason : null,
    usage:
      typeof call.inputTokens === 'number' && typeof call.outputTokens === 'number'
        ? { inputTokens: call.inputTokens, outputTokens: call.outputTokens }
        : null,
    error: typeof call.error === 'string' ? call.error : null,
    startedAt,
    finishedAt,
    finished: true,
  }
}

async function loadLatestObserverTurn(sessionId: string): Promise<LiveCall[]> {
  const turnsRes = await fetch(`/api/observer/sessions/${sessionId}`)
  if (!turnsRes.ok) {
    return []
  }

  const turnsData = await turnsRes.json() as { turns?: ObserverTurnSummary[] }
  const turns = turnsData.turns ?? []
  const latestTurn = [...turns].reverse().find((turn) => turn.calls.length > 0 && turn.calls.every((call) => call.finishedAt !== null))
    ?? [...turns].reverse().find((turn) => turn.calls.length > 0)
  if (!latestTurn) {
    return []
  }

  const detailResults = await Promise.all(
    latestTurn.calls.map(async (summaryCall) => {
      const response = await fetch(`/api/observer/calls/${summaryCall.id}`)
      if (!response.ok) {
        return null
      }

      const detail = await response.json() as Record<string, unknown>
      const call = normalizeCallDetail(detail)
      if (!call) {
        return null
      }

      return {
        startedAt: summaryCall.startedAt,
        call: {
          ...call,
          startedAt: call.startedAt ?? summaryCall.startedAt,
          finishedAt: call.finishedAt ?? summaryCall.finishedAt,
        },
      }
    }),
  )

  const calls: Array<{ startedAt: number; call: LiveCall }> = []
  for (const item of detailResults) {
    if (item !== null) {
      calls.push(item)
    }
  }

  return calls
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((item) => item.call)
}

export function ChatArea({ sessionId, agentModules }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentTools, setCurrentTools] = useState<ToolExecution[]>([])
  const [observerOpen, setObserverOpen] = useState(false)
  const [observerTurn, setObserverTurn] = useState<ObserverTurnState>({ calls: [], status: 'loading' })
  const [activeObserverTab, setActiveObserverTab] = useState<ObserverTab>('main')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsStreaming(false)
    setMessages([])
    setCurrentTools([])
    setObserverTurn({ calls: [], status: 'loading' })

    fetch(`/api/sessions/${sessionId}/messages`)
      .then((r) => r.json())
      .then((data: { messages: DbMessage[] }) => {
        if (cancelled) return
        const rendered = data.messages
          .map(renderDbMessage)
          .filter((m): m is ChatMessage => m !== null)
        setMessages(rendered)
      })
      .catch(() => {})

    loadLatestObserverTurn(sessionId)
      .then((calls) => {
        if (cancelled) return
        setObserverTurn({
          calls,
          status: calls.length > 0 ? 'complete' : 'idle',
        })
      })
      .catch(() => {
        if (cancelled) return
        setObserverTurn({ calls: [], status: 'idle' })
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentTools])

  function setAssistantText(text: string) {
    setMessages((prev) => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last?.role === 'assistant') {
        updated[updated.length - 1] = { ...last, content: text }
      } else {
        updated.push({ role: 'assistant', content: text })
      }
      return updated
    })
  }

  function markInterrupted(currentText: string) {
    const content = currentText
      ? `${currentText}${INTERRUPTED_SUFFIX}`
      : '（中断）'

    setAssistantText(content)
  }

  function handleStop() {
    abortControllerRef.current?.abort()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isStreaming) return

    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsStreaming(true)
    setCurrentTools([])

    let assistantText = ''
    let abortedHandled = false
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, sessionId }),
        signal: abortController.signal,
      })

      if (!res.ok) {
        throw new Error(`API error: ${res.statusText}`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break

          try {
            const event = JSON.parse(data)

            switch (event.type) {
              case 'turn_start':
                setObserverTurn({ calls: [], status: 'running' })
                break

              case 'turn_end':
                setObserverTurn((prev) => ({
                  ...prev,
                  status: event.payload?.status === 'error'
                    ? 'error'
                    : event.payload?.status === 'aborted'
                      ? 'complete'
                      : 'complete',
                }))
                break

              case 'text_delta':
                assistantText += event.text
                setAssistantText(assistantText)
                break

              case 'tool_start':
                setCurrentTools((prev) => [
                  ...prev,
                  { toolName: event.toolName, input: event.input },
                ])
                break

              case 'tool_result':
                setCurrentTools((prev) =>
                  prev.map((t) =>
                    t.toolName === event.toolName && !t.output
                      ? { ...t, output: event.result.output, isError: event.result.isError }
                      : t,
                  ),
                )
                break

              case 'llm_call_start':
                setObserverTurn((prev) => ({
                  status: 'running',
                  calls: [
                    ...prev.calls,
                    {
                      callId: event.callId,
                      turnIndex: event.turnIndex,
                      kind: event.payload.kind,
                      model: event.payload.model,
                      systemPrompt: event.payload.systemPrompt,
                      tools: event.payload.tools,
                      messages: event.payload.messages,
                      metadata: event.payload.metadata ?? null,
                      startedAt: Date.now(),
                      finishedAt: null,
                      finished: false,
                    },
                  ],
                }))
                break

              case 'llm_call_end':
                setObserverTurn((prev) => ({
                  ...prev,
                  calls: prev.calls.map((c) =>
                    c.callId === event.callId
                      ? {
                          ...c,
                          response: event.payload.response,
                          stopReason: event.payload.stopReason,
                          usage: event.payload.usage,
                          metadata: {
                            ...(c.metadata ?? {}),
                            ...(event.payload.metadata ?? {}),
                          },
                          error: event.payload.error,
                          finishedAt: Date.now(),
                          finished: true,
                        }
                      : c,
                  ),
                }))
                break

              case 'complete':
                assistantText = ''
                break

              case 'aborted':
                abortedHandled = true
                markInterrupted(assistantText)
                assistantText = ''
                break

              case 'error':
                setMessages((prev) => [
                  ...prev,
                  { role: 'assistant', content: `Error: ${event.error}` },
                ])
                break
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        if (!abortedHandled) {
          markInterrupted(assistantText)
        }
      } else {
        setObserverTurn((prev) => ({ ...prev, status: 'error' }))
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `连接错误：${err}` },
        ])
      }
    } finally {
      abortControllerRef.current = null
      setIsStreaming(false)
      setCurrentTools([])
    }
  }

  return (
    <div className="chat-area-root">
      <div className="chat-col">
        <header className="chat-header">
          <div className="chat-header-title">
            <span className="dot" aria-hidden />
            <h1>对话</h1>
          </div>
          <button
            onClick={() => setObserverOpen((o) => !o)}
            title="切换观测器"
            className={`btn btn-ghost${observerOpen ? ' is-active' : ''}`}
          >
            观测器
          </button>
        </header>

        <div className="thread">
          {messages.length === 0 && (
            <div className="thread-empty">
              <div className="thread-empty-glyph" aria-hidden />
              <p className="thread-empty-title">打个招呼</p>
              <p className="thread-empty-sub">
                从任何一句话开始都行，可以是想法、问题，或者一句轻轻的问候。
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`msg msg-${msg.role}`}>
              <div className="bubble">{msg.content}</div>
            </div>
          ))}

          {currentTools.map((tool, i) => (
            <div key={i} className="tool-call">
              <div className="tool-head">
                <span className="tool-badge">工具</span>
                <code>
                  {tool.toolName}
                  <span className="tool-input">
                    {' · '}
                    {JSON.stringify(tool.input)}
                  </span>
                </code>
              </div>
              {tool.output && (
                <pre className={tool.isError ? 'tool-out is-error' : 'tool-out'}>
                  {tool.output}
                </pre>
              )}
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="composer">
          <div className="composer-box">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入消息…"
              disabled={isStreaming}
              className="composer-input"
            />
            <button
              type={isStreaming ? 'button' : 'submit'}
              onClick={isStreaming ? handleStop : undefined}
              disabled={!isStreaming && !input.trim()}
              className={`composer-send${isStreaming ? ' is-stop' : ''}`}
              aria-label={isStreaming ? '停止' : '发送'}
            >
              {isStreaming ? (
                <span className="stop-glyph" aria-hidden />
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <path
                    d="M2 8l12-6-4.5 13-2.5-5-5-2z"
                    fill="currentColor"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>
          </div>
        </form>
      </div>

      {observerOpen && (
        <ObserverDrawer
          turn={observerTurn}
          agentModules={agentModules}
          activeTab={activeObserverTab}
          setActiveTab={setActiveObserverTab}
        />
      )}

      <style jsx>{`
        .chat-area-root {
          display: flex;
          flex: 1;
          min-width: 0;
          overflow: hidden;
        }
        .chat-col {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-width: 0;
        }
        .chat-header {
          padding: 14px 24px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          backdrop-filter: blur(18px) saturate(140%);
          -webkit-backdrop-filter: blur(18px) saturate(140%);
          background: rgba(10, 10, 15, 0.6);
        }
        .chat-header-title {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .chat-header-title h1 {
          font-family: var(--font-display);
          font-size: 17px;
          font-weight: 500;
          font-variation-settings: 'SOFT' 80, 'opsz' 24;
          color: var(--fg);
          letter-spacing: -0.01em;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--success);
          box-shadow: 0 0 10px rgba(74, 222, 128, 0.6);
        }
        :global(.btn-ghost.is-active) {
          background: var(--indigo-soft);
          color: var(--indigo);
        }

        .thread {
          flex: 1;
          overflow-y: auto;
          padding: 32px 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .thread-empty {
          margin: auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 10px;
          padding-bottom: 48px;
        }
        .thread-empty-glyph {
          width: 64px;
          height: 64px;
          border-radius: 999px;
          background:
            radial-gradient(circle at 30% 30%, var(--indigo-glow), transparent 60%),
            radial-gradient(circle at 70% 70%, var(--orange-soft), transparent 60%);
          border: 1px solid var(--border);
        }
        .thread-empty-title {
          font-family: var(--font-display);
          font-size: 20px;
          font-variation-settings: 'SOFT' 100, 'opsz' 28;
          color: var(--fg);
        }
        .thread-empty-sub {
          color: var(--fg-muted);
          font-size: 14px;
          max-width: 38ch;
        }

        .msg {
          display: flex;
          width: 100%;
        }
        .msg-user {
          justify-content: flex-end;
        }
        .msg-assistant {
          justify-content: flex-start;
        }
        .bubble {
          max-width: min(680px, 75%);
          padding: 10px 14px;
          border-radius: 18px;
          font-size: 14.5px;
          line-height: 1.55;
          white-space: pre-wrap;
          word-wrap: break-word;
          animation: bubble-in var(--dur) var(--ease);
        }
        .msg-user .bubble {
          background: linear-gradient(135deg, var(--indigo) 0%, #a78bfa 100%);
          color: #0b0b16;
          border-bottom-right-radius: 6px;
          font-weight: 500;
          box-shadow: 0 8px 24px -12px var(--indigo-glow);
        }
        .msg-assistant .bubble {
          background: var(--bg-glass);
          border: 1px solid var(--border);
          color: var(--fg);
          border-bottom-left-radius: 6px;
          backdrop-filter: blur(12px) saturate(140%);
          -webkit-backdrop-filter: blur(12px) saturate(140%);
        }
        @keyframes bubble-in {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .tool-call {
          align-self: flex-start;
          max-width: min(680px, 75%);
          background: rgba(251, 146, 60, 0.06);
          border: 1px solid rgba(251, 146, 60, 0.22);
          border-radius: 14px;
          padding: 10px 14px;
          font-size: 13px;
        }
        .tool-head {
          display: flex;
          gap: 8px;
          align-items: center;
          color: var(--orange);
          font-family: ui-monospace, 'JetBrains Mono', monospace;
        }
        .tool-badge {
          font-family: var(--font-body);
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 2px 6px;
          background: var(--orange-soft);
          border-radius: 999px;
          color: var(--orange);
          font-weight: 600;
        }
        .tool-input {
          color: var(--fg-subtle);
        }
        .tool-out {
          margin-top: 8px;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.3);
          color: var(--fg-muted);
          font-family: ui-monospace, 'JetBrains Mono', monospace;
          font-size: 12px;
          white-space: pre-wrap;
          max-height: 200px;
          overflow-y: auto;
        }
        .tool-out.is-error {
          color: var(--danger);
          background: rgba(248, 113, 113, 0.08);
        }

        .composer {
          padding: 16px 24px 24px;
          flex-shrink: 0;
        }
        .composer-box {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 6px 6px 16px;
          border-radius: 999px;
          background: var(--bg-glass);
          border: 1px solid var(--border);
          backdrop-filter: blur(14px) saturate(140%);
          -webkit-backdrop-filter: blur(14px) saturate(140%);
          transition: border-color var(--dur) var(--ease),
            box-shadow var(--dur) var(--ease);
        }
        .composer-box:focus-within {
          border-color: var(--indigo);
          box-shadow: 0 0 0 4px var(--indigo-soft);
        }
        .composer-input {
          flex: 1;
          padding: 10px 0;
          border: none;
          background: transparent;
          color: var(--fg);
          font-size: 14.5px;
          outline: none;
        }
        .composer-send {
          width: 36px;
          height: 36px;
          border-radius: 999px;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, var(--indigo) 0%, #a78bfa 100%);
          color: #0b0b16;
          transition: transform var(--dur-fast) var(--ease),
            opacity var(--dur) var(--ease);
          box-shadow: 0 6px 16px -6px var(--indigo-glow);
        }
        .composer-send.is-stop {
          background: linear-gradient(135deg, #fb7185 0%, #f97316 100%);
          color: #190b0f;
          box-shadow: 0 6px 16px -6px rgba(251, 113, 133, 0.42);
        }
        .composer-send:hover:not(:disabled) {
          transform: scale(1.05);
        }
        .composer-send:active:not(:disabled) {
          transform: scale(0.96);
        }
        .composer-send:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .stop-glyph {
          width: 10px;
          height: 10px;
          border-radius: 3px;
          background: currentColor;
        }
      `}</style>
    </div>
  )
}
