'use client'

import Link from 'next/link'
import { useEffect, useState, type ComponentType } from 'react'
import MemoryManagerSqlite from './MemoryManager.sqlite'

interface AgentMemoryMeta {
  agentId: string
  scheme: string | null
  supportedSchemes: string[]
  configured: boolean
}

interface MemoryManagerProps {
  agentId: string
  meta: AgentMemoryMeta
}

const memoryManagersByScheme = {
  sqlite: MemoryManagerSqlite,
} satisfies Record<string, ComponentType<MemoryManagerProps>>

export default function MemoryManagerShell({ agentId }: { agentId: string }) {
  const [meta, setMeta] = useState<AgentMemoryMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadMeta() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/agents/${agentId}/memory`, {
          cache: 'no-store',
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to load memory manager')
        }

        if (!cancelled) {
          setMeta(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load memory manager')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadMeta()

    return () => {
      cancelled = true
    }
  }, [agentId])

  const Manager = meta?.scheme
    ? memoryManagersByScheme[meta.scheme as keyof typeof memoryManagersByScheme]
    : null

  return (
    <main className="memory-page">
      <div className="memory-wrap">
        <header className="memory-head">
          <div>
            <p className="memory-eyebrow">Unified entry</p>
            <h1 className="memory-title">Memory Manager</h1>
            <p className="memory-sub">
              固定入口 `/agent/{agentId}/memory`。当前页面只根据 `memory.scheme` 分发到对应子系统。
            </p>
          </div>
          <div className="memory-actions">
            <Link href="/" className="memory-link">
              Back to personas
            </Link>
            <Link href={`/chat?agent=${agentId}`} className="memory-link memory-link-primary">
              Open chat
            </Link>
          </div>
        </header>

        <section className="memory-card">
          <div className="memory-card-head">
            <div>
              <p className="memory-label">Agent</p>
              <h2 className="memory-card-title">{agentId}</h2>
            </div>
            {meta && (
              <span className="memory-pill">
                {meta.scheme ?? 'unconfigured'}
              </span>
            )}
          </div>

          {loading && <p className="memory-copy">正在加载记忆管理入口…</p>}

          {!loading && error && (
            <div className="memory-state">
              <h3>入口加载失败</h3>
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && meta && !meta.configured && (
            <div className="memory-state">
              <h3>记忆模块尚未开启</h3>
              <p>
                这个 agent 还没有启用 memory manager。回到首页编辑 persona，把 `Memory scheme`
                切到 `sqlite` 后再进入这里。
              </p>
            </div>
          )}

          {!loading && !error && meta?.configured && Manager && (
            <div className="memory-manager-slot">
              <Manager agentId={agentId} meta={meta} />
            </div>
          )}

          {!loading && !error && meta?.configured && !Manager && (
            <div className="memory-state">
              <h3>该 scheme 的管理器尚未实现</h3>
              <p>
                当前 scheme 是 <code>{meta.scheme}</code>。入口路由已经稳定保留，但对应的管理 UI
                还没接入。
              </p>
            </div>
          )}
        </section>
      </div>

      <style jsx>{`
        .memory-page {
          min-height: 100vh;
          padding: 56px 24px 88px;
        }
        .memory-wrap {
          max-width: 1100px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .memory-head {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-end;
          flex-wrap: wrap;
        }
        .memory-eyebrow {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--fg-subtle);
          margin-bottom: 10px;
        }
        .memory-title {
          font-family: var(--font-display);
          font-size: clamp(34px, 5vw, 56px);
          line-height: 1;
          letter-spacing: -0.03em;
          font-weight: 400;
          font-variation-settings: 'SOFT' 80, 'opsz' 60;
        }
        .memory-sub {
          margin-top: 10px;
          max-width: 60ch;
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .memory-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .memory-link {
          text-decoration: none;
          border-radius: 999px;
          padding: 10px 14px;
          border: 1px solid var(--border);
          color: var(--fg);
          background: rgba(255, 255, 255, 0.04);
        }
        .memory-link-primary {
          border-color: rgba(129, 140, 248, 0.36);
          background: rgba(129, 140, 248, 0.18);
        }
        .memory-card {
          border-radius: 28px;
          border: 1px solid rgba(129, 140, 248, 0.22);
          background:
            linear-gradient(135deg, rgba(129, 140, 248, 0.08), rgba(255, 255, 255, 0.03)),
            rgba(12, 16, 28, 0.84);
          backdrop-filter: blur(18px);
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 18px;
          box-shadow: var(--shadow);
        }
        .memory-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .memory-label {
          color: var(--fg-subtle);
          font-size: 12px;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .memory-card-title {
          font-size: 22px;
          font-weight: 500;
        }
        .memory-pill {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #d9ddff;
          border: 1px solid rgba(129, 140, 248, 0.28);
          border-radius: 999px;
          padding: 7px 10px;
          background: rgba(129, 140, 248, 0.14);
        }
        .memory-copy {
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .memory-state {
          border: 1px dashed var(--border);
          border-radius: 20px;
          padding: 18px;
          background: rgba(255, 255, 255, 0.03);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .memory-state h3 {
          font-size: 18px;
          font-weight: 500;
        }
        .memory-state p {
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .memory-manager-slot {
          display: flex;
          flex-direction: column;
        }
      `}</style>
    </main>
  )
}
