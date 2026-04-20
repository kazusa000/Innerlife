'use client'

interface Props {
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

export function Sidebar({ agentName, onBack }: Props) {
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

      <div className="rail-copy">
        <p className="rail-label">Single thread</p>
        <h2 className="rail-title">One ongoing conversation</h2>
        <p className="rail-sub">
          你和这个 persona 只有一条对话线。底层 session 仍然存在，但只用于内部章节和状态边界，不再作为前端可操作对象。
        </p>
      </div>

      <div className="rail-note">
        <span className="rail-note-title">Current behavior</span>
        <p className="rail-note-body">
          进入聊天时会自动解析当前 active session。网页端不再提供新建、切换或删除 session。
        </p>
      </div>

      <style jsx>{`
        .sidebar {
          width: 272px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 18px;
          border-right: 1px solid var(--border-subtle);
          background:
            radial-gradient(circle at top, rgba(255, 255, 255, 0.08), transparent 45%),
            rgba(255, 255, 255, 0.015);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          padding-bottom: 18px;
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
        .rail-copy {
          margin: 0 14px;
          padding: 18px 16px;
          border-radius: calc(var(--radius) + 6px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02)),
            rgba(12, 16, 24, 0.48);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        .rail-label {
          margin: 0 0 8px;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--fg-subtle);
        }
        .rail-title {
          margin: 0;
          font-family: var(--font-display);
          font-size: 24px;
          line-height: 1.05;
          color: var(--fg);
          letter-spacing: -0.03em;
        }
        .rail-sub {
          margin: 14px 0 0;
          color: var(--fg-muted);
          line-height: 1.6;
          font-size: 13px;
        }
        .rail-note {
          margin: 0 14px;
          padding: 14px 16px;
          border-radius: var(--radius);
          border: 1px solid var(--border-subtle);
          background: rgba(255, 255, 255, 0.03);
        }
        .rail-note-title {
          display: block;
          margin-bottom: 8px;
          color: var(--fg);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .rail-note-body {
          margin: 0;
          color: var(--fg-muted);
          font-size: 12px;
          line-height: 1.55;
        }
      `}</style>
    </aside>
  )
}
