'use client'

import Link from 'next/link'
import { useEffect, useState, type ComponentType } from 'react'
import { getCommonUiCopy } from '@/lib/ui-copy'
import { useAppLocale } from '@/app/use-app-locale'
import EmotionManagerDimensional from './EmotionManager.dimensional'

interface AgentEmotionMeta {
  agentId: string
  scheme: string | null
  supportedSchemes: string[]
  configured: boolean
}

interface EmotionManagerProps {
  agentId: string
  meta: AgentEmotionMeta
}

const emotionManagersByScheme = {
  dimensional: EmotionManagerDimensional,
} satisfies Record<string, ComponentType<EmotionManagerProps>>

export default function EmotionManagerShell({ agentId }: { agentId: string }) {
  const locale = useAppLocale()
  const commonCopy = getCommonUiCopy(locale)
  const [meta, setMeta] = useState<AgentEmotionMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadMeta() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/agents/${agentId}/emotion`, {
          cache: 'no-store',
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(
            typeof data?.error === 'string' ? data.error : locale === 'en-US' ? 'Failed to load emotion manager' : '加载情绪管理入口失败',
          )
        }

        if (!cancelled) {
          setMeta(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : locale === 'en-US' ? 'Failed to load emotion manager' : '加载情绪管理入口失败')
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
    ? emotionManagersByScheme[meta.scheme as keyof typeof emotionManagersByScheme]
    : null

  return (
    <main className="emotion-page">
      <div className="emotion-wrap">
        <header className="emotion-head">
          <div>
            <p className="emotion-eyebrow">{commonCopy.unifiedEntry}</p>
            <h1 className="emotion-title">{locale === 'en-US' ? 'Emotion Management' : '情绪管理'}</h1>
            <p className="emotion-sub">
              {locale === 'en-US'
                ? 'Stable entry `/agent/{agentId}/emotion`. This page dispatches to the matching subsystem based on `emotion.scheme`.'
                : '固定入口 `/agent/{agentId}/emotion`。当前页面只根据 `emotion.scheme` 分发到对应子系统。'}
            </p>
          </div>
          <div className="emotion-actions">
            <Link href="/" className="emotion-link">
              {commonCopy.backToPersonas}
            </Link>
            <Link href={`/chat?agent=${agentId}`} className="emotion-link emotion-link-primary">
              {commonCopy.openChat}
            </Link>
          </div>
        </header>

        <section className="emotion-card">
          <div className="emotion-card-head">
            <div>
              <p className="emotion-label">{commonCopy.agent}</p>
              <h2 className="emotion-card-title">{agentId}</h2>
            </div>
            {meta && <span className="emotion-pill">{meta.scheme ?? commonCopy.unconfigured}</span>}
          </div>

          {loading && <p className="emotion-copy">{locale === 'en-US' ? 'Loading emotion manager...' : '正在加载情绪管理入口…'}</p>}

          {!loading && error && (
            <div className="emotion-state">
              <h3>{locale === 'en-US' ? 'Failed to Load Entry' : '入口加载失败'}</h3>
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && meta && !meta.configured && (
            <div className="emotion-state">
              <h3>{locale === 'en-US' ? 'Emotion Module Is Not Enabled' : '情绪模块尚未开启'}</h3>
              <p>
                {locale === 'en-US'
                  ? 'This persona has not enabled emotion management. Go back to the home page and enable the `dimensional` emotion scheme first.'
                  : '这个虚拟人还没有启用情绪管理。当前固定入口已经就绪，但如果你想使用 `dimensional`，先回到首页的虚拟人编辑区启用情绪方案。'}
              </p>
            </div>
          )}

          {!loading && !error && meta?.configured && Manager && (
            <div className="emotion-manager-slot">
              <Manager agentId={agentId} meta={meta} />
            </div>
          )}

          {!loading && !error && meta?.configured && !Manager && (
            <div className="emotion-state">
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
        .emotion-page {
          min-height: 100vh;
          padding: 56px 24px 88px;
        }
        .emotion-wrap {
          max-width: 1100px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .emotion-head {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-end;
          flex-wrap: wrap;
        }
        .emotion-eyebrow {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--fg-subtle);
          margin-bottom: 10px;
        }
        .emotion-title {
          font-family: var(--font-display);
          font-size: clamp(34px, 5vw, 56px);
          line-height: 1;
          letter-spacing: -0.03em;
          font-weight: 400;
          font-variation-settings: 'SOFT' 80, 'opsz' 60;
        }
        .emotion-sub {
          margin-top: 10px;
          max-width: 60ch;
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .emotion-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .emotion-link {
          text-decoration: none;
          border-radius: 999px;
          padding: 10px 14px;
          border: 1px solid var(--border);
          color: var(--fg);
          background: rgba(255, 255, 255, 0.04);
        }
        .emotion-link-primary {
          border-color: rgba(244, 114, 182, 0.34);
          background: rgba(244, 114, 182, 0.14);
        }
        .emotion-card {
          border-radius: 28px;
          border: 1px solid rgba(244, 114, 182, 0.22);
          background:
            linear-gradient(135deg, rgba(244, 114, 182, 0.08), rgba(255, 255, 255, 0.03)),
            rgba(12, 16, 28, 0.84);
          backdrop-filter: blur(18px);
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 18px;
          box-shadow: var(--shadow);
        }
        .emotion-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .emotion-label {
          color: var(--fg-subtle);
          font-size: 12px;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .emotion-card-title {
          font-size: 22px;
          font-weight: 500;
        }
        .emotion-pill {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #ffd6ec;
          border: 1px solid rgba(244, 114, 182, 0.24);
          border-radius: 999px;
          padding: 7px 10px;
          background: rgba(244, 114, 182, 0.14);
        }
        .emotion-copy {
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .emotion-state {
          border: 1px dashed var(--border);
          border-radius: 20px;
          padding: 18px;
          background: rgba(255, 255, 255, 0.03);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .emotion-state h3 {
          font-size: 18px;
          font-weight: 500;
        }
        .emotion-state p {
          color: var(--fg-muted);
          line-height: 1.7;
        }
        .emotion-manager-slot {
          display: flex;
        }
        @media (max-width: 720px) {
          .emotion-page {
            padding: 24px 16px 64px;
          }
          .emotion-card {
            padding: 18px;
          }
        }
      `}</style>
    </main>
  )
}
