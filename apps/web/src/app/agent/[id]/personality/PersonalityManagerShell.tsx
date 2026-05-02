'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { COMMON_UI_COPY } from '@/lib/ui-copy'
import PromptTestPanel, { DEFAULT_PROMPT_TEST_INPUTS } from '../PromptTestPanel'
import styles from '../manager-ui.module.css'

type PersonalityConfig = {
  agentId: string
  systemPrompt: string
  personaPrompt: string
  avatarUrl: string
  thinkingRoleImmersionPrompt: string
}

function isPersonalityConfig(value: unknown): value is PersonalityConfig {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'systemPrompt' in (value as Record<string, unknown>)
    && 'personaPrompt' in (value as Record<string, unknown>)
    && 'avatarUrl' in (value as Record<string, unknown>)
    && 'thinkingRoleImmersionPrompt' in (value as Record<string, unknown>)
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
  const [avatarUrl, setAvatarUrl] = useState('')
  const [thinkingRoleImmersionPrompt, setThinkingRoleImmersionPrompt] = useState('')
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
          setAvatarUrl(data.avatarUrl)
          setThinkingRoleImmersionPrompt(data.thinkingRoleImmersionPrompt)
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
          avatarUrl,
          thinkingRoleImmersionPrompt,
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
      setAvatarUrl(data.avatarUrl)
      setThinkingRoleImmersionPrompt(data.thinkingRoleImmersionPrompt)
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
              固定入口 `/agent/{agentId}/personality` 维护真正参与主聊天链路的人设文本和思考模式规则。
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
                    `System Prompt` 负责角色底层规则，`Persona Prompt` 负责说话方式与边界感，
                    `Thinking Mode Prompt` 只在主聊天开启思考模式时追加。
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
                  <span className={styles.panelPill}>4 fields</span>
                </div>
                <p className={styles.panelCopy}>
                  留空即可移除对应片段。主系统会在没有 `System Prompt` 时退回到基于
                  agent 名称和描述生成的默认身份提示。
                </p>

                <div className={styles.fieldGrid}>
                  <label className={styles.wideField}>
                    <span className={styles.fieldLabel}>Avatar URL</span>
                    <div className="avatar-editor">
                      <div className="avatar-preview" aria-label="头像预览">
                        {avatarUrl.trim() ? (
                          <img src={avatarUrl.trim()} alt="" />
                        ) : (
                          <span>头像</span>
                        )}
                      </div>
                      <div className="avatar-controls">
                        <input
                          className={styles.input}
                          value={avatarUrl}
                          onChange={(event) => setAvatarUrl(event.target.value)}
                          placeholder="https://example.com/avatar.png 或 data:image/png;base64,..."
                        />
                        {avatarUrl.trim() && (
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => setAvatarUrl('')}
                          >
                            清除头像
                          </button>
                        )}
                      </div>
                    </div>
                  </label>

                  <label className={styles.wideField}>
                    <span className={styles.fieldLabel}>System Prompt</span>
                    <textarea
                      className={styles.textarea}
                      rows={7}
                      value={systemPrompt}
                      onChange={(event) => setSystemPrompt(event.target.value)}
                      placeholder="例如：你是真实存在的人，不要自称 AI，不要用系统口吻解释自己。"
                    />
                    <PromptTestPanel
                      agentId={agentId}
                      testId="personality.systemPrompt"
                      defaultInput={DEFAULT_PROMPT_TEST_INPUTS.personalitySystem}
                      prompt={systemPrompt}
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
                    <PromptTestPanel
                      agentId={agentId}
                      testId="personality.personaPrompt"
                      defaultInput={DEFAULT_PROMPT_TEST_INPUTS.personalityPersona}
                      prompt={personaPrompt}
                    />
                  </label>
                </div>

                <label className={styles.promptCard}>
                  <div className={styles.promptHead}>
                    <div>
                      <span className={styles.promptLabel}>Thinking Mode Prompt</span>
                      <p className={styles.promptHelper}>
                        开启思考模式时追加到最终 system prompt 末尾。留空则不追加任何思考沉浸规则。
                      </p>
                    </div>
                    <span className={styles.statusPill}>modules.personality</span>
                  </div>
                  <textarea
                    className={styles.promptTextarea}
                    rows={8}
                    value={thinkingRoleImmersionPrompt}
                    onChange={(event) => setThinkingRoleImmersionPrompt(event.target.value)}
                    placeholder="例如：【角色沉浸要求】&#10;在你的思考过程（<think>标签内）中，请遵守以下规则：..."
                  />
                  <PromptTestPanel
                    agentId={agentId}
                    testId="personality.thinkingModePrompt"
                    defaultInput={DEFAULT_PROMPT_TEST_INPUTS.personalityThinking}
                    prompt={thinkingRoleImmersionPrompt}
                  />
                  <p className={styles.promptMeta}>
                    生效条件：主聊天思考模式开启，且这里保存了非空内容。
                  </p>
                </label>
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
        .avatar-editor {
          display: grid;
          grid-template-columns: 96px minmax(0, 1fr);
          gap: 14px;
          align-items: center;
        }
        .avatar-preview {
          width: 96px;
          height: 96px;
          border-radius: 24px;
          border: 1px solid rgba(96, 165, 250, 0.22);
          background:
            radial-gradient(circle at 30% 30%, rgba(96, 165, 250, 0.22), transparent 58%),
            rgba(5, 10, 22, 0.82);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          color: rgba(170, 184, 214, 0.86);
          font-size: 13px;
          flex-shrink: 0;
        }
        .avatar-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .avatar-controls {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
        }
        .avatar-controls :global(button) {
          align-self: flex-start;
        }
        @media (max-width: 640px) {
          .avatar-editor {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  )
}
