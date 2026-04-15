'use client'

export interface TurnNode {
  userMessageId: string
  userText: string
  createdAt: number
  calls: Array<{
    id: string
    turnIndex: number
    stopReason: string | null
    startedAt: number
    finishedAt: number | null
  }>
}

interface Props {
  turns: TurnNode[]
  currentCallId: string | null
  onSelectCall: (id: string) => void
}

export function TurnTree({ turns, currentCallId, onSelectCall }: Props) {
  return (
    <div
      style={{
        width: 320,
        borderRight: '1px solid #222',
        overflowY: 'auto',
        padding: 8,
        flexShrink: 0,
      }}
    >
      {turns.length === 0 && (
        <p style={{ color: '#666', textAlign: 'center', marginTop: 40, fontSize: 13 }}>
          No observer data for this session.
        </p>
      )}
      {turns.map((turn) => (
        <div key={turn.userMessageId} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 12,
              color: '#888',
              padding: '4px 8px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={turn.userText}
          >
            User: {turn.userText || '(empty)'}
          </div>
          {turn.calls.map((c) => {
            const active = c.id === currentCallId
            return (
              <div
                key={c.id}
                onClick={() => onSelectCall(c.id)}
                style={{
                  padding: '6px 10px 6px 20px',
                  borderRadius: 4,
                  marginTop: 2,
                  background: active ? '#1a1a2e' : 'transparent',
                  color: active ? '#ededed' : '#bbb',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                └ call #{c.turnIndex}{' '}
                <span style={{ color: '#666' }}>
                  {c.stopReason ?? (c.finishedAt ? '?' : '…')}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
