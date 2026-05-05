'use client'

import { getObserverUiCopy, type UiLocale } from '../../lib/ui-copy'

interface Session {
  id: string
  title: string | null
  updatedAt: number
}

interface Props {
  sessions: Session[]
  currentId: string | null
  onSelect: (id: string) => void
  onClearAll: () => void
  locale: UiLocale
}

export function SessionsList({ sessions, currentId, onSelect, onClearAll, locale }: Props) {
  const copy = getObserverUiCopy(locale)
  return (
    <aside className="observer-sessions">
      <div className="observer-panel-head">
        <span className="observer-eyebrow">Observer</span>
        <strong>{copy.sessions}</strong>
      </div>
      <div className="observer-session-list">
        {sessions.map((s) => {
          const active = s.id === currentId
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`observer-session-item${active ? ' observer-session-item-active' : ''}`}
              title={s.title || copy.untitled}
            >
              {s.title || copy.untitled}
            </button>
          )
        })}
      </div>
      <div className="observer-danger-zone">
        <button
          onClick={() => {
            if (confirm(copy.clearAllDataConfirm)) onClearAll()
          }}
          className="observer-clear-button"
        >
          {copy.clearAllData}
        </button>
      </div>
    </aside>
  )
}
