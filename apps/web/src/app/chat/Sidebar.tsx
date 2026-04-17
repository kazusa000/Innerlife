'use client'

interface Session {
  id: string
  title: string | null
  updatedAt: number | string
}

interface Props {
  sessions: Session[]
  currentId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  agentName?: string
  onBack?: () => void
}

function gradientFor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const a = h % 360
  const b = (a + 40 + (h % 80)) % 360
  return `linear-gradient(135deg, hsl(${a} 70% 58%) 0%, hsl(${b} 75% 52%) 100%)`
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return s.toUpperCase()
}

function timeAgo(ts: number | string) {
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return `${Math.floor(d / 7)}w`
}

export function Sidebar({
  sessions,
  currentId,
  onSelect,
  onNew,
  onDelete,
  agentName,
  onBack,
}: Props) {
  return (
    <aside className="sidebar">
      {agentName && (
        <div className="agent-head">
          {onBack && (
            <button
              onClick={onBack}
              className="back-btn"
              aria-label="Back to personas"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M10 3L5 8l5 5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <div
            className="agent-avatar"
            style={{ backgroundImage: gradientFor(agentName) }}
          >
            {initials(agentName)}
          </div>
          <div className="agent-meta">
            <span className="agent-eyebrow">Chatting with</span>
            <span className="agent-name">{agentName}</span>
          </div>
        </div>
      )}

      <div className="new-wrap">
        <button onClick={onNew} className="new-btn">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="M7 2v10M2 7h10"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          New chat
        </button>
      </div>

      <div className="list">
        {sessions.length === 0 && (
          <div className="empty">
            <p className="empty-title">No chats yet</p>
            <p className="empty-sub">Your conversations will live here.</p>
          </div>
        )}
        {sessions.map((s) => {
          const active = s.id === currentId
          return (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`item ${active ? 'active' : ''}`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(s.id)
              }}
            >
              <div className="item-body">
                <span className="item-title">{s.title || 'New chat'}</span>
                <span className="item-time">{timeAgo(s.updatedAt)}</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm('Delete this chat?')) onDelete(s.id)
                }}
                className="del-btn"
                aria-label="Delete chat"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          )
        })}
      </div>

      <style jsx>{`
        .sidebar {
          width: 272px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border-subtle);
          background: rgba(255, 255, 255, 0.015);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .agent-head {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 16px 14px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .back-btn {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          border-radius: 8px;
          background: transparent;
          border: 1px solid transparent;
          color: var(--fg-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition:
            background var(--dur) var(--ease),
            border-color var(--dur) var(--ease),
            color var(--dur) var(--ease);
        }
        .back-btn:hover {
          background: var(--bg-glass);
          border-color: var(--border);
          color: var(--fg);
        }
        .agent-avatar {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-display);
          font-size: 13px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.95);
          flex-shrink: 0;
          letter-spacing: -0.01em;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.2),
            0 4px 12px -4px rgba(0, 0, 0, 0.5);
        }
        .agent-meta {
          display: flex;
          flex-direction: column;
          min-width: 0;
          gap: 1px;
        }
        .agent-eyebrow {
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--fg-subtle);
        }
        .agent-name {
          font-family: var(--font-display);
          font-size: 15px;
          font-weight: 500;
          color: var(--fg);
          font-variation-settings: 'SOFT' 80, 'opsz' 18;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .new-wrap {
          padding: 12px;
        }
        .new-btn {
          width: 100%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: var(--radius);
          border: 1px dashed var(--border);
          background: transparent;
          color: var(--fg-muted);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition:
            background var(--dur) var(--ease),
            border-color var(--dur) var(--ease),
            color var(--dur) var(--ease);
        }
        .new-btn:hover {
          background: var(--indigo-soft);
          border-color: var(--indigo);
          color: var(--fg);
        }

        .list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .empty {
          padding: 32px 16px;
          text-align: center;
        }
        .empty-title {
          font-size: 13px;
          color: var(--fg-muted);
          font-weight: 500;
          margin-bottom: 4px;
        }
        .empty-sub {
          font-size: 11.5px;
          color: var(--fg-subtle);
          line-height: 1.5;
        }

        .item {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 12px;
          border-radius: 12px;
          cursor: pointer;
          transition:
            background var(--dur) var(--ease),
            color var(--dur) var(--ease);
          position: relative;
        }
        .item:hover {
          background: var(--bg-glass);
        }
        .item.active {
          background: var(--indigo-soft);
        }
        .item.active::before {
          content: '';
          position: absolute;
          left: 4px;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 16px;
          background: var(--indigo);
          border-radius: 999px;
        }
        .item-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding-left: 4px;
        }
        .item-title {
          font-size: 13px;
          color: var(--fg-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .item.active .item-title {
          color: var(--fg);
          font-weight: 500;
        }
        .item-time {
          font-size: 11px;
          color: var(--fg-subtle);
          font-variant-numeric: tabular-nums;
        }
        .del-btn {
          flex-shrink: 0;
          width: 24px;
          height: 24px;
          border-radius: 8px;
          background: transparent;
          border: none;
          color: var(--fg-subtle);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition:
            opacity var(--dur) var(--ease),
            background var(--dur) var(--ease),
            color var(--dur) var(--ease);
        }
        .item:hover .del-btn,
        .item.active .del-btn {
          opacity: 1;
        }
        .del-btn:hover {
          background: rgba(248, 113, 113, 0.12);
          color: var(--danger);
        }
      `}</style>
    </aside>
  )
}
