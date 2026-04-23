'use client'

import { useState } from 'react'
import styles from '../manager-ui.module.css'

export interface ToolManagerItem {
  name: string
  defaultEnabled: boolean
  configuredEnabled: boolean
  effectiveEnabled: boolean
  defaultDescription: string
  overrideDescription: string | null
  effectiveDescription: string
  unavailableReason: string | null
}

interface ToolsManagerProps {
  agentId: string
  initialTools: ToolManagerItem[]
}

type ToolDraftItem = ToolManagerItem & {
  description: string
}

function hydrateTools(tools: ToolManagerItem[]): ToolDraftItem[] {
  return tools.map((tool) => ({
    ...tool,
    description: tool.effectiveDescription,
  }))
}

function buildPatchPayload(tools: ToolDraftItem[]) {
  return {
    tools: Object.fromEntries(
      tools.map((tool) => [
        tool.name,
        {
          enabled: tool.configuredEnabled,
          description: tool.description.trim(),
        },
      ]),
    ),
  }
}

function describeToolState(tool: ToolManagerItem) {
  if (tool.effectiveEnabled) {
    return '生效中'
  }

  if (tool.configuredEnabled) {
    return '已启用，等待条件满足'
  }

  return '当前关闭'
}

function toolSummary(tool: ToolManagerItem) {
  if (tool.name === 'search_long_term_memory') {
    return '检索长期记忆层。默认开启，但只有 `memory:sqlite` 时才真正进入聊天可用工具集。'
  }

  if (tool.name === 'web_fetch') {
    return '抓取网页正文。默认关闭，可针对单个 persona 手动打开。'
  }

  return '管理该工具的启用状态与给模型看的描述。'
}

export default function ToolsManager({ agentId, initialTools }: ToolsManagerProps) {
  const [tools, setTools] = useState(() => hydrateTools(initialTools))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function updateTool(name: string, patch: Partial<ToolDraftItem>) {
    setTools((current) =>
      current.map((tool) => (tool.name === name ? { ...tool, ...patch } : tool)),
    )
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(`/api/agents/${agentId}/tools`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPatchPayload(tools)),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '保存工具配置失败')
      }

      setTools(hydrateTools(data.tools))
      setNotice('工具配置已保存。刷新后会保留当前开关与描述。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存工具配置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Tool Set</p>
          <h2 className={styles.title}>按 persona 管理真正暴露给模型的工具</h2>
          <p className={styles.copy}>
            这里显示的是同一个 persona 在当前模块配置下的工具状态。`configured enabled`
            表示你想让它开着，`effective enabled` 表示它此刻真的会出现在聊天链路里。
          </p>
        </div>
        <div className={styles.heroActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存工具配置'}
          </button>
        </div>
      </section>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.verticalStack}>
        {tools.map((tool) => (
          <section key={tool.name} className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <p className={styles.panelLabel}>Tool</p>
                <h3 className={styles.panelTitle}>{tool.name}</h3>
                <p className={styles.panelCopy}>{toolSummary(tool)}</p>
              </div>
              <span className={styles.statusPill}>{describeToolState(tool)}</span>
            </div>

            <div className={styles.statusGrid}>
              <div className={styles.promptCard}>
                <p className={styles.promptLabel}>启用状态</p>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Configured enabled</span>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 16,
                      border: '1px solid rgba(96, 165, 250, 0.18)',
                      background: 'rgba(5, 10, 22, 0.82)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={tool.configuredEnabled}
                      onChange={(event) =>
                        updateTool(tool.name, { configuredEnabled: event.target.checked })}
                    />
                    <span style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>
                      手动决定这个 persona 是否想暴露该工具
                    </span>
                  </div>
                </label>
                <dl className={styles.metaList}>
                  <div>
                    <dt>Default enabled</dt>
                    <dd>{tool.defaultEnabled ? '是' : '否'}</dd>
                  </div>
                  <div>
                    <dt>Effective enabled</dt>
                    <dd>{tool.effectiveEnabled ? '是' : '否'}</dd>
                  </div>
                </dl>
                {tool.unavailableReason && (
                  <p className={styles.error}>{tool.unavailableReason}</p>
                )}
              </div>

              <div className={styles.promptCard}>
                <p className={styles.promptLabel}>工具描述</p>
                <div className={styles.promptStack}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>当前描述</span>
                    <textarea
                      className={styles.textarea}
                      value={tool.description}
                      onChange={(event) =>
                        updateTool(tool.name, {
                          description: event.target.value,
                        })}
                      rows={4}
                      placeholder="清空后保存会回退系统默认描述。"
                    />
                  </label>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
