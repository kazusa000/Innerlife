'use client'

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
        <strong style={{ color: '#ededed', fontSize: 14 }}>Sessions</strong>
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
              {s.title || 'Untitled'}
            </div>
          )
        })}
      </div>
      <div style={{ padding: 10, borderTop: '1px solid #222' }}>
        <button
          onClick={() => {
            if (confirm('Delete ALL observer data? This cannot be undone.')) onClearAll()
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
          🗑 Clear all observer data
        </button>
      </div>
    </div>
  )
}
