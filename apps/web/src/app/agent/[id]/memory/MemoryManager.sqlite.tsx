'use client'

import { Fragment, useDeferredValue, useEffect, useRef, useState, useTransition } from 'react'
import PromptLab from '../PromptLab'
import styles from '../manager-ui.module.css'
import { getSqliteMemoryToolbarState } from './MemoryManager.sqlite.state'

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

interface SqliteMemory {
  id: string
  sessionId: string
  summary: string
  retrievalText: string
  tags: string[]
  importance: number
  createdAt: string
}

interface MemorySettings {
  summarizeModel: string
  embeddingModel: string
  retrievePrompt: string
  summarizePrompt: string
  fragmentPrompt: string
  consolidatePrompt: string
}

interface ConsolidationReport {
  before: number
  after: number
  kept: number
  rewritten: number
  merged: number
}

interface MemoryListResponse {
  memories: SqliteMemory[]
  page: number
  pageSize: number
  total: number
  summarizeModel: string | null
  embeddingModel: string | null
  retrievePrompt: string | null
  summarizePrompt: string | null
  fragmentPrompt: string | null
  consolidatePrompt: string | null
  retrievePromptDefault: string
  retrievePromptEffective: string
  summarizePromptDefault: string
  summarizePromptEffective: string
  fragmentPromptDefault: string
  fragmentPromptEffective: string
  consolidatePromptDefault: string
  consolidatePromptEffective: string
}

function readErrorMessage(value: unknown, fallback: string) {
  if (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'error' in value
    && typeof value.error === 'string'
  ) {
    return value.error
  }

  return fallback
}

const PAGE_SIZE = 10
const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function normalizeSettings(data: Partial<MemoryListResponse> | Partial<MemorySettings>): MemorySettings {
  return {
    summarizeModel: typeof data.summarizeModel === 'string' ? data.summarizeModel : '',
    embeddingModel: typeof data.embeddingModel === 'string' ? data.embeddingModel : '',
    retrievePrompt: typeof data.retrievePrompt === 'string' ? data.retrievePrompt : '',
    summarizePrompt: typeof data.summarizePrompt === 'string' ? data.summarizePrompt : '',
    fragmentPrompt: typeof data.fragmentPrompt === 'string' ? data.fragmentPrompt : '',
    consolidatePrompt: typeof data.consolidatePrompt === 'string' ? data.consolidatePrompt : '',
  }
}

function normalizePromptDefaults(data: Partial<MemoryListResponse>): Pick<
  MemorySettings,
  'retrievePrompt' | 'summarizePrompt' | 'fragmentPrompt' | 'consolidatePrompt'
> {
  return {
    retrievePrompt: typeof data.retrievePromptDefault === 'string' ? data.retrievePromptDefault : '',
    summarizePrompt: typeof data.summarizePromptDefault === 'string' ? data.summarizePromptDefault : '',
    fragmentPrompt: typeof data.fragmentPromptDefault === 'string' ? data.fragmentPromptDefault : '',
    consolidatePrompt: typeof data.consolidatePromptDefault === 'string' ? data.consolidatePromptDefault : '',
  }
}

function normalizeEffectivePrompts(data: Partial<MemoryListResponse>): Pick<
  MemorySettings,
  'retrievePrompt' | 'summarizePrompt' | 'fragmentPrompt' | 'consolidatePrompt'
> {
  return {
    retrievePrompt: typeof data.retrievePromptEffective === 'string' ? data.retrievePromptEffective : '',
    summarizePrompt: typeof data.summarizePromptEffective === 'string' ? data.summarizePromptEffective : '',
    fragmentPrompt: typeof data.fragmentPromptEffective === 'string' ? data.fragmentPromptEffective : '',
    consolidatePrompt: typeof data.consolidatePromptEffective === 'string' ? data.consolidatePromptEffective : '',
  }
}

