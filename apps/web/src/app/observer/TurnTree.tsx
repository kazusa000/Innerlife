'use client'

import { getObserverUiCopy, translateCallKind, type UiLocale } from '../../lib/ui-copy'

export interface TurnNode {
  userMessageId: string
  userText: string
  createdAt: number
  calls: Array<{
    id: string
    turnIndex: number
    kind: 'turn' | 'compaction' | 'memory' | 'emotion' | 'relationship'
    stopReason: string | null
    startedAt: number
    finishedAt: number | null
  }>
}

interface Props {
  turns: TurnNode[]
  currentCallId: string | null
  onSelectCall: (id: string) => void
  locale: UiLocale
}

function describeCallKind(kind: TurnNode['calls'][number]['kind'], locale: UiLocale) {
  return translateCallKind(kind, locale)
}

export function TurnTree({ turns, currentCallId, onSelectCall, locale }: Props) {
  const copy = getObserverUiCopy(locale)
  return (
    <section className="observer-turns">
      <div className="observer-panel-head observer-panel-head-compact">
        <span className="observer-eyebrow">Timeline</span>
        <strong>{locale === 'en-US' ? 'Call Trace' : '调用轨迹'}</strong>
      </div>
      {turns.length === 0 && (
        <p className="observer-empty">{locale === 'en-US' ? 'This session has no observer records yet.' : '当前会话还没有观测记录。'}</p>
      )}
      {turns.map((turn) => (
        <div key={turn.userMessageId} className="observer-turn-group">
          <div
            className="observer-user-text"
            title={turn.userText}
          >
            {locale === 'en-US' ? 'User' : '用户'}: {turn.userText || (locale === 'en-US' ? '(empty)' : '（空）')}
          </div>
          {turn.calls.map((c) => {
            const active = c.id === currentCallId
            return (
              <button
                key={c.id}
                onClick={() => onSelectCall(c.id)}
                className={`observer-call-item${active ? ' observer-call-item-active' : ''}`}
              >
                <span>{describeCallKind(c.kind, locale)} #{c.turnIndex}</span>
                <span>
                  {c.stopReason ?? (c.finishedAt ? '?' : copy.pending)}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </section>
  )
}
