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
  onNew: () => void
  onDelete: (id: string) => void
}

export function Sidebar({ sessions, currentId, onSelect, onNew, onDelete }: Props) {
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
      <div style={{ padding: 12, borderBottom: '1px solid #222' }}>
        <button
          onClick={onNew}
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid #333',
            background: '#1a1a2e',
            color: '#ededed',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          + New Chat
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {sessions.length === 0 && (
          <p style={{ color: '#666', fontSize: 13, textAlign: 'center', marginTop: 24 }}>
            No chats yet
          </p>
        )}
        {sessions.map((s) => {
          const active = s.id === currentId
          return (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 10px',
                borderRadius: 6,
                marginBottom: 2,
                background: active ? '#1a1a2e' : 'transparent',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: active ? '#ededed' : '#bbb',
                }}
              >
                {s.title || 'Untitled'}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm('Delete this chat?')) onDelete(s.id)
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#666',
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: '0 4px',
                }}
                aria-label="Delete chat"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
