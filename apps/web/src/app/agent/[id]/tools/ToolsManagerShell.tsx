'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getCommonUiCopy } from '@/lib/ui-copy'
import { useAppLocale } from '@/app/use-app-locale'
import ToolsManager, { type ToolManagerItem } from './ToolsManager'

interface ToolsRoutePayload {
  agentId: string
  tools: ToolManagerItem[]
}

export default function ToolsManagerShell({ agentId }: { agentId: string }) {
  const locale = useAppLocale()
  const commonCopy = getCommonUiCopy(locale)
  const [payload, setPayload] = useState<ToolsRoutePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadTools() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/agents/${agentId}/tools`, {
          cache: 'no-store',
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : locale === 'en-US' ? 'Failed to load tools manager' : '加载工具管理入口失败')
        }

        if (!cancelled) {
          setPayload(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : locale === 'en-US' ? 'Failed to load tools manager' : '加载工具管理入口失败')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadTools()

    return () => {
      cancelled = true
    }
  }, [agentId, locale])

  return (
    <main className="tools-page">
      <div className="tools-wrap">
        <header className="tools-head">
          <div>
            <p className="tools-eyebrow">{commonCopy.unifiedEntry}</p>
            <h1 className="tools-title">{locale === 'en-US' ? 'Tool Management' : '工具管理'}</h1>
            <p className="tools-sub">
              {locale === 'en-US'
                ? 'Stable entry `/agent/{agentId}/tools`. Manage tool toggles, localized tool descriptions, and current availability requirements for this persona.'
                : '固定入口 `/agent/{agentId}/tools`。在这里管理该 persona 的工具开关、本地化提示词和当前可生效条件。'}
            </p>
          </div>
          <div className="tools-actions">
            <Link href="/" className="tools-link">
              {commonCopy.backToPersonas}
            </Link>
            <Link href={`/chat?agent=${agentId}`} className="tools-link tools-link-primary">
              {commonCopy.openChat}
            </Link>
          </div>
        </header>

        <section className="tools-card">
          <div className="tools-card-head">
            <div>
              <p className="tools-label">{commonCopy.agent}</p>
              <h2 className="tools-card-title">{agentId}</h2>
            </div>
            {payload && (
              <span className="tools-pill">
                {payload.tools.length} tools
              </span>
            )}
          </div>

          {loading && <p className="tools-copy">{locale === 'en-US' ? 'Loading tools manager...' : '正在加载工具管理入口…'}</p>}

          {!loading && error && (
            <div className="tools-state">
              <h3>{locale === 'en-US' ? 'Failed to Load Entry' : '入口加载失败'}</h3>
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && payload && (
            <ToolsManager agentId={agentId} initialTools={payload.tools} />
          )}
        </section>
      </div>

      <style jsx>{`
        .tools-page {
          min-height: 100vh;
          padding: 56px 24px 88px;
        }
        .tools-wrap {
          max-width: 1180px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .tools-head {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-end;
          flex-wrap: wrap;
        }
        .tools-eyebrow {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--fg-subtle);
          margin-bottom: 10px;
        }
        .tools-title {
          font-family: var(--font-display);
          font-size: clamp(34px, 5vw, 56px);
          line-height: 1;
          letter-spacing: -0.03em;
          font-weight: 400;
          font-variation-settings: 'SOFT' 80, 'opsz' 60;
        }
        .tools-sub {
          margin-top: 10px;
          max-width: 68ch;
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .tools-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .tools-link {
          text-decoration: none;
          border-radius: 999px;
          padding: 10px 14px;
          border: 1px solid var(--border);
          color: var(--fg);
          background: rgba(255, 255, 255, 0.04);
        }
        .tools-link-primary {
          border-color: rgba(245, 158, 11, 0.3);
          background: rgba(245, 158, 11, 0.12);
        }
        .tools-card {
          border-radius: 28px;
          border: 1px solid rgba(245, 158, 11, 0.18);
          background:
            linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(255, 255, 255, 0.03)),
            rgba(12, 16, 28, 0.84);
          backdrop-filter: blur(18px);
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 18px;
          box-shadow: var(--shadow);
        }
        .tools-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .tools-label {
          color: var(--fg-subtle);
          font-size: 12px;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .tools-card-title {
          font-size: 22px;
          font-weight: 500;
        }
        .tools-pill {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #fde68a;
          border: 1px solid rgba(245, 158, 11, 0.26);
          border-radius: 999px;
          padding: 7px 10px;
          background: rgba(245, 158, 11, 0.14);
        }
        .tools-copy {
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .tools-state {
          border: 1px dashed var(--border);
          border-radius: 20px;
          padding: 18px;
          background: rgba(255, 255, 255, 0.03);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .tools-state h3 {
          font-size: 18px;
          font-weight: 500;
        }
        .tools-state p {
          color: var(--fg-muted);
          line-height: 1.7;
        }
      `}</style>
    </main>
  )
}
