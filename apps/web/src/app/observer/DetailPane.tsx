'use client'

import { useEffect, useState } from 'react'
import { MessagesView, ResponseView } from '@/lib/call-renderers'

interface CallDetail {
  id: string
  model: string
  systemPrompt: string
  tools: unknown
  messages: unknown
  response: unknown
  stopReason: string | null
  inputTokens: number | null
  outputTokens: number | null
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

interface Props {
  callId: string | null
}

type Tab = 'system' | 'tools' | 'history' | 'response'

const INPUT_TABS: Tab[] = ['system', 'tools', 'history']
const OUTPUT_TABS: Tab[] = ['response']

export function DetailPane({ callId }: Props) {
  const [detail, setDetail] = useState<CallDetail | null>(null)
  const [tab, setTab] = useState<Tab>('history')

  useEffect(() => {
    if (!callId) {
      setDetail(null)
      return
    }
    let cancelled = false
    fetch(`/api/observer/calls/${callId}`)
      .then((r) => r.json())
      .then((data: CallDetail) => {
        if (!cancelled) setDetail(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [callId])

  if (!callId) {
    return (
      <div style={{ flex: 1, padding: 40, color: '#666', fontSize: 13 }}>
        Select a call to see its details.
      </div>
    )
  }
  if (!detail) {
    return <div style={{ flex: 1, padding: 40, color: '#666' }}>Loading…</div>
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #222', fontSize: 12, color: '#888' }}>
        {detail.model} · in {detail.inputTokens ?? '?'} / out {detail.outputTokens ?? '?'} tokens · {detail.stopReason ?? 'pending'}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 10px',
          borderBottom: '1px solid #222',
        }}
      >
        <span style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', marginRight: 2 }}>
          input
        </span>
        {INPUT_TABS.map((t) => (
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
              fontSize: 12,
            }}
          >
            {t}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ color: '#555', fontSize: 10, textTransform: 'uppercase', marginRight: 2 }}>
          output
        </span>
        {OUTPUT_TABS.map((t) => (
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
              fontSize: 12,
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
        {tab === 'system' && detail.systemPrompt}
        {tab === 'tools' && JSON.stringify(detail.tools, null, 2)}
        {tab === 'history' && <MessagesView messages={detail.messages} />}
        {tab === 'response' && (
          <ResponseView
            response={detail.response}
            stopReason={detail.stopReason}
            inputTokens={detail.inputTokens}
            outputTokens={detail.outputTokens}
            latencyMs={
              detail.startedAt && detail.finishedAt
                ? detail.finishedAt - detail.startedAt
                : null
            }
            error={detail.error}
          />
        )}
      </div>
    </div>
  )
}
