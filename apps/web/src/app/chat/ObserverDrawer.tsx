'use client'

import { useEffect, useState } from 'react'
import { MessagesView, ResponseView } from '@/lib/call-renderers'

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

type Tab = 'system' | 'tools' | 'history' | 'response'

const INPUT_TABS: Tab[] = ['system', 'tools', 'history']
const OUTPUT_TABS: Tab[] = ['response']

function tabButton(t: Tab, active: Tab, setTab: (t: Tab) => void) {
  return (
    <button
      key={t}
      onClick={() => setTab(t)}
      style={{
        padding: '4px 10px',
        borderRadius: 4,
        border: 'none',
        background: active === t ? '#1a1a2e' : 'transparent',
        color: active === t ? '#ededed' : '#888',
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      {t}
    </button>
  )
}

export function ObserverDrawer({ calls, activeCallId, setActiveCallId }: Props) {
  const [tab, setTab] = useState<Tab>('history')

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
              alignItems: 'center',
              gap: 4,
              padding: '6px 10px',
              borderBottom: '1px solid #222',
              fontSize: 12,
            }}
          >
            <span style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', marginRight: 2 }}>
              input
            </span>
            {INPUT_TABS.map((t) => tabButton(t, tab, setTab))}
            <span style={{ flex: 1 }} />
            <span style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', marginRight: 2 }}>
              output
            </span>
            {OUTPUT_TABS.map((t) => tabButton(t, tab, setTab))}
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
            {tab === 'history' && <MessagesView messages={active.messages} />}
            {tab === 'response' && (
              <ResponseView
                response={active.response}
                stopReason={active.stopReason}
                inputTokens={active.usage?.inputTokens ?? null}
                outputTokens={active.usage?.outputTokens ?? null}
                error={active.error}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
