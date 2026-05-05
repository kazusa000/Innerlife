'use client'

import { useEffect, useState } from 'react'
import { formatDurationLabel } from '../../lib/format-duration'
import { CompactionView, EmotionView, MemoryView, MessagesView, ResponseView } from '@/lib/call-renderers'
import { getObserverUiCopy, translateCallKind, translateObserverTab, type UiLocale } from '../../lib/ui-copy'

interface CallDetail {
  id: string
  kind: 'turn' | 'compaction' | 'memory' | 'emotion' | 'relationship'
  model: string
  systemPrompt: string
  tools: unknown
  messages: unknown
  metadata: unknown
  latestEmotionState: unknown
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
  locale: UiLocale
}

type Tab = 'system' | 'tools' | 'history' | 'metadata' | 'compaction' | 'emotion' | 'memory' | 'response'
const OUTPUT_TABS: Tab[] = ['response']

export function DetailPane({ callId, locale }: Props) {
  const copy = getObserverUiCopy(locale)
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
        <div className="observer-detail observer-detail-empty">
        {copy.selectCall}
        </div>
    )
  }
  if (!detail) {
    return <div className="observer-detail observer-detail-empty">{copy.loading}</div>
  }

  const inputTabs: Tab[] = [
    'system',
    'tools',
    'history',
    ...(detail.metadata !== null ? ['metadata' as const] : []),
    ...(detail.kind === 'compaction' ? ['compaction' as const] : []),
    ...(detail.kind === 'emotion' || detail.latestEmotionState ? ['emotion' as const] : []),
    ...(detail.kind === 'memory' ? ['memory' as const] : []),
  ]
  const duration = formatDurationLabel(detail.startedAt, detail.finishedAt)

  return (
    <main className="observer-detail">
      <div className="observer-detail-meta">
        {translateCallKind(detail.kind, locale)} · {detail.model} · {copy.inputTokens} {detail.inputTokens ?? '?'} / {copy.outputTokens} {detail.outputTokens ?? '?'} tokens · {detail.stopReason ?? copy.pending}{duration ? ` · ${duration}` : ''}
      </div>
      <div className="observer-tabs">
        <span className="observer-tabs-label">
          {copy.input}
        </span>
        {inputTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`observer-tab${tab === t ? ' observer-tab-active' : ''}`}
          >
            {translateObserverTab(t, locale)}
          </button>
        ))}
        <span className="observer-tabs-spacer" />
        <span className="observer-tabs-label">
          {copy.output}
        </span>
        {OUTPUT_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`observer-tab${tab === t ? ' observer-tab-active' : ''}`}
          >
            {translateObserverTab(t, locale)}
          </button>
        ))}
      </div>
      <div className="observer-detail-body">
        {tab === 'system' && detail.systemPrompt}
        {tab === 'tools' && JSON.stringify(detail.tools, null, 2)}
        {tab === 'history' && <MessagesView messages={detail.messages} />}
        {tab === 'metadata' && JSON.stringify(detail.metadata ?? null, null, 2)}
        {tab === 'compaction' && <CompactionView metadata={detail.metadata} />}
        {tab === 'emotion' && (
          <EmotionView
            metadata={detail.metadata}
            latestState={detail.latestEmotionState}
          />
        )}
        {tab === 'memory' && <MemoryView metadata={detail.metadata} />}
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
    </main>
  )
}
