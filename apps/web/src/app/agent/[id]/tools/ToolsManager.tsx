'use client'

import { useState } from 'react'
import { useAppLocale } from '@/app/use-app-locale'
import PromptTestPanel, { DEFAULT_PROMPT_TEST_INPUTS } from '../PromptTestPanel'
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
  episodicActivation: {
    enabled: boolean
    ttlMinutes: number
    maxActive: number
  } | null
}

interface ToolsManagerProps {
  agentId: string
  initialTools: ToolManagerItem[]
}

type ToolDraftItem = ToolManagerItem & {
  description: string
  episodicActivationDraft: {
    enabled: boolean
    ttlMinutes: number
    maxActive: number
  } | null
}

function hydrateTools(tools: ToolManagerItem[]): ToolDraftItem[] {
  return tools.map((tool) => ({
    ...tool,
    description: tool.effectiveDescription,
    episodicActivationDraft: tool.episodicActivation ? { ...tool.episodicActivation } : null,
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
          episodicActivation: tool.episodicActivationDraft
            ? {
                enabled: tool.episodicActivationDraft.enabled,
                ttlMinutes: tool.episodicActivationDraft.ttlMinutes,
                maxActive: tool.episodicActivationDraft.maxActive,
              }
            : undefined,
        },
      ]),
    ),
  }
}

function describeToolState(tool: ToolManagerItem, locale: 'zh-CN' | 'en-US') {
  if (tool.effectiveEnabled) {
    return locale === 'en-US' ? 'Effective' : '生效中'
  }

  if (tool.configuredEnabled) {
    return locale === 'en-US' ? 'Enabled, waiting for requirements' : '已启用，等待条件满足'
  }

  return locale === 'en-US' ? 'Off' : '当前关闭'
}

function toolSummary(tool: ToolManagerItem, locale: 'zh-CN' | 'en-US') {
  if (tool.name === 'search_long_term_memory') {
    return locale === 'en-US'
      ? 'Searches long-term memory. Enabled by default, but only appears in chat when `memory:sqlite` is active.'
      : '检索长期记忆层。默认开启，但只有 `memory:sqlite` 时才真正进入聊天可用工具集。'
  }

  if (tool.name === 'web_fetch') {
    return locale === 'en-US'
      ? 'Fetches webpage text. Disabled by default and can be enabled per persona.'
      : '抓取网页正文。默认关闭，可针对单个 persona 手动打开。'
  }

  return locale === 'en-US'
    ? 'Manage whether this tool is enabled and how it is described to the model.'
    : '管理该工具的启用状态与给模型看的描述。'
}

