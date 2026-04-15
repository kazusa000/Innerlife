'use client'

import { useState, useRef, useEffect } from 'react'
import { ObserverDrawer, LiveCall } from './ObserverDrawer'

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
  onFirstMessage?: () => void
}

export function ChatArea({ sessionId, onFirstMessage }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentTools, setCurrentTools] = useState<ToolExecution[]>([])
  const [observerOpen, setObserverOpen] = useState(false)
  const [liveCalls, setLiveCalls] = useState<LiveCall[]>([])
  const [activeCallId, setActiveCallId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setMessages([])
    setCurrentTools([])
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
    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentTools])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isStreaming) return

    const userMessage = input.trim()
    const isFirst = messages.length === 0
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsStreaming(true)
    setCurrentTools([])
    setLiveCalls([])
    setActiveCallId(null)

    let assistantText = ''

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, sessionId }),
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
              case 'text_delta':
                assistantText += event.text
                setMessages((prev) => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: assistantText }
                  } else {
                    updated.push({ role: 'assistant', content: assistantText })
                  }
                  return updated
                })
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
                setLiveCalls((prev) => [
                  ...prev,
                  {
                    callId: event.callId,
                    turnIndex: event.turnIndex,
                    model: event.model,
                    systemPrompt: event.systemPrompt,
                    tools: event.tools,
                    messages: event.messages,
                    finished: false,
                  },
                ])
                break

              case 'llm_call_end':
                setLiveCalls((prev) =>
                  prev.map((c) =>
                    c.callId === event.callId
                      ? {
                          ...c,
                          response: event.response,
                          stopReason: event.stopReason,
                          usage: event.usage,
                          error: event.error,
                          finished: true,
                        }
                      : c,
                  ),
                )
                break

              case 'complete':
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
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Connection error: ${err}` },
      ])
    } finally {
      setIsStreaming(false)
      setCurrentTools([])
      if (isFirst) onFirstMessage?.()
    }
  }

  return (
    <div style={{ display: 'flex', flex: 1, minWidth: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <header
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #222',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Multi-Agent System</h1>
          <button
            onClick={() => setObserverOpen((o) => !o)}
            title="Toggle Observer"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #333',
              background: observerOpen ? '#1a1a2e' : 'transparent',
              color: observerOpen ? '#4a9eff' : '#888',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            🔍
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {messages.length === 0 && (
            <p style={{ color: '#666', textAlign: 'center', marginTop: 100 }}>
              Send a message to start chatting.
            </p>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                marginBottom: 16,
                padding: '12px 16px',
                borderRadius: 8,
                background: msg.role === 'user' ? '#1a1a2e' : '#111',
                borderLeft: msg.role === 'assistant' ? '3px solid #4a9eff' : 'none',
              }}
            >
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                {msg.role === 'user' ? 'You' : 'Agent'}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{msg.content}</div>
            </div>
          ))}

          {currentTools.map((tool, i) => (
            <div
              key={i}
              style={{
                marginBottom: 8,
                padding: '8px 12px',
                borderRadius: 6,
                background: '#0d1117',
                border: '1px solid #30363d',
                fontSize: 13,
              }}
            >
              <div style={{ color: '#f0883e' }}>
                $ {tool.toolName}: {JSON.stringify(tool.input)}
              </div>
              {tool.output && (
                <pre
                  style={{
                    color: tool.isError ? '#f85149' : '#7ee787',
                    marginTop: 4,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {tool.output}
                </pre>
              )}
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ padding: '16px 20px', borderTop: '1px solid #222', flexShrink: 0 }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              disabled={isStreaming}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #333',
                background: '#111',
                color: '#ededed',
                fontSize: 14,
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={isStreaming || !input.trim()}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: isStreaming ? '#333' : '#4a9eff',
                color: '#fff',
                fontSize: 14,
                cursor: isStreaming ? 'not-allowed' : 'pointer',
              }}
            >
              {isStreaming ? '...' : 'Send'}
            </button>
          </div>
        </form>
      </div>

      {observerOpen && (
        <ObserverDrawer calls={liveCalls} activeCallId={activeCallId} setActiveCallId={setActiveCallId} />
      )}
    </div>
  )
}
