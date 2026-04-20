'use client'

import Link from 'next/link'
import { useEffect, useState, type ComponentType } from 'react'
import PersonalityManagerBigFive from './PersonalityManager.big-five'

interface AgentPersonalityMeta {
  agentId: string
  scheme: string | null
  supportedSchemes: string[]
  configured: boolean
}

interface PersonalityManagerProps {
  agentId: string
  meta: AgentPersonalityMeta
}

const personalityManagersByScheme = {
  'big-five': PersonalityManagerBigFive,
} satisfies Record<string, ComponentType<PersonalityManagerProps>>

export default function PersonalityManagerShell({ agentId }: { agentId: string }) {
  const [meta, setMeta] = useState<AgentPersonalityMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadMeta() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/agents/${agentId}/personality`, {
          cache: 'no-store',
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(
            typeof data?.error === 'string'
              ? data.error
              : 'Failed to load personality manager',
          )
        }

        if (!cancelled) {
          setMeta(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load personality manager',
          )
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
    ? personalityManagersByScheme[meta.scheme as keyof typeof personalityManagersByScheme]
    : null

  return (
    <main className="personality-page">
      <div className="personality-wrap">
        <header className="personality-head">
          <div>
            <p className="personality-eyebrow">Unified entry</p>
            <h1 className="personality-title">Personality Manager</h1>
            <p className="personality-sub">
              固定入口 `/agent/{agentId}/personality`。当前页面只根据
              `personality.scheme` 分发到对应子系统。
            </p>
          </div>
          <div className="personality-actions">
            <Link href="/" className="personality-link">
              Back to personas
            </Link>
            <Link href={`/chat?agent=${agentId}`} className="personality-link personality-link-primary">
              Open chat
            </Link>
          </div>
        </header>

        <section className="personality-card">
          <div className="personality-card-head">
            <div>
              <p className="personality-label">Agent</p>
              <h2 className="personality-card-title">{agentId}</h2>
            </div>
            {meta && (
              <span className="personality-pill">
                {meta.scheme ?? 'unconfigured'}
              </span>
            )}
          </div>

          {loading && <p className="personality-copy">正在加载性格管理入口…</p>}

          {!loading && error && (
            <div className="personality-state">
              <h3>入口加载失败</h3>
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && meta && !meta.configured && (
            <div className="personality-state">
              <h3>性格模块尚未开启</h3>
              <p>
                这个 agent 还没有启用 personality manager。当前固定入口已经就绪，但如果你想使用
                `big-five`，先回到首页的 persona 编辑区启用 personality scheme。
              </p>
            </div>
          )}

          {!loading && !error && meta?.configured && Manager && (
            <div className="personality-manager-slot">
              <Manager agentId={agentId} meta={meta} />
            </div>
          )}

          {!loading && !error && meta?.configured && !Manager && (
            <div className="personality-state">
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
        .personality-page {
          min-height: 100vh;
          padding: 56px 24px 88px;
        }
        .personality-wrap {
          max-width: 1100px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .personality-head {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-end;
          flex-wrap: wrap;
        }
        .personality-eyebrow {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--fg-subtle);
          margin-bottom: 10px;
        }
        .personality-title {
          font-family: var(--font-display);
          font-size: clamp(34px, 5vw, 56px);
          line-height: 1;
          letter-spacing: -0.03em;
          font-weight: 400;
          font-variation-settings: 'SOFT' 80, 'opsz' 60;
        }
        .personality-sub {
          margin-top: 10px;
          max-width: 60ch;
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .personality-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .personality-link {
          text-decoration: none;
          border-radius: 999px;
          padding: 10px 14px;
          border: 1px solid var(--border);
          color: var(--fg);
          background: rgba(255, 255, 255, 0.04);
        }
        .personality-link-primary {
          border-color: rgba(56, 189, 248, 0.36);
          background: rgba(56, 189, 248, 0.14);
        }
        .personality-card {
          border-radius: 28px;
          border: 1px solid rgba(56, 189, 248, 0.22);
          background:
            linear-gradient(135deg, rgba(56, 189, 248, 0.09), rgba(255, 255, 255, 0.03)),
            rgba(12, 16, 28, 0.84);
          backdrop-filter: blur(18px);
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 18px;
          box-shadow: var(--shadow);
        }
        .personality-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .personality-label {
          color: var(--fg-subtle);
          font-size: 12px;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .personality-card-title {
          font-size: 22px;
          font-weight: 500;
        }
        .personality-pill {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #d7f4ff;
          border: 1px solid rgba(56, 189, 248, 0.24);
          border-radius: 999px;
          padding: 7px 10px;
          background: rgba(56, 189, 248, 0.14);
        }
        .personality-copy {
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .personality-state {
          border: 1px dashed var(--border);
          border-radius: 20px;
          padding: 18px;
          background: rgba(255, 255, 255, 0.03);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .personality-state h3 {
          font-size: 18px;
          font-weight: 500;
        }
        .personality-state p {
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .personality-manager-slot {
          display: flex;
        }
        @media (max-width: 720px) {
          .personality-page {
            padding: 24px 16px 64px;
          }
          .personality-card {
            padding: 18px;
          }
        }
      `}</style>
    </main>
  )
}
