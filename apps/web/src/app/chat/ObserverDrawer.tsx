'use client'

import { useEffect, useState } from 'react'

export interface LiveCall {
  callId: string
  turnIndex: number
  model: string
  systemPrompt: string
  tools: unknown[]
  messages: unknown[]
  response?: unknown
  stopReason?: string
  usage?: { inputTokens: number; outputTokens: number }
  error?: string
  finished: boolean
}

interface Props {
  calls: LiveCall[]
  activeCallId: string | null
  setActiveCallId: (id: string | null) => void
}

type Tab = 'system' | 'tools' | 'messages' | 'response'

export function ObserverDrawer({ calls, activeCallId, setActiveCallId }: Props) {
  const [tab, setTab] = useState<Tab>('messages')

  useEffect(() => {
    if (!activeCallId && calls.length > 0) {
      setActiveCallId(calls[calls.length - 1].callId)
    }
  }, [calls, activeCallId])

  const active = calls.find((c) => c.callId === activeCallId) ?? calls[calls.length - 1]

  return (
    <div
      style={{
        width: 420,
        borderLeft: '1px solid #222',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: '#0b0b12',
      }}
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #222', fontSize: 13 }}>
        <strong style={{ color: '#ededed' }}>Observer</strong>{' '}
        <span style={{ color: '#666' }}>
          {calls.length === 0 ? 'waiting for next turn…' : `${calls.length} LLM call(s)`}
        </span>
      </div>

      {calls.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '8px 10px',
            borderBottom: '1px solid #222',
            overflowX: 'auto',
          }}
        >
          {calls.map((c) => (
            <button
              key={c.callId}
              onClick={() => setActiveCallId(c.callId)}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                border: '1px solid #333',
                background: c.callId === activeCallId ? '#1a1a2e' : 'transparent',
                color: c.finished ? '#ededed' : '#f0883e',
                fontSize: 12,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              #{c.turnIndex} {c.finished ? '✓' : '…'}
            </button>
          ))}
        </div>
      )}

      {active && (
        <>
          <div
            style={{
              display: 'flex',
              gap: 2,
              padding: '6px 10px',
              borderBottom: '1px solid #222',
              fontSize: 12,
            }}
          >
            {(['system', 'tools', 'messages', 'response'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: 'none',
                  background: tab === t ? '#1a1a2e' : 'transparent',
                  color: tab === t ? '#ededed' : '#888',
                  cursor: 'pointer',
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 12,
              fontSize: 12,
              fontFamily: 'ui-monospace, monospace',
              whiteSpace: 'pre-wrap',
              color: '#cdd9e5',
            }}
          >
            {tab === 'system' && active.systemPrompt}
            {tab === 'tools' && JSON.stringify(active.tools, null, 2)}
            {tab === 'messages' && JSON.stringify(active.messages, null, 2)}
            {tab === 'response' &&
              (active.response
                ? JSON.stringify(
                    {
                      stopReason: active.stopReason,
                      usage: active.usage,
                      response: active.response,
                      error: active.error,
                    },
                    null,
                    2,
                  )
                : active.error
                  ? `Error: ${active.error}`
                  : '(pending)')}
          </div>
        </>
      )}
    </div>
  )
}
