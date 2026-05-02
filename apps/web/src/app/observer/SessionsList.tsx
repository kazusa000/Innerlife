'use client'

import { OBSERVER_UI_COPY } from '../../lib/ui-copy'

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
}

export function SessionsList({ sessions, currentId, onSelect, onClearAll }: Props) {
  return (
    <aside className="observer-sessions">
      <div className="observer-panel-head">
        <span className="observer-eyebrow">Observer</span>
        <strong>{OBSERVER_UI_COPY.sessions}</strong>
      </div>
      <div className="observer-session-list">
        {sessions.map((s) => {
          const active = s.id === currentId
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`observer-session-item${active ? ' observer-session-item-active' : ''}`}
              title={s.title || OBSERVER_UI_COPY.untitled}
            >
              {s.title || OBSERVER_UI_COPY.untitled}
            </button>
          )
        })}
      </div>
      <div className="observer-danger-zone">
        <button
          onClick={() => {
            if (confirm(OBSERVER_UI_COPY.clearAllDataConfirm)) onClearAll()
          }}
          className="observer-clear-button"
        >
          {OBSERVER_UI_COPY.clearAllData}
        </button>
      </div>
    </aside>
  )
}