function areSettingsEqual(left: MemorySettings, right: MemorySettings) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export default function MemoryManagerSqlite({ agentId }: MemoryManagerProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [page, setPage] = useState(1)
  const [memories, setMemories] = useState<SqliteMemory[]>([])
  const [total, setTotal] = useState(0)
  const [savedSettings, setSavedSettings] = useState<MemorySettings>(() => normalizeSettings({}))
  const [savedOverrides, setSavedOverrides] = useState<MemorySettings>(() => normalizeSettings({}))
  const [defaultPrompts, setDefaultPrompts] = useState<Pick<
    MemorySettings,
    'retrievePrompt' | 'summarizePrompt' | 'fragmentPrompt' | 'consolidatePrompt'
  >>(() => normalizePromptDefaults({}))
  const [draftSettings, setDraftSettings] = useState<MemorySettings>(() => normalizeSettings({}))
  const settingsDirtyRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [isConsolidating, setIsConsolidating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const settingsDirty = !areSettingsEqual(savedSettings, draftSettings)
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const toolbarState = getSqliteMemoryToolbarState({
    loading,
    pending,
    isConsolidating,
    memoryCount: total,
  })

  async function refresh(search = deferredQuery, nextPage = page) {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (search.trim()) {
        params.set('q', search.trim())
      }
      params.set('page', String(nextPage))
      params.set('pageSize', String(PAGE_SIZE))

      const response = await fetch(`/api/agents/${agentId}/memory/sqlite?${params.toString()}`, {
        cache: 'no-store',
      })
      const data = await response.json() as unknown
      if (!response.ok) {
        throw new Error(readErrorMessage(data, '加载 sqlite 记忆失败'))
      }

      const payload = data as MemoryListResponse
      const rawSettings = normalizeSettings(payload)
      const effectivePrompts = normalizeEffectivePrompts(payload)
      const settings = {
        ...rawSettings,
        ...effectivePrompts,
      }
      setMemories(Array.isArray(payload.memories) ? payload.memories : [])
      setTotal(typeof payload.total === 'number' ? payload.total : 0)
      setPage(typeof payload.page === 'number' ? payload.page : nextPage)
      setSavedSettings(settings)
      setSavedOverrides(rawSettings)
      setDefaultPrompts(normalizePromptDefaults(payload))
      if (!settingsDirtyRef.current) {
        setDraftSettings(settings)
      }
      if (expandedId && !(payload.memories ?? []).some((memory) => memory.id === expandedId)) {
        setExpandedId(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 sqlite 记忆失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh(deferredQuery, page)
  }, [agentId, deferredQuery, page])

  function updateSetting<K extends keyof MemorySettings>(key: K, value: MemorySettings[K]) {
    settingsDirtyRef.current = true
    setDraftSettings((current) => ({ ...current, [key]: value }))
  }

  async function handleDelete(memoryId: string) {
    if (!window.confirm('要删除这条 sqlite 记忆吗？')) {
      return
    }

    setError(null)
    setNotice(null)

    const response = await fetch(`/api/agents/${agentId}/memory/sqlite/${memoryId}`, {
      method: 'DELETE',
    })
    const data = await response.json()
    if (!response.ok) {
      setError(typeof data?.error === 'string' ? data.error : '删除 sqlite 记忆失败')
      return
    }

    setNotice('已删除这条 sqlite 记忆。')
    startTransition(() => {
      void refresh()
    })
  }

  async function handleConsolidate() {
    setError(null)
    setNotice('正在整理 sqlite 记忆，这一步可能需要几十秒。')
    setIsConsolidating(true)

    try {
      const response = await fetch(`/api/agents/${agentId}/memory/sqlite/consolidate`, {
        method: 'POST',
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '整理 sqlite 记忆失败')
      }

      const report = data as ConsolidationReport
      setNotice(
        `sqlite 记忆整理完成：${report.before} -> ${report.after}，保留 ${report.kept}，重写 ${report.rewritten}，合并 ${report.merged}。`,
      )
      startTransition(() => {
        void refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '整理 sqlite 记忆失败')
      setNotice(null)
    } finally {
      setIsConsolidating(false)
    }
  }

  async function handleSaveSettings() {
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(`/api/agents/${agentId}/memory/sqlite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summarizeModel: draftSettings.summarizeModel,
          embeddingModel: draftSettings.embeddingModel,
          retrievePrompt: draftSettings.retrievePrompt.trim() === defaultPrompts.retrievePrompt.trim()
            ? null
            : draftSettings.retrievePrompt,
          summarizePrompt: draftSettings.summarizePrompt.trim() === defaultPrompts.summarizePrompt.trim()
            ? null
            : draftSettings.summarizePrompt,
          fragmentPrompt: draftSettings.fragmentPrompt.trim() === defaultPrompts.fragmentPrompt.trim()
            ? null
            : draftSettings.fragmentPrompt,
          consolidatePrompt: draftSettings.consolidatePrompt.trim() === defaultPrompts.consolidatePrompt.trim()
            ? null
            : draftSettings.consolidatePrompt,
        }),
      })
      const data = await response.json() as Partial<MemorySettings> & {
        error?: string
        retrievePromptDefault?: string
        retrievePromptEffective?: string
        summarizePromptDefault?: string
        summarizePromptEffective?: string
        fragmentPromptDefault?: string
        fragmentPromptEffective?: string
        consolidatePromptDefault?: string
        consolidatePromptEffective?: string
      }
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '保存记忆配置失败')
      }

      const normalizedOverride = normalizeSettings(data)
      const normalizedEffective = {
        ...normalizedOverride,
        ...normalizeEffectivePrompts(data),
      }
      setSavedOverrides(normalizedOverride)
      setDefaultPrompts((current) => ({
        retrievePrompt: typeof data.retrievePromptDefault === 'string' ? data.retrievePromptDefault : current.retrievePrompt,
        summarizePrompt: typeof data.summarizePromptDefault === 'string' ? data.summarizePromptDefault : current.summarizePrompt,
        fragmentPrompt: typeof data.fragmentPromptDefault === 'string' ? data.fragmentPromptDefault : current.fragmentPrompt,
        consolidatePrompt: typeof data.consolidatePromptDefault === 'string' ? data.consolidatePromptDefault : current.consolidatePrompt,
      }))
      setSavedSettings(normalizedEffective)
      setDraftSettings(normalizedEffective)
      settingsDirtyRef.current = false
      setNotice('记忆模型和全部 prompt 已保存。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存记忆配置失败')
    }
  }

  return (
    <section className={styles.workspace}>
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>记忆管理</p>
          <h3 className={styles.title}>sqlite Memory Console</h3>
          <p className={styles.copy}>
            上面统一放记忆链路的模型和全部 prompt，下面是可搜索、可翻页、可展开的记忆表。
            这页不再用卡片流，而是像真正的运营控制台一样按行浏览 memory。
          </p>
        </div>
        <div className={styles.heroActions}>
          <span className={styles.statusPill}>{toolbarState.status ?? `共 ${total} 条`}</span>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => startTransition(() => { void refresh() })}
            disabled={toolbarState.refreshDisabled}
          >
            刷新
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleConsolidate}
            disabled={toolbarState.consolidateDisabled}
          >
            {toolbarState.consolidateLabel}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleSaveSettings()}
            disabled={!settingsDirty || isConsolidating}
          >
            保存配置
          </button>
        </div>
      </div>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>模型设置</p>
              <h4 className={styles.panelTitle}>LLM & Embedding</h4>
            </div>
            <span className={styles.panelPill}>检索 · 总结 · 整理</span>
          </div>
          <p className={styles.panelCopy}>
            记忆相关的模型设置统一收在这里。留空会继承虚拟人的主模型；embedding 模型则回退到系统默认值。
          </p>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Memory Model</span>
              <input
                className={styles.input}
                value={draftSettings.summarizeModel}
                onChange={(event) => updateSetting('summarizeModel', event.target.value)}
                placeholder="例如 qwen/qwen-2.5-7b-instruct"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Embedding Model</span>
              <input
                className={styles.input}
                value={draftSettings.embeddingModel}
                onChange={(event) => updateSetting('embeddingModel', event.target.value)}
                placeholder="例如 openai/text-embedding-3-small"
              />
            </label>
          </div>
        </section>

        <PromptLab
          fields={[
            {
              key: 'retrievePrompt',
              label: 'Retrieve Prompt',
              helper: '语义检索改写和 time_range 提取的 prompt。现在如果你拆成双 analyzer，这里仍可以作为统一入口再细分。',
              value: draftSettings.retrievePrompt,
              defaultValue: defaultPrompts.retrievePrompt,
              sourceLabel: savedOverrides.retrievePrompt ? '自定义 override' : '系统默认',
              placeholder: '留空则使用系统默认的 retrieval analyzer prompt。',
              rows: 7,
            },
            {
              key: 'summarizePrompt',
              label: 'Summarize Prompt',
              helper: '把一轮对话写成 display_summary / retrieval_text / tags / importance 的 prompt。',
              value: draftSettings.summarizePrompt,
              defaultValue: defaultPrompts.summarizePrompt,
              sourceLabel: savedOverrides.summarizePrompt ? '自定义 override' : '系统默认',
              placeholder: '留空则使用系统默认的 summarize prompt。',
              rows: 7,
            },
            {
              key: 'fragmentPrompt',
              label: 'Fragment Prompt',
              helper: '控制命中记忆如何注入主 prompt。这里适合写“把这些记忆当作回忆来回答”的包装文案。',
              value: draftSettings.fragmentPrompt,
              defaultValue: defaultPrompts.fragmentPrompt,
              sourceLabel: savedOverrides.fragmentPrompt ? '自定义 override' : '系统默认',
              placeholder: '留空则使用系统默认的 memory fragment prompt。',
              rows: 7,
            },
            {
              key: 'consolidatePrompt',
              label: 'Consolidate Prompt',
              helper: '控制 memory consolidate 时如何 rewrite / merge / keep。',
              value: draftSettings.consolidatePrompt,
              defaultValue: defaultPrompts.consolidatePrompt,
              sourceLabel: savedOverrides.consolidatePrompt ? '自定义 override' : '系统默认',
              placeholder: '留空则使用系统默认的 consolidate prompt。',
              rows: 7,
            },
          ]}
          onChange={(key, value) => updateSetting(key as keyof MemorySettings, value)}
          onReset={(key) => {
            if (key === 'retrievePrompt') {
              updateSetting('retrievePrompt', defaultPrompts.retrievePrompt)
            } else if (key === 'summarizePrompt') {
              updateSetting('summarizePrompt', defaultPrompts.summarizePrompt)
            } else if (key === 'fragmentPrompt') {
              updateSetting('fragmentPrompt', defaultPrompts.fragmentPrompt)
            } else if (key === 'consolidatePrompt') {
              updateSetting('consolidatePrompt', defaultPrompts.consolidatePrompt)
            }
          }}
        />
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.tableLabel}>记忆表</p>
            <h4 className={styles.panelTitle}>Memory Rows</h4>
          </div>
          <span className={styles.panelPill}>
            第 {page} / {pageCount} 页
          </span>
        </div>

        <div className={styles.tableToolbar}>
          <label className={styles.searchField}>
            <span className={styles.fieldLabel}>搜索</span>
            <input
              className={styles.searchInput}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder="按摘要、检索文本或 tags 搜索"
            />
          </label>

          <div className={styles.toolbarActions}>
            <span className={styles.statusText}>
              当前结果 {memories.length} / 总数 {total}
              {deferredQuery.trim() ? ` · 搜索词：${deferredQuery.trim()}` : ''}
            </span>
          </div>
        </div>

        {loading && memories.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>正在加载 sqlite 记忆…</h3>
          </div>
        ) : memories.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>还没有可管理的 sqlite 记忆</h3>
            <p className={styles.emptyCopy}>先去聊天几轮让系统写入 memory，或者清空搜索词查看全部结果。</p>
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>摘要</th>
                    <th>时间</th>
                    <th>会话</th>
                    <th>重要性</th>
                    <th>标签</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {memories.map((memory) => {
                    const expanded = expandedId === memory.id
                    return (
                      <Fragment key={memory.id}>
                        <tr key={memory.id}>
                          <td>
                            <button
                              type="button"
                              className={styles.tableRowButton}
                              onClick={() => setExpandedId(expanded ? null : memory.id)}
                            >
                              <span className={styles.tablePrimary}>{memory.summary}</span>
                              <span className={styles.tableSecondary}>{expanded ? '点击收起详情' : '点击展开详情'}</span>
                            </button>
                          </td>
                          <td className={styles.statusText}>{DATE_FORMATTER.format(new Date(memory.createdAt))}</td>
                          <td className={styles.mono}>{memory.sessionId}</td>
                          <td className={styles.mono}>{memory.importance.toFixed(2)}</td>
                          <td>
                            <div className={styles.chips}>
                              {memory.tags.slice(0, 3).map((tag) => (
                                <span key={`${memory.id}-${tag}`} className={styles.chip}>{tag}</span>
                              ))}
                              {memory.tags.length > 3 && (
                                <span className={styles.chip}>+{memory.tags.length - 3}</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              className={styles.dangerButton}
                              onClick={() => void handleDelete(memory.id)}
                              disabled={toolbarState.deleteDisabled}
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className={styles.expandedRow}>
                            <td colSpan={6}>
                              <div className={styles.expandedGrid}>
                                <div>
                                  <p className={styles.fieldLabel}>retrieval_text</p>
                                  <p className={styles.panelCopy}>{memory.retrievalText}</p>
                                </div>
                                <dl className={styles.metaList}>
                                  <div>
                                    <dt>ID</dt>
                                    <dd className={styles.mono}>{memory.id}</dd>
                                  </div>
                                  <div>
                                    <dt>全部标签</dt>
                                    <dd>{memory.tags.join(' / ') || '无'}</dd>
                                  </div>
                                </dl>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className={styles.pagination}>
              <span className={styles.statusText}>
                显示 {(page - 1) * PAGE_SIZE + 1} - {Math.min(page * PAGE_SIZE, total)} / {total}
              </span>
              <div className={styles.pagerGroup}>
                <button
                  type="button"
                  className={styles.pagerButton}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1 || loading}
                >
                  上一页
                </button>
                <button
                  type="button"
                  className={styles.pagerButton}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  disabled={page >= pageCount || loading}
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </section>
  )
}
