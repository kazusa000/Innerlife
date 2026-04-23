'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { COMMON_UI_COPY } from '@/lib/ui-copy'
import styles from '../manager-ui.module.css'

type PersonalityConfig = {
  agentId: string
  systemPrompt: string
  personaPrompt: string
}

function isPersonalityConfig(value: unknown): value is PersonalityConfig {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'systemPrompt' in (value as Record<string, unknown>)
    && 'personaPrompt' in (value as Record<string, unknown>)
}

function readErrorMessage(value: unknown, fallback: string) {
  if (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'error' in value
    && typeof value.error === 'string'
  ) {
    return value.error
  }

  return fallback
}

export default function PersonalityManagerShell({ agentId }: { agentId: string }) {
  const [systemPrompt, setSystemPrompt] = useState('')
  const [personaPrompt, setPersonaPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadConfig() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/agents/${agentId}/personality`, {
          cache: 'no-store',
        })
        const data = await response.json() as unknown
        if (!response.ok) {
          throw new Error(readErrorMessage(data, '加载人设失败'))
        }
        if (!isPersonalityConfig(data)) {
          throw new Error('加载人设失败')
        }

        if (!cancelled) {
          setSystemPrompt(data.systemPrompt)
          setPersonaPrompt(data.personaPrompt)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载人设失败')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadConfig()

    return () => {
      cancelled = true
    }
  }, [agentId])

  async function saveConfig() {
    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(`/api/agents/${agentId}/personality`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          personaPrompt,
        }),
      })
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '保存人设失败'))
      }
      if (!isPersonalityConfig(data)) {
        throw new Error('保存人设失败')
      }

      setSystemPrompt(data.systemPrompt)
      setPersonaPrompt(data.personaPrompt)
      setNotice('人设已保存。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存人设失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="personality-page">
      <div className="personality-wrap">
        <header className="personality-head">
          <div>
            <p className="personality-eyebrow">{COMMON_UI_COPY.unifiedEntry}</p>
            <h1 className="personality-title">人设管理</h1>
            <p className="personality-sub">
              固定入口 `/agent/{agentId}/personality` 现在只维护两段真正参与主聊天链路的人设文本。
            </p>
          </div>
          <div className="personality-actions">
            <Link href="/" className="personality-link">
              {COMMON_UI_COPY.backToPersonas}
            </Link>
            <Link href={`/chat?agent=${agentId}`} className="personality-link personality-link-primary">
              {COMMON_UI_COPY.openChat}
            </Link>
          </div>
        </header>

        <section className="personality-card">
          {loading && <p className={styles.copy}>正在加载人设…</p>}

          {!loading && error && (
            <div className={styles.emptyState}>
              <h3>人设加载失败</h3>
              <p className={styles.emptyCopy}>{error}</p>
            </div>
          )}

          {!loading && !error && (
            <section className={styles.workspace}>
              <div className={styles.hero}>
                <div>
                  <p className={styles.eyebrow}>Persona System</p>
                  <h2 className={styles.title}>双 Prompt 人设</h2>
                  <p className={styles.copy}>
                    `System Prompt` 负责角色底层规则，`Persona Prompt` 负责说话方式与边界感。
                    保存后主聊天链路和图灵测试链路都会只读取这里。
                  </p>
                </div>
                <div className={styles.heroActions}>
                  <span className={styles.statusPill}>modules.personality</span>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void saveConfig()}
                    disabled={saving}
                  >
                    {saving ? '保存中…' : '保存人设'}
                  </button>
                </div>
              </div>

              {notice && <p className={styles.notice}>{notice}</p>}
              {error && <p className={styles.error}>{error}</p>}

              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <p className={styles.panelLabel}>Prompt Editor</p>
                    <h3 className={styles.panelTitle}>当前生效的人设文本</h3>
                  </div>
                  <span className={styles.panelPill}>2 fields</span>
                </div>
                <p className={styles.panelCopy}>
                  留空即可移除对应片段。主系统会在没有 `System Prompt` 时退回到基于
                  agent 名称和描述生成的默认身份提示。
                </p>

                <div className={styles.fieldGrid}>
                  <label className={styles.wideField}>
                    <span className={styles.fieldLabel}>System Prompt</span>
                    <textarea
                      className={styles.textarea}
                      rows={7}
                      value={systemPrompt}
                      onChange={(event) => setSystemPrompt(event.target.value)}
                      placeholder="例如：你是真实存在的人，不要自称 AI，不要用系统口吻解释自己。"
                    />
                  </label>

                  <label className={styles.wideField}>
                    <span className={styles.fieldLabel}>Persona Prompt</span>
                    <textarea
                      className={styles.textarea}
                      rows={7}
                      value={personaPrompt}
                      onChange={(event) => setPersonaPrompt(event.target.value)}
                      placeholder="例如：像熟人一样交流，少一点客服感，克制一点，不把话说太满。"
                    />
                  </label>
                </div>
              </section>
            </section>
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
          box-shadow: var(--shadow);
        }
      `}</style>
    </main>
  )
}
