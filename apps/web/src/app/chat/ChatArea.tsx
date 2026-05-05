'use client'

import { useState, useRef, useEffect } from 'react'
import { useAppLocale } from '@/app/use-app-locale'
import { ObserverDrawer } from './ObserverDrawer'
import {
  formatDayLabel,
  formatMessageTime,
  getInitialVisibleDayKeys,
  getNextHiddenDayKey,
  getVisibleMessages,
  localDayKey,
} from './chat-history'
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
  thinking?: string
  createdAt: string
}

interface ToolExecution {
  toolName: string
  input: Record<string, unknown>
  output?: string
  isError?: boolean
  metadata?: Record<string, unknown> | null
}

interface DbMessage {
  role: string
  content: string
  createdAt?: string | number | Date | null
}

function normalizeCreatedAt(value: DbMessage['createdAt']): string {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString()
  }
  return date.toISOString()
}

function renderDbMessage(m: DbMessage): ChatMessage | null {
  const createdAt = normalizeCreatedAt(m.createdAt)
  if (m.role !== 'user' && m.role !== 'assistant') return null
  try {
    const blocks = JSON.parse(m.content) as Array<{ type: string; text?: string }>
    const text = blocks
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('')
    return { role: m.role, content: text, createdAt }
  } catch {
    return { role: m.role as 'user' | 'assistant', content: m.content, createdAt }
  }
}