export default function ToolsManager({ agentId, initialTools }: ToolsManagerProps) {
  const locale = useAppLocale()
  const [tools, setTools] = useState(() => hydrateTools(initialTools))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function updateTool(name: string, patch: Partial<ToolDraftItem>) {
    setTools((current) =>
      current.map((tool) => (tool.name === name ? { ...tool, ...patch } : tool)),
    )
  }

  function updateEpisodicActivation(name: string, patch: Partial<NonNullable<ToolDraftItem['episodicActivationDraft']>>) {
    setTools((current) =>
      current.map((tool) => {
        if (tool.name !== name || !tool.episodicActivationDraft) {
          return tool
        }
        return {
          ...tool,
          episodicActivationDraft: {
            ...tool.episodicActivationDraft,
            ...patch,
          },
        }
      }),
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
        throw new Error(typeof data?.error === 'string' ? data.error : locale === 'en-US' ? 'Failed to save tool settings' : '保存工具配置失败')
      }

      setTools(hydrateTools(data.tools))
      setNotice(locale === 'en-US' ? 'Tool settings saved. Current toggles and descriptions will persist after refresh.' : '工具配置已保存。刷新后会保留当前开关与描述。')
    } catch (err) {
      setError(err instanceof Error ? err.message : locale === 'en-US' ? 'Failed to save tool settings' : '保存工具配置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Tool Set</p>
          <h2 className={styles.title}>{locale === 'en-US' ? 'Manage the tools actually exposed to the model per persona' : '按 persona 管理真正暴露给模型的工具'}</h2>
          <p className={styles.copy}>
            {locale === 'en-US'
              ? 'This shows tool state for the current module configuration. `configured enabled` means you want it on; `effective enabled` means it actually appears in chat right now.'
              : '这里显示的是同一个 persona 在当前模块配置下的工具状态。`configured enabled` 表示你想让它开着，`effective enabled` 表示它此刻真的会出现在聊天链路里。'}
          </p>
        </div>
        <div className={styles.heroActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? (locale === 'en-US' ? 'Saving...' : '保存中…') : (locale === 'en-US' ? 'Save Tool Settings' : '保存工具配置')}
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
                <p className={styles.panelCopy}>{toolSummary(tool, locale)}</p>
              </div>
              <span className={styles.statusPill}>{describeToolState(tool, locale)}</span>
            </div>

            <div className={styles.statusGrid}>
              <div className={styles.promptCard}>
                <p className={styles.promptLabel}>{locale === 'en-US' ? 'Enabled State' : '启用状态'}</p>
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
                      {locale === 'en-US' ? 'Manually decide whether this persona should expose this tool' : '手动决定这个 persona 是否想暴露该工具'}
                    </span>
                  </div>
                </label>
                <dl className={styles.metaList}>
                  <div>
                    <dt>Default enabled</dt>
                    <dd>{tool.defaultEnabled ? (locale === 'en-US' ? 'Yes' : '是') : (locale === 'en-US' ? 'No' : '否')}</dd>
                  </div>
                  <div>
                    <dt>Effective enabled</dt>
                    <dd>{tool.effectiveEnabled ? (locale === 'en-US' ? 'Yes' : '是') : (locale === 'en-US' ? 'No' : '否')}</dd>
                  </div>
                </dl>
                {tool.unavailableReason && (
                  <p className={styles.error}>{tool.unavailableReason}</p>
                )}
              </div>

              <div className={styles.promptCard}>
                <p className={styles.promptLabel}>{locale === 'en-US' ? 'Tool Description' : '工具描述'}</p>
                <div className={styles.promptStack}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>{locale === 'en-US' ? 'Current description' : '当前描述'}</span>
                    <textarea
                      className={styles.textarea}
                      value={tool.description}
                      onChange={(event) =>
                        updateTool(tool.name, {
                          description: event.target.value,
                        })}
                      rows={4}
                      placeholder={locale === 'en-US' ? 'Clear and save to fall back to the system default description.' : '清空后保存会回退系统默认描述。'}
                    />
                    <PromptTestPanel
                      agentId={agentId}
                      testId={`tools.${tool.name}.description`}
                      defaultInput={DEFAULT_PROMPT_TEST_INPUTS.toolDescription(tool.name)}
                      prompt={tool.description}
                    />
                  </label>
                </div>
              </div>

              {tool.name === 'search_long_term_memory' && tool.episodicActivationDraft && (
                <div className={styles.promptCard}>
                  <p className={styles.promptLabel}>{locale === 'en-US' ? 'Temporary Episodic Activation' : '情景记忆临时激活'}</p>
                  <div className={styles.promptStack}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>{locale === 'en-US' ? 'Enable temporary activation' : '启用临时激活'}</span>
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
                          checked={tool.episodicActivationDraft.enabled}
                          onChange={(event) =>
                            updateEpisodicActivation(tool.name, { enabled: event.target.checked })}
                        />
                        <span style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>
                          {locale === 'en-US'
                            ? 'Episodic memories recalled by the tool are temporarily eligible for pre-chat short-term retrieval.'
                            : 'tool 召回的情景记忆会临时参与聊天前短期记忆检索。'}
                        </span>
                      </div>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>{locale === 'en-US' ? 'Activation duration in minutes' : '激活持续分钟数'}</span>
                      <input
                        className={styles.input}
                        type="number"
                        min={1}
                        max={1440}
                        value={tool.episodicActivationDraft.ttlMinutes}
                        onChange={(event) =>
                          updateEpisodicActivation(tool.name, {
                            ttlMinutes: Math.max(1, Math.min(1440, Number(event.target.value) || 20)),
                          })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>{locale === 'en-US' ? 'Maximum active memories' : '最多激活条数'}</span>
                      <input
                        className={styles.input}
                        type="number"
                        min={1}
                        max={20}
                        value={tool.episodicActivationDraft.maxActive}
                        onChange={(event) =>
                          updateEpisodicActivation(tool.name, {
                            maxActive: Math.max(1, Math.min(20, Number(event.target.value) || 5)),
                          })}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
