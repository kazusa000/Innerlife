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
    <div
      style={{
        width: 260,
        borderRight: '1px solid #222',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #222' }}>
        <strong style={{ color: '#ededed', fontSize: 14 }}>{OBSERVER_UI_COPY.sessions}</strong>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {sessions.map((s) => {
          const active = s.id === currentId
          return (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                marginBottom: 2,
                background: active ? '#1a1a2e' : 'transparent',
                cursor: 'pointer',
                color: active ? '#ededed' : '#bbb',
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {s.title || OBSERVER_UI_COPY.untitled}
            </div>
          )
        })}
      </div>
      <div style={{ padding: 10, borderTop: '1px solid #222' }}>
        <button
          onClick={() => {
            if (confirm(OBSERVER_UI_COPY.clearAllDataConfirm)) onClearAll()
          }}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid #5a2d2d',
            background: '#2d1a1a',
            color: '#f85149',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          🗑 {OBSERVER_UI_COPY.clearAllData}
        </button>
      </div>
    </div>
  )
}
