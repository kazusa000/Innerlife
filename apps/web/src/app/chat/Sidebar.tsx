'use client'

import React from 'react'
import { useEffect, useState } from 'react'
import {
  getContextResetButtonLabel,
  getContextResetLoadingLabel,
  type ContextResetMode,
  type ContextResetNotice,
} from './context-reset'

interface Props {
  agentId?: string
  sessionId?: string | null
  memoryScheme?: string | null
  relationshipScheme?: string | null
  agentName?: string
  onBack?: () => void
  onResetContext?: (mode: ContextResetMode) => void
  isResetting?: boolean
  resettingMode?: ContextResetMode | null
  resetNotice?: ContextResetNotice | null
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

type Counterpart = {
  id: string
  name: string
}

export function Sidebar({
  agentId,
  sessionId,
  memoryScheme,
  relationshipScheme,
  agentName,
  onBack,
  onResetContext,
  isResetting = false,
  resettingMode = null,
  resetNotice = null,
}: Props) {
  const [counterparts, setCounterparts] = useState<Counterpart[]>([])
  const [selectedCounterpartId, setSelectedCounterpartId] = useState('')
  const [bindingNotice, setBindingNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadBindingState() {
      setCounterparts([])
      setSelectedCounterpartId('')
      setBindingNotice(null)

      if (!agentId || !sessionId || relationshipScheme !== 'named-multi-dim') {
        return
      }

      try {
        const [configRes, bindingRes] = await Promise.all([
          fetch(`/api/agents/${agentId}/relationships/named-multi-dim`, { cache: 'no-store' }),
          fetch(`/api/sessions/${sessionId}/relationship-counterpart`, { cache: 'no-store' }),
        ])

        if (cancelled) return

        const configData = await configRes.json().catch(() => null) as { counterparts?: Counterpart[] } | null
        const bindingData = await bindingRes.json().catch(() => null) as { counterpart?: Counterpart | null } | null

        if (Array.isArray(configData?.counterparts)) {
          setCounterparts(configData.counterparts)
        }
        if (bindingData?.counterpart?.id) {
          setSelectedCounterpartId(bindingData.counterpart.id)
        }
      } catch {
        if (!cancelled) {
          setBindingNotice('关系对象加载失败')
        }
      }
    }

    void loadBindingState()
    return () => {
      cancelled = true
    }
  }, [agentId, sessionId, relationshipScheme])

  async function handleCounterpartChange(nextId: string) {
    if (!sessionId) {
      return
    }

    setBindingNotice(null)

    try {
      const response = await fetch(`/api/sessions/${sessionId}/relationship-counterpart`, {
        method: nextId ? 'PUT' : 'DELETE',
        headers: nextId ? { 'Content-Type': 'application/json' } : undefined,
        body: nextId ? JSON.stringify({ counterpartId: nextId }) : undefined,
      })
      if (!response.ok) {
        throw new Error('保存关系对象失败')
      }
      setSelectedCounterpartId(nextId)
      setBindingNotice(nextId ? '当前 session 已绑定关系对象' : '当前 session 已解绑关系对象')
    } catch {
      setBindingNotice('保存关系对象失败')
    }
  }

  return (
    <aside className="sidebar">
      {agentName && (
        <div className="agent-head">
          {onBack && (
            <button
              onClick={onBack}
              className="back-btn"
              aria-label="返回虚拟人列表"
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
            <span className="agent-eyebrow">当前对话对象</span>
            <span className="agent-name">{agentName}</span>
          </div>
        </div>
      )}

      <div className="rail-copy">
        <p className="rail-label">单线对话</p>
        <h2 className="rail-title">一条持续进行中的对话</h2>
        <p className="rail-sub">
          你和这个虚拟人只有一条对话线。底层 session 仍然存在，但只用于内部章节和状态边界，不再作为前端可操作对象。
        </p>
      </div>

      <div className="rail-note">
        <span className="rail-note-title">当前行为</span>
        <p className="rail-note-body">
          进入聊天时会自动解析当前 active session。网页端不再提供新建、切换或删除 session。
        </p>
        {onResetContext && (
          <div className="context-reset-actions">
            <button
              type="button"
              className="context-reset-btn"
              onClick={() => onResetContext('clear')}
              disabled={isResetting}
            >
              {isResetting && resettingMode === 'clear'
                ? getContextResetLoadingLabel('clear', memoryScheme)
                : getContextResetButtonLabel('clear', memoryScheme)}
            </button>
            {memoryScheme === 'sqlite' && (
              <button
                type="button"
                className="context-reset-btn context-reset-btn-secondary"
                onClick={() => onResetContext('flush')}
                disabled={isResetting}
              >
                {isResetting && resettingMode === 'flush'
                  ? getContextResetLoadingLabel('flush', memoryScheme)
                  : getContextResetButtonLabel('flush', memoryScheme)}
              </button>
            )}
          </div>
        )}
        {resetNotice && (
          <p className={`rail-status ${resetNotice.tone === 'error' ? 'rail-status-error' : 'rail-status-success'}`}>
            {resetNotice.text}
          </p>
        )}
      </div>

      {relationshipScheme === 'named-multi-dim' && (
        <div className="rail-note">
          <span className="rail-note-title">当前关系对象</span>
          <p className="rail-note-body">
            这个 session 只绑定一个手动命名对象。未绑定时，关系系统在当前聊天中不生效。
          </p>
          <select
            className="counterpart-select"
            value={selectedCounterpartId}
            onChange={(event) => {
              void handleCounterpartChange(event.target.value)
            }}
          >
            <option value="">未绑定对象</option>
            {counterparts.map((counterpart) => (
              <option key={counterpart.id} value={counterpart.id}>
                {counterpart.name}
              </option>
            ))}
          </select>
          {bindingNotice && <p className="rail-status">{bindingNotice}</p>}
        </div>
      )}

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
          overflow-y: auto;
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
        .context-reset-btn {
          width: 100%;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.06);
          color: var(--fg);
          border-radius: 12px;
          padding: 11px 12px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition:
            background var(--dur) var(--ease),
            border-color var(--dur) var(--ease),
            opacity var(--dur) var(--ease);
        }
        .context-reset-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 14px;
        }
        .context-reset-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.18);
        }
        .context-reset-btn-secondary {
          background: rgba(46, 204, 113, 0.12);
          border-color: rgba(46, 204, 113, 0.22);
        }
        .context-reset-btn-secondary:hover:not(:disabled) {
          background: rgba(46, 204, 113, 0.18);
          border-color: rgba(46, 204, 113, 0.32);
        }
        .context-reset-btn:disabled {
          opacity: 0.6;
          cursor: wait;
        }
        .counterpart-select {
          width: 100%;
          margin-top: 14px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.06);
          color: var(--fg);
          padding: 10px 12px;
          font-size: 13px;
        }
        .rail-status {
          margin: 10px 0 0;
          color: var(--fg-muted);
          font-size: 12px;
          line-height: 1.5;
        }
        .rail-status-success {
          color: rgba(186, 230, 201, 0.92);
        }
        .rail-status-error {
          color: rgba(255, 191, 191, 0.96);
        }
      `}</style>
    </aside>
  )
}
