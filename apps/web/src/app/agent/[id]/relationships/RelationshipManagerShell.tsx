'use client'

import Link from 'next/link'
import { useEffect, useState, type ComponentType } from 'react'
import { getCommonUiCopy } from '@/lib/ui-copy'
import { useAppLocale } from '@/app/use-app-locale'
import RelationshipManagerMultiDim from './RelationshipManager.multi-dim'
import RelationshipManagerNamedMultiDim from './RelationshipManager.named-multi-dim'

interface AgentRelationshipMeta {
  agentId: string
  scheme: string | null
  supportedSchemes: string[]
  configured: boolean
}

interface RelationshipManagerProps {
  agentId: string
  meta: AgentRelationshipMeta
}

const relationshipManagersByScheme = {
  'multi-dim': RelationshipManagerMultiDim,
  'named-multi-dim': RelationshipManagerNamedMultiDim,
} satisfies Record<string, ComponentType<RelationshipManagerProps>>

export default function RelationshipManagerShell({ agentId }: { agentId: string }) {
  const locale = useAppLocale()
  const commonCopy = getCommonUiCopy(locale)
  const [meta, setMeta] = useState<AgentRelationshipMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadMeta() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/agents/${agentId}/relationships`, {
          cache: 'no-store',
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(
            typeof data?.error === 'string'
              ? data.error
              : locale === 'en-US' ? 'Failed to load relationship manager' : '加载关系管理入口失败',
          )
        }

        if (!cancelled) {
          setMeta(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : locale === 'en-US' ? 'Failed to load relationship manager' : '加载关系管理入口失败',
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
  }, [agentId, locale])

  const Manager = meta?.scheme
    ? relationshipManagersByScheme[meta.scheme as keyof typeof relationshipManagersByScheme]
    : null

  return (
    <main className="relationship-page">
      <div className="relationship-wrap">
        <header className="relationship-head">
          <div>
            <p className="relationship-eyebrow">{commonCopy.unifiedEntry}</p>
            <h1 className="relationship-title">{locale === 'en-US' ? 'Relationship Management' : '关系管理'}</h1>
            <p className="relationship-sub">
              {locale === 'en-US'
                ? 'Stable entry `/agent/{agentId}/relationships`. This page dispatches to the matching subsystem based on `relationship.scheme`.'
                : '固定入口 `/agent/{agentId}/relationships`。当前页面只根据 `relationship.scheme` 分发到对应子系统。'}
            </p>
          </div>
          <div className="relationship-actions">
            <Link href="/" className="relationship-link">
              {commonCopy.backToPersonas}
            </Link>
            <Link href={`/chat?agent=${agentId}`} className="relationship-link relationship-link-primary">
              {commonCopy.openChat}
            </Link>
          </div>
        </header>

        <section className="relationship-card">
          <div className="relationship-card-head">
            <div>
              <p className="relationship-label">{commonCopy.agent}</p>
              <h2 className="relationship-card-title">{agentId}</h2>
            </div>
            {meta && (
              <span className="relationship-pill">{meta.scheme ?? commonCopy.unconfigured}</span>
            )}
          </div>

          {loading && <p className="relationship-copy">{locale === 'en-US' ? 'Loading relationship manager...' : '正在加载关系管理入口…'}</p>}

          {!loading && error && (
            <div className="relationship-state">
              <h3>{locale === 'en-US' ? 'Failed to Load Entry' : '入口加载失败'}</h3>
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && meta && !meta.configured && (
            <div className="relationship-state">
              <h3>{locale === 'en-US' ? 'Relationship Module Is Not Enabled' : '关系模块尚未开启'}</h3>
              <p>
                {locale === 'en-US'
                  ? 'This persona has not enabled relationship management. Go back to the home page and enable a relationship scheme first.'
                  : '这个虚拟人还没有启用关系管理。当前固定入口已经就绪，但如果你想使用 `multi-dim`，先回到首页的虚拟人编辑区启用关系方案。'}
              </p>
            </div>
          )}

          {!loading && !error && meta?.configured && Manager && (
            <div className="relationship-manager-slot">
              <Manager agentId={agentId} meta={meta} />
            </div>
          )}

          {!loading && !error && meta?.configured && !Manager && (
            <div className="relationship-state">
              <h3>{locale === 'en-US' ? 'Manager Not Implemented for This Scheme' : '该方案的管理器尚未实现'}</h3>
              <p>
                {locale === 'en-US'
                  ? <>Current scheme is <code>{meta.scheme}</code>. The entry route is stable, but the matching management UI is not connected yet.</>
                  : <>当前方案是 <code>{meta.scheme}</code>。入口路由已经稳定保留，但对应的管理界面还没接入。</>}
              </p>
            </div>
          )}
        </section>
      </div>

      <style jsx>{`
        .relationship-page {
          min-height: 100vh;
          padding: 56px 24px 88px;
        }
        .relationship-wrap {
          max-width: 1100px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .relationship-head {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-end;
          flex-wrap: wrap;
        }
        .relationship-eyebrow {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--fg-subtle);
          margin-bottom: 10px;
        }
        .relationship-title {
          font-family: var(--font-display);
          font-size: clamp(34px, 5vw, 56px);
          line-height: 1;
          letter-spacing: -0.03em;
          font-weight: 400;
          font-variation-settings: 'SOFT' 80, 'opsz' 60;
        }
        .relationship-sub {
          margin-top: 10px;
          max-width: 60ch;
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .relationship-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .relationship-link {
          text-decoration: none;
          border-radius: 999px;
          padding: 10px 14px;
          border: 1px solid var(--border);
          color: var(--fg);
          background: rgba(255, 255, 255, 0.04);
        }
        .relationship-link-primary {
          border-color: rgba(34, 197, 94, 0.34);
          background: rgba(34, 197, 94, 0.14);
        }
        .relationship-card {
          border-radius: 28px;
          border: 1px solid rgba(34, 197, 94, 0.22);
          background:
            linear-gradient(135deg, rgba(34, 197, 94, 0.08), rgba(255, 255, 255, 0.03)),
            rgba(12, 16, 28, 0.84);
          backdrop-filter: blur(18px);
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 18px;
          box-shadow: var(--shadow);
        }
        .relationship-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .relationship-label {
          color: var(--fg-subtle);
          font-size: 12px;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .relationship-card-title {
          font-size: 22px;
          font-weight: 500;
        }
        .relationship-pill {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #d6ffe4;
          border: 1px solid rgba(34, 197, 94, 0.24);
          border-radius: 999px;
          padding: 7px 10px;
          background: rgba(34, 197, 94, 0.14);
        }
        .relationship-copy {
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .relationship-state {
          border: 1px dashed var(--border);
          border-radius: 20px;
          padding: 18px;
          background: rgba(255, 255, 255, 0.03);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .relationship-state h3 {
          font-size: 18px;
          font-weight: 500;
        }
        .relationship-state p {
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .relationship-manager-slot {
          display: flex;
        }
        @media (max-width: 720px) {
          .relationship-page {
            padding: 24px 16px 64px;
          }
          .relationship-card {
            padding: 18px;
          }
        }
      `}</style>
    </main>
  )
}