interface Props {
  sessionId: string
  agentModules: AgentModules | null
  agentName?: string
  agentAvatarUrl?: string
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatToolScore(value: unknown) {
  const number = readNumber(value)
  return number === null ? '无' : number.toFixed(2)
}

function HybridMemoryToolSummary({ metadata }: { metadata: Record<string, unknown> | null | undefined }) {
  if (metadata?.mode !== 'episodic_hybrid') {
    return null
  }

  const mentions = Array.isArray(metadata.entityMentions)
    ? metadata.entityMentions.flatMap((mention) => {
      const record = isRecord(mention) ? mention : null
      const surface = readText(record?.surface)
      return surface ? [{ surface, type: readText(record?.type) }] : []
    })
    : []
  const hits = Array.isArray(metadata.hits)
    ? metadata.hits.flatMap((hit) => {
      const record = isRecord(hit) ? hit : null
      const retrievalText = readText(record?.retrievalText) ?? readText(record?.summary)
      return retrievalText
        ? [{
            retrievalText,
            graphScore: record?.graphScore,
            textScore: record?.textScore,
            score: record?.score,
          }]
        : []
    })
    : []

  return (
    <div className="tool-memory-summary">
      <div className="tool-memory-row">
        <span>text query</span>
        <code>{readText(metadata.textQuery) ?? '无'}</code>
      </div>
      <div className="tool-memory-row">
        <span>entity mentions</span>
        <code>{mentions.length ? mentions.map((mention) => `${mention.surface}${mention.type ? `/${mention.type}` : ''}`).join(', ') : '无'}</code>
      </div>
      {hits.map((hit, index) => (
        <div key={`${hit.retrievalText}-${index}`} className="tool-memory-hit">
          <strong>{hit.retrievalText}</strong>
          <span>
            图 {formatToolScore(hit.graphScore)} · 文本 {formatToolScore(hit.textScore)} · 最终 {formatToolScore(hit.score)}
          </span>
        </div>
      ))}
    </div>
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

function gradientFor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const a = h % 360
  const b = (a + 40 + (h % 80)) % 360
  return `linear-gradient(135deg, hsl(${a} 70% 58%) 0%, hsl(${b} 75% 52%) 100%)`
}

function initials(name: string | undefined) {
  const trimmed = name?.trim()
  if (!trimmed) return 'TA'
  const parts = trimmed.split(/\s+/)
  const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : trimmed.slice(0, 2)
  return s.toUpperCase()
}

export function ChatArea({ sessionId, agentModules, agentName, agentAvatarUrl }: Props) {
  const locale = useAppLocale()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [visibleDayKeys, setVisibleDayKeys] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentTools, setCurrentTools] = useState<ToolExecution[]>([])
  const [reasoningEnabled, setReasoningEnabled] = useState(false)
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
    setVisibleDayKeys([])
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
        setVisibleDayKeys(getInitialVisibleDayKeys(rendered))
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
    const stored = window.localStorage.getItem('mas.chat.reasoningEnabled')
    setReasoningEnabled(stored === '1')
  }, [])

  useEffect(() => {
    window.localStorage.setItem('mas.chat.reasoningEnabled', reasoningEnabled ? '1' : '0')
  }, [reasoningEnabled])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentTools])

  function ensureVisibleDay(createdAt: string) {
    const dayKey = localDayKey(createdAt)
    setVisibleDayKeys((current) => current.includes(dayKey) ? current : [...current, dayKey])
  }

  function setAssistantText(text: string) {
    const createdAt = new Date().toISOString()
    ensureVisibleDay(createdAt)
    setMessages((prev) => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last?.role === 'assistant') {
        updated[updated.length - 1] = { ...last, content: text }
      } else {
        updated.push({ role: 'assistant', content: text, createdAt })
      }
      return updated
    })
  }

  function setAssistantThinking(text: string) {
    const createdAt = new Date().toISOString()
    ensureVisibleDay(createdAt)
    setMessages((prev) => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last?.role === 'assistant') {
        updated[updated.length - 1] = { ...last, thinking: text }
      } else {
        updated.push({ role: 'assistant', content: '', thinking: text, createdAt })
      }
      return updated
    })
  }

  function loadPreviousDay() {
    const nextDay = getNextHiddenDayKey(messages, visibleDayKeys)
    if (!nextDay) return
    setVisibleDayKeys((current) => [...current, nextDay])
  }

  function markInterrupted(currentText: string) {
    const content = currentText
      ? `${currentText}${locale === 'en-US' ? ' — (interrupted)' : INTERRUPTED_SUFFIX}`
      : (locale === 'en-US' ? '(interrupted)' : '（中断）')

    setAssistantText(content)
  }

  function handleStop() {
    abortControllerRef.current?.abort()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isStreaming) return

    const userMessage = input.trim()
    const now = new Date()
    const todayKey = localDayKey(now)
    setInput('')
    setVisibleDayKeys((current) => current.includes(todayKey) ? current : [...current, todayKey])
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: userMessage, createdAt: now.toISOString() },
    ])
    setIsStreaming(true)
    setCurrentTools([])

    let assistantText = ''
    let thinkingText = ''
    let abortedHandled = false
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          sessionId,
          reasoningEnabled,
          reasoningEffort: 'medium',
        }),
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

              case 'thinking_delta':
                thinkingText += event.text
                setAssistantThinking(thinkingText)
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
                      ? {
                          ...t,
                          output: event.result.output,
                          isError: event.result.isError,
                          metadata: isRecord(event.result.metadata) ? event.result.metadata : null,
                        }
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

              case 'error': {
                const createdAt = new Date().toISOString()
                ensureVisibleDay(createdAt)
                setMessages((prev) => [
                  ...prev,
                  { role: 'assistant', content: `Error: ${event.error}`, createdAt },
                ])
                break
              }
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
        const createdAt = new Date().toISOString()
        ensureVisibleDay(createdAt)
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `${locale === 'en-US' ? 'Connection error' : '连接错误'}: ${err}`, createdAt },
        ])
      }
    } finally {
      abortControllerRef.current = null
      setIsStreaming(false)
      setCurrentTools([])
    }
  }

  const visibleMessages = getVisibleMessages(messages, visibleDayKeys)
  const nextHiddenDayKey = getNextHiddenDayKey(messages, visibleDayKeys)

  return (
    <div className="chat-area-root">
      <div className="chat-col">
        <header className="chat-header">
          <div className="chat-header-title">
            <span className="dot" aria-hidden />
            <h1>{locale === 'en-US' ? 'Chat' : '对话'}</h1>
          </div>
          <button
            onClick={() => setObserverOpen((o) => !o)}
            title={locale === 'en-US' ? 'Toggle observer' : '切换观测器'}
            className={`btn btn-ghost${observerOpen ? ' is-active' : ''}`}
          >
            {locale === 'en-US' ? 'Observer' : '观测器'}
          </button>
          <label className="reasoning-toggle" title={locale === 'en-US' ? 'Toggle main-chat thinking mode' : '切换主对话思考模式'}>
            <span>{locale === 'en-US' ? 'Think' : '思考'}</span>
            <input
              type="checkbox"
              checked={reasoningEnabled}
              onChange={(event) => setReasoningEnabled(event.target.checked)}
              disabled={isStreaming}
            />
            <span className="toggle-track" aria-hidden>
              <span className="toggle-thumb" />
            </span>
          </label>
        </header>

        <div className="thread">
          {nextHiddenDayKey && (
            <button type="button" className="history-more" onClick={loadPreviousDay}>
              {locale === 'en-US' ? 'Show more history' : '查看更多历史消息'} · {formatDayLabel(nextHiddenDayKey, new Date(), locale)}
            </button>
          )}

          {visibleMessages.length === 0 && (
            <div className="thread-empty">
              <div className="thread-empty-glyph" aria-hidden />
              <p className="thread-empty-title">{locale === 'en-US' ? 'No messages today' : '今天还没有消息'}</p>
              <p className="thread-empty-sub">
                {locale === 'en-US'
                  ? 'Start with anything: a thought, a question, or a quiet hello.'
                  : '从任何一句话开始都行，可以是想法、问题，或者一句轻轻的问候。'}
              </p>
            </div>
          )}

          {visibleMessages.map((msg, i) => {
            const dayKey = localDayKey(msg.createdAt)
            const previousDayKey = i > 0 ? localDayKey(visibleMessages[i - 1]?.createdAt) : null
            const showDayDivider = dayKey !== previousDayKey

            return (
              <div key={`${msg.createdAt}-${i}`}>
                {showDayDivider && <div className="day-divider">{formatDayLabel(dayKey, new Date(), locale)}</div>}
                <div className={`msg msg-${msg.role}`}>
                  {msg.role === 'assistant' && (
                    <div
                      className="assistant-avatar"
                      style={agentAvatarUrl ? undefined : { backgroundImage: gradientFor(agentName ?? 'assistant') }}
                      aria-hidden
                    >
                      {agentAvatarUrl ? (
                        <img src={agentAvatarUrl} alt="" />
                      ) : (
                        initials(agentName)
                      )}
                    </div>
                  )}
                  <div className="msg-stack">
                    {msg.thinking && (
                      <details className="thinking-panel" open={isStreaming && i === visibleMessages.length - 1}>
                        <summary>{locale === 'en-US' ? 'Thinking' : '思考内容'}</summary>
                        <pre>{msg.thinking}</pre>
                      </details>
                    )}
                    {msg.content && (
                      <div className="bubble">
                        <span className="bubble-text">{msg.content}</span>
                        <time className="bubble-time" dateTime={msg.createdAt}>
                          {formatMessageTime(msg.createdAt)}
                        </time>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {currentTools.map((tool, i) => (
            <div key={i} className="tool-call">
              <div className="tool-head">
                <span className="tool-badge">{locale === 'en-US' ? 'Tool' : '工具'}</span>
                <code>
                  {tool.toolName}
                  <span className="tool-input">
                    {' · '}
                    {JSON.stringify(tool.input)}
                  </span>
                </code>
              </div>
              {tool.output && (
                <>
                  <HybridMemoryToolSummary metadata={tool.metadata} />
                  <pre className={tool.isError ? 'tool-out is-error' : 'tool-out'}>
                    {tool.output}
                  </pre>
                </>
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
              placeholder={locale === 'en-US' ? 'Type a message...' : '输入消息…'}
              disabled={isStreaming}
              className="composer-input"
            />
            <button
              type={isStreaming ? 'button' : 'submit'}
              onClick={isStreaming ? handleStop : undefined}
              disabled={!isStreaming && !input.trim()}
              className={`composer-send${isStreaming ? ' is-stop' : ''}`}
              aria-label={isStreaming ? (locale === 'en-US' ? 'Stop' : '停止') : (locale === 'en-US' ? 'Send' : '发送')}
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
          border-bottom: 1px solid rgba(148, 163, 184, 0.13);
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          backdrop-filter: blur(18px) saturate(140%);
          -webkit-backdrop-filter: blur(18px) saturate(140%);
          background:
            linear-gradient(90deg, rgba(5, 10, 20, 0.82), rgba(8, 13, 24, 0.48)),
            rgba(10, 10, 15, 0.54);
        }
        .chat-header-title {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          min-width: 0;
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
        .reasoning-toggle {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          color: var(--fg-muted);
          font-size: 12px;
          cursor: pointer;
          user-select: none;
          background: rgba(255, 255, 255, 0.03);
        }
        .reasoning-toggle input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }
        .toggle-track {
          width: 34px;
          height: 18px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid var(--border-subtle);
          padding: 2px;
          transition: background 160ms ease, border-color 160ms ease;
        }
        .toggle-thumb {
          display: block;
          width: 12px;
          height: 12px;
          border-radius: 999px;
          background: var(--fg-muted);
          transition: transform 160ms ease, background 160ms ease;
        }
        .reasoning-toggle input:checked + .toggle-track {
          background: var(--indigo-soft);
          border-color: rgba(129, 140, 248, 0.6);
        }
        .reasoning-toggle input:checked + .toggle-track .toggle-thumb {
          transform: translateX(16px);
          background: var(--indigo);
        }
        .reasoning-toggle:has(input:disabled) {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .thread {
          flex: 1;
          overflow-y: auto;
          padding: 32px 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .history-more {
          align-self: center;
          padding: 7px 12px;
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--fg-muted);
          cursor: pointer;
          font-size: 12px;
          transition: border-color var(--dur) var(--ease),
            color var(--dur) var(--ease),
            background var(--dur) var(--ease);
        }
        .history-more:hover {
          border-color: var(--border);
          background: rgba(255, 255, 255, 0.07);
          color: var(--fg);
        }
        .day-divider {
          align-self: center;
          padding: 2px 9px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--fg-subtle);
          font-size: 11px;
          line-height: 1.6;
        }
        .thinking-panel {
          width: 100%;
          border: 1px solid rgba(129, 140, 248, 0.28);
          border-radius: 8px;
          background: rgba(79, 70, 229, 0.08);
          color: var(--fg-muted);
          overflow: hidden;
        }
        .msg-assistant .thinking-panel {
          align-self: stretch;
        }
        .thinking-panel summary {
          cursor: pointer;
          padding: 8px 12px;
          font-size: 12px;
          color: var(--indigo);
        }
        .thinking-panel pre {
          margin: 0;
          padding: 0 12px 12px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          font-family: var(--font-sans);
          font-size: 12px;
          line-height: 1.6;
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
          gap: 10px;
          align-items: flex-end;
        }
        .msg-user {
          justify-content: flex-end;
        }
        .msg-assistant {
          justify-content: flex-start;
          align-items: flex-start;
        }
        .msg-stack {
          max-width: min(680px, 75%);
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .msg-user .msg-stack {
          align-items: flex-end;
        }
        .msg-assistant .msg-stack {
          align-items: flex-start;
        }
        .assistant-avatar {
          width: 32px;
          height: 32px;
          margin-top: 4px;
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.18);
          color: rgba(255, 255, 255, 0.95);
          font-family: var(--font-display);
          font-size: 11px;
          font-weight: 600;
          box-shadow: 0 8px 18px -12px rgba(0, 0, 0, 0.8);
        }
        .assistant-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .bubble {
          max-width: 100%;
          min-width: 64px;
          padding: 10px 14px;
          border-radius: 18px;
          display: flex;
          flex-direction: column;
          gap: 4px;
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
        .bubble-text {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .bubble-time {
          align-self: flex-end;
          flex-shrink: 0;
          margin-top: 1px;
          font-size: 10.5px;
          line-height: 1;
          font-variant-numeric: tabular-nums;
        }
        .msg-user .bubble-time {
          color: rgba(11, 11, 22, 0.58);
        }
        .msg-assistant .bubble-time {
          color: var(--fg-subtle);
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
        .tool-memory-summary {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 10px;
          padding: 10px;
          border-radius: 10px;
          border: 1px solid rgba(52, 211, 153, 0.2);
          background: rgba(52, 211, 153, 0.07);
        }
        .tool-memory-row,
        .tool-memory-hit {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          justify-content: space-between;
          color: var(--fg-muted);
        }
        .tool-memory-row span,
        .tool-memory-hit span {
          color: var(--fg-subtle);
          font-size: 12px;
        }
        .tool-memory-row code,
        .tool-memory-hit strong {
          color: var(--fg);
          font-size: 12px;
          text-align: right;
        }
        .tool-memory-hit {
          flex-direction: column;
          justify-content: flex-start;
        }
        .tool-memory-hit strong {
          text-align: left;
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
          background: rgba(4, 8, 16, 0.72);
          border: 1px solid rgba(148, 163, 184, 0.18);
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
