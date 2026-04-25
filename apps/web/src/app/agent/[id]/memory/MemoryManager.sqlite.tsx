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
  layer: 'short_term' | 'long_term' | 'fixed'
  summary: string
  retrievalText: string
  importance: number
  observedStartAt: string | null
  observedEndAt: string | null
  createdAt: string
}

interface MemorySettings {
  summarizeModel: string
  embeddingModel: string
  shortTermRetrieveTopK: number
  fixedRetrieveTopK: number
  shortTermMinSimilarity: number
  fixedMinSimilarity: number
  semanticAnalyzerHistoryMessages: number
  longTermSearchDefaultTopK: number
  showNoHitMemoryFragments: boolean
  contextWindowMessages: number
  contextOverflowBatchSize: number
  contextIdleFlushMinutes: number
  maxShortTermMemoriesPerFlush: number
  sleepEnabled: boolean
  sleepTimeLocal: string
  sleepIntervalDays: number
  semanticAnalyzerPrompt: string
  contextToShortTermPrompt: string
  shortTermToLongTermPrompt: string
  shortTermFragmentPrompt: string
  fixedFragmentPrompt: string
}

interface MemoryActionResponse {
  result?: {
    ok?: boolean
    reason?: string
    createdCount?: number
    memoryIds?: string[]
    nextActiveStartMessageId?: string | null
    flushedMessageCount?: number
    deletedShortTermCount?: number
  }
}

interface ClearMemoriesResponse {
  ok?: boolean
  deletedCount?: number
  error?: string
}

interface ContextSummary {
  activeSessionId: string | null
  activeStartMessageId: string | null
  pendingFlushUntilMessageId: string | null
  activeMessageCount: number
  totalSessionMessages: number
  lastUserMessageAt: string | null
  lastContextFlushAt: string | null
}

interface SleepSummary {
  lastSleepAt: string | null
}

interface MemoryListResponse {
  memories: SqliteMemory[]
  layer: 'short_term' | 'long_term' | 'fixed' | null
  page: number
  pageSize: number
  total: number
  summarizeModel: string | null
  embeddingModel: string | null
  shortTermRetrieveTopK: number
  fixedRetrieveTopK: number
  shortTermMinSimilarity: number
  fixedMinSimilarity: number
  semanticAnalyzerHistoryMessages: number
  longTermSearchDefaultTopK: number
  showNoHitMemoryFragments: boolean
  contextWindowMessages: number
  contextOverflowBatchSize: number
  contextIdleFlushMinutes: number
  maxShortTermMemoriesPerFlush: number
  sleepEnabled: boolean
  sleepTimeLocal: string | null
  sleepIntervalDays: number
  semanticAnalyzerPrompt: string | null
  contextToShortTermPrompt: string | null
  shortTermToLongTermPrompt: string | null
  shortTermFragmentPrompt: string | null
  fixedFragmentPrompt: string | null
  contextToShortTermPromptDefault: string
  contextToShortTermPromptEffective: string
  shortTermToLongTermPromptDefault: string
  shortTermToLongTermPromptEffective: string
  shortTermFragmentPromptDefault: string
  shortTermFragmentPromptEffective: string
  fixedFragmentPromptDefault: string
  fixedFragmentPromptEffective: string
  semanticAnalyzerPromptDefault: string
  semanticAnalyzerPromptEffective: string
  context: ContextSummary
  sleep: SleepSummary
}

const MEMORY_LAYER_LABELS: Record<SqliteMemory['layer'], string> = {
  short_term: '短期记忆',
  long_term: '长期记忆',
  fixed: '固化记忆',
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

function formatDateTime(value: string) {
  return DATE_FORMATTER.format(new Date(value))
}

function formatSqliteMemoryTime(memory: SqliteMemory) {
  if (memory.layer === 'short_term') {
    if (!memory.observedStartAt || !memory.observedEndAt) {
      return '时间未知'
    }

    return `${formatDateTime(memory.observedStartAt)} - ${formatDateTime(memory.observedEndAt)}`
  }

  return formatDateTime(memory.createdAt)
}

function normalizeSettings(data: Partial<MemoryListResponse> | Partial<MemorySettings>): MemorySettings {
  return {
    summarizeModel: typeof data.summarizeModel === 'string' ? data.summarizeModel : '',
    embeddingModel: typeof data.embeddingModel === 'string' ? data.embeddingModel : '',
    shortTermRetrieveTopK: typeof data.shortTermRetrieveTopK === 'number' ? data.shortTermRetrieveTopK : 5,
    fixedRetrieveTopK: typeof data.fixedRetrieveTopK === 'number' ? data.fixedRetrieveTopK : 5,
    shortTermMinSimilarity: typeof data.shortTermMinSimilarity === 'number' ? data.shortTermMinSimilarity : 0.6,
    fixedMinSimilarity: typeof data.fixedMinSimilarity === 'number' ? data.fixedMinSimilarity : 0.6,
    semanticAnalyzerHistoryMessages: typeof data.semanticAnalyzerHistoryMessages === 'number' ? data.semanticAnalyzerHistoryMessages : 6,
    longTermSearchDefaultTopK: typeof data.longTermSearchDefaultTopK === 'number' ? data.longTermSearchDefaultTopK : 3,
    showNoHitMemoryFragments: typeof data.showNoHitMemoryFragments === 'boolean' ? data.showNoHitMemoryFragments : true,
    contextWindowMessages: typeof data.contextWindowMessages === 'number' ? data.contextWindowMessages : 50,
    contextOverflowBatchSize: typeof data.contextOverflowBatchSize === 'number' ? data.contextOverflowBatchSize : 25,
    contextIdleFlushMinutes: typeof data.contextIdleFlushMinutes === 'number' ? data.contextIdleFlushMinutes : 30,
    maxShortTermMemoriesPerFlush: typeof data.maxShortTermMemoriesPerFlush === 'number' ? data.maxShortTermMemoriesPerFlush : 3,
    sleepEnabled: typeof data.sleepEnabled === 'boolean' ? data.sleepEnabled : true,
    sleepTimeLocal: typeof data.sleepTimeLocal === 'string' ? data.sleepTimeLocal : '03:00',
    sleepIntervalDays: typeof data.sleepIntervalDays === 'number' ? data.sleepIntervalDays : 1,
    semanticAnalyzerPrompt: typeof data.semanticAnalyzerPrompt === 'string' ? data.semanticAnalyzerPrompt : '',
    contextToShortTermPrompt: typeof data.contextToShortTermPrompt === 'string' ? data.contextToShortTermPrompt : '',
    shortTermToLongTermPrompt: typeof data.shortTermToLongTermPrompt === 'string' ? data.shortTermToLongTermPrompt : '',
    shortTermFragmentPrompt: typeof data.shortTermFragmentPrompt === 'string' ? data.shortTermFragmentPrompt : '',
    fixedFragmentPrompt: typeof data.fixedFragmentPrompt === 'string' ? data.fixedFragmentPrompt : '',
  }
}

function normalizeEffectivePrompts(data: Partial<MemoryListResponse>): Pick<
  MemorySettings,
  'semanticAnalyzerPrompt'
  | 'contextToShortTermPrompt'
  | 'shortTermToLongTermPrompt'
  | 'shortTermFragmentPrompt'
  | 'fixedFragmentPrompt'
> {
  return {
    semanticAnalyzerPrompt: typeof data.semanticAnalyzerPromptEffective === 'string' ? data.semanticAnalyzerPromptEffective : '',
    contextToShortTermPrompt: typeof data.contextToShortTermPromptEffective === 'string' ? data.contextToShortTermPromptEffective : '',
    shortTermToLongTermPrompt: typeof data.shortTermToLongTermPromptEffective === 'string' ? data.shortTermToLongTermPromptEffective : '',
    shortTermFragmentPrompt: typeof data.shortTermFragmentPromptEffective === 'string' ? data.shortTermFragmentPromptEffective : '',
    fixedFragmentPrompt: typeof data.fixedFragmentPromptEffective === 'string' ? data.fixedFragmentPromptEffective : '',
  }
}

function areSettingsEqual(left: MemorySettings, right: MemorySettings) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function formatOptionalDate(value: string | null | undefined) {
  if (!value) {
    return '无'
  }

  return DATE_FORMATTER.format(new Date(value))
}

export default function MemoryManagerSqlite({ agentId }: MemoryManagerProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [layerFilter, setLayerFilter] = useState<'all' | SqliteMemory['layer']>('all')
  const [page, setPage] = useState(1)
  const [memories, setMemories] = useState<SqliteMemory[]>([])
  const [total, setTotal] = useState(0)
  const [savedSettings, setSavedSettings] = useState<MemorySettings>(() => normalizeSettings({}))
  const [draftSettings, setDraftSettings] = useState<MemorySettings>(() => normalizeSettings({}))
  const [contextSummary, setContextSummary] = useState<ContextSummary | null>(null)
  const [sleepSummary, setSleepSummary] = useState<SleepSummary | null>(null)
  const settingsDirtyRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [isFlushingContext, setIsFlushingContext] = useState(false)
  const [isSleeping, setIsSleeping] = useState(false)
  const [isClearingMemories, setIsClearingMemories] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const settingsDirty = !areSettingsEqual(savedSettings, draftSettings)
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const toolbarState = getSqliteMemoryToolbarState({
    loading,
    pending,
    memoryCount: total,
  })

  async function refresh(search = deferredQuery, nextPage = page, nextLayer = layerFilter) {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (search.trim()) {
        params.set('q', search.trim())
      }
      if (nextLayer !== 'all') {
        params.set('layer', nextLayer)
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
      setContextSummary(payload.context)
      setSleepSummary(payload.sleep)
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
    void refresh(deferredQuery, page, layerFilter)
  }, [agentId, deferredQuery, page, layerFilter])

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

  async function handleClearAllMemories() {
    if (!window.confirm('要清空当前 persona 的全部 sqlite 记忆吗？这会删除短期记忆、长期记忆和固化记忆，但不会清除聊天上下文或其他 persona 的记忆。')) {
      return
    }

    setError(null)
    setNotice(null)
    setIsClearingMemories(true)

    try {
      const response = await fetch(`/api/agents/${agentId}/memory/sqlite`, {
        method: 'DELETE',
      })
      const data = await response.json() as ClearMemoriesResponse
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '清空 sqlite 记忆失败')
      }

      const deletedCount = typeof data.deletedCount === 'number' ? data.deletedCount : 0
      setNotice(`已清空当前 persona 的 ${deletedCount} 条 sqlite 记忆。`)
      setExpandedId(null)
      setPage(1)
      startTransition(() => {
        void refresh(deferredQuery, 1, layerFilter)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空 sqlite 记忆失败')
    } finally {
      setIsClearingMemories(false)
    }
  }

  async function handleLayerChange(memoryId: string, layer: SqliteMemory['layer']) {
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(`/api/agents/${agentId}/memory/sqlite/${memoryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layer }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '更新记忆层失败')
      }

      setNotice(`已将记忆调整为${MEMORY_LAYER_LABELS[layer]}。`)
      startTransition(() => {
        void refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新记忆层失败')
    }
  }

  async function handleFlushContext() {
    setError(null)
    setNotice('正在把旧上下文整理成短期记忆…')
    setIsFlushingContext(true)

    try {
      const response = await fetch(`/api/agents/${agentId}/memory/context`, {
        method: 'POST',
      })
      const data = await response.json() as MemoryActionResponse & { error?: string; sessionId?: string }
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '整理旧上下文失败')
      }

      const result = data.result
      if (!result?.ok) {
        setNotice(`旧上下文暂时没有可整理的内容：${result?.reason ?? 'nothing_to_flush'}。`)
      } else {
        setNotice(
          `已从活跃上下文整理出 ${result.createdCount ?? 0} 条短期记忆，移出 ${result.flushedMessageCount ?? 0} 条消息。`,
        )
      }
      startTransition(() => {
        void refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '整理旧上下文失败')
      setNotice(null)
    } finally {
      setIsFlushingContext(false)
    }
  }

  async function handleSleep() {
    setError(null)
    setNotice('正在执行睡眠沉淀，把短期记忆整理进长期记忆…')
    setIsSleeping(true)

    try {
      const response = await fetch(`/api/agents/${agentId}/memory/sleep`, {
        method: 'POST',
      })
      const data = await response.json() as MemoryActionResponse & { error?: string }
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '执行睡眠沉淀失败')
      }

      const result = data.result
      if (!result?.ok) {
        setNotice(`当前无需执行睡眠沉淀：${result?.reason ?? 'not_sleep_time'}。`)
      } else {
        setNotice(
          `睡眠完成：沉淀出 ${result.createdCount ?? 0} 条长期记忆，消费 ${result.deletedShortTermCount ?? 0} 条短期记忆。`,
        )
      }
      startTransition(() => {
        void refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '执行睡眠沉淀失败')
      setNotice(null)
    } finally {
      setIsSleeping(false)
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
          shortTermRetrieveTopK: draftSettings.shortTermRetrieveTopK,
          fixedRetrieveTopK: draftSettings.fixedRetrieveTopK,
          shortTermMinSimilarity: draftSettings.shortTermMinSimilarity,
          fixedMinSimilarity: draftSettings.fixedMinSimilarity,
          semanticAnalyzerHistoryMessages: draftSettings.semanticAnalyzerHistoryMessages,
          longTermSearchDefaultTopK: draftSettings.longTermSearchDefaultTopK,
          showNoHitMemoryFragments: draftSettings.showNoHitMemoryFragments,
          contextWindowMessages: draftSettings.contextWindowMessages,
          contextOverflowBatchSize: draftSettings.contextOverflowBatchSize,
          contextIdleFlushMinutes: draftSettings.contextIdleFlushMinutes,
          maxShortTermMemoriesPerFlush: draftSettings.maxShortTermMemoriesPerFlush,
          sleepEnabled: draftSettings.sleepEnabled,
          sleepTimeLocal: draftSettings.sleepTimeLocal,
          sleepIntervalDays: draftSettings.sleepIntervalDays,
          semanticAnalyzerPrompt: draftSettings.semanticAnalyzerPrompt.trim() || null,
          contextToShortTermPrompt: draftSettings.contextToShortTermPrompt.trim() || null,
          shortTermToLongTermPrompt: draftSettings.shortTermToLongTermPrompt.trim() || null,
          shortTermFragmentPrompt: draftSettings.shortTermFragmentPrompt.trim() || null,
          fixedFragmentPrompt: draftSettings.fixedFragmentPrompt.trim() || null,
        }),
      })
      const data = await response.json() as Partial<MemorySettings> & {
        error?: string
        semanticAnalyzerPromptDefault?: string
        semanticAnalyzerPromptEffective?: string
        contextToShortTermPromptDefault?: string
        contextToShortTermPromptEffective?: string
        shortTermToLongTermPromptDefault?: string
        shortTermToLongTermPromptEffective?: string
        shortTermFragmentPromptDefault?: string
        shortTermFragmentPromptEffective?: string
        fixedFragmentPromptDefault?: string
        fixedFragmentPromptEffective?: string
      }
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '保存记忆配置失败')
      }

      const normalizedOverride = normalizeSettings(data)
      const normalizedEffective = {
        ...normalizedOverride,
        ...normalizeEffectivePrompts(data),
      }
      setSavedSettings(normalizedEffective)
      setDraftSettings(normalizedEffective)
      settingsDirtyRef.current = false
      setNotice('记忆检索参数、模型和 Prompt Lab 已保存。')
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
            这页优先把前置检索、语义分析和上下文沉淀参数摆到首屏，底部再放 Prompt Lab。
            大屏上会把记忆表拉宽，让检索控制和实际 memory rows 同时更好读。
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
            className={styles.secondaryButton}
            onClick={() => void handleFlushContext()}
            disabled={isFlushingContext || isSleeping || isClearingMemories || loading}
          >
            {isFlushingContext ? '正在整理旧上下文…' : '整理上下文'}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void handleSleep()}
            disabled={isSleeping || isFlushingContext || isClearingMemories || loading}
          >
            {isSleeping ? '正在睡觉…' : '立即睡觉'}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleSaveSettings()}
            disabled={!settingsDirty || isFlushingContext || isSleeping || isClearingMemories}
          >
            保存配置
          </button>
        </div>
      </div>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.contentStack}>
        <div className={styles.controlGrid}>
          <section className={`${styles.panel} ${styles.sectionPanel}`}>
            <div className={styles.panelHead}>
              <div>
                <p className={styles.panelLabel}>前置检索</p>
                <h4 className={styles.panelTitle}>Short-term Retrieval</h4>
              </div>
              <span className={styles.panelPill}>短期记忆</span>
            </div>
            <p className={styles.panelCopy}>
              调整短期记忆在进入主 prompt 前的载入条数和匹配阈值。
            </p>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Short-term TopK</span>
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  value={draftSettings.shortTermRetrieveTopK}
                  onChange={(event) => updateSetting('shortTermRetrieveTopK', Math.max(1, Number(event.target.value) || 1))}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Short-term Min Similarity</span>
                <input
                  className={styles.input}
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={draftSettings.shortTermMinSimilarity}
                  onChange={(event) => updateSetting('shortTermMinSimilarity', Math.min(1, Math.max(0, Number(event.target.value) || 0)))}
                />
              </label>
            </div>
          </section>

          <section className={`${styles.panel} ${styles.sectionPanel}`}>
            <div className={styles.panelHead}>
              <div>
                <p className={styles.panelLabel}>前置检索</p>
                <h4 className={styles.panelTitle}>Fixed Retrieval</h4>
              </div>
              <span className={styles.panelPill}>固化记忆</span>
            </div>
            <p className={styles.panelCopy}>
              固化记忆可以比短期记忆更保守或更宽松，避免稳定事实和近期印象互相打架。
            </p>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Fixed TopK</span>
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  value={draftSettings.fixedRetrieveTopK}
                  onChange={(event) => updateSetting('fixedRetrieveTopK', Math.max(1, Number(event.target.value) || 1))}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Fixed Min Similarity</span>
                <input
                  className={styles.input}
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={draftSettings.fixedMinSimilarity}
                  onChange={(event) => updateSetting('fixedMinSimilarity', Math.min(1, Math.max(0, Number(event.target.value) || 0)))}
                />
              </label>
            </div>
          </section>

          <section className={`${styles.panel} ${styles.sectionPanel}`}>
            <div className={styles.panelHead}>
              <div>
                <p className={styles.panelLabel}>语义分析</p>
                <h4 className={styles.panelTitle}>Semantic / Long-term</h4>
              </div>
              <span className={styles.panelPill}>补全 · 深搜默认值</span>
            </div>
            <p className={styles.panelCopy}>
              这里控制 semantic analyser 看多少历史，以及长期记忆 tool 未显式传参时的默认载入条数。
            </p>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Semantic History Messages</span>
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  value={draftSettings.semanticAnalyzerHistoryMessages}
                  onChange={(event) => updateSetting('semanticAnalyzerHistoryMessages', Math.max(1, Number(event.target.value) || 1))}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Long-term Default TopK</span>
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  max={5}
                  value={draftSettings.longTermSearchDefaultTopK}
                  onChange={(event) => updateSetting('longTermSearchDefaultTopK', Math.min(5, Math.max(1, Number(event.target.value) || 1)))}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>No-hit Fragments</span>
                <select
                  className={styles.input}
                  value={draftSettings.showNoHitMemoryFragments ? 'on' : 'off'}
                  onChange={(event) => updateSetting('showNoHitMemoryFragments', event.target.value === 'on')}
                >
                  <option value="on">显示“未命中”提示</option>
                  <option value="off">未命中时保持安静</option>
                </select>
              </label>
            </div>
          </section>
        </div>

        <div className={styles.controlGrid}>
          <section className={`${styles.panel} ${styles.sectionPanel}`}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>运行节奏</p>
              <h4 className={styles.panelTitle}>Context</h4>
            </div>
            <span className={styles.panelPill}>缓存 · 卸载 · 短期整理</span>
          </div>
          <p className={styles.panelCopy}>
            `context` 只存在于当前模型上下文里，不参与检索。这里控制活跃上下文窗口、空闲多久后整理为短期记忆，以及单次最多生成几条短期记忆。
          </p>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Context Window</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                value={draftSettings.contextWindowMessages}
                onChange={(event) => updateSetting('contextWindowMessages', Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Overflow Batch Size</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                value={draftSettings.contextOverflowBatchSize}
                onChange={(event) => updateSetting('contextOverflowBatchSize', Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Idle Flush Minutes</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                value={draftSettings.contextIdleFlushMinutes}
                onChange={(event) => updateSetting('contextIdleFlushMinutes', Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Max STM Per Flush</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                value={draftSettings.maxShortTermMemoriesPerFlush}
                onChange={(event) => updateSetting('maxShortTermMemoriesPerFlush', Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
          </div>
          <dl className={styles.metricList}>
            <div>
              <dt>活跃会话</dt>
              <dd className={styles.mono}>{contextSummary?.activeSessionId ?? '无'}</dd>
            </div>
            <div>
              <dt>活跃上下文消息数</dt>
              <dd>{contextSummary?.activeMessageCount ?? 0}</dd>
            </div>
            <div>
              <dt>会话消息总数</dt>
              <dd>{contextSummary?.totalSessionMessages ?? 0}</dd>
            </div>
            <div>
              <dt>活跃起点消息</dt>
              <dd className={styles.mono}>{contextSummary?.activeStartMessageId ?? '无'}</dd>
            </div>
            <div>
              <dt>待整理终点消息</dt>
              <dd className={styles.mono}>{contextSummary?.pendingFlushUntilMessageId ?? '无'}</dd>
            </div>
            <div>
              <dt>最近一次用户消息</dt>
              <dd>{formatOptionalDate(contextSummary?.lastUserMessageAt)}</dd>
            </div>
            <div>
              <dt>最近一次上下文整理</dt>
              <dd>{formatOptionalDate(contextSummary?.lastContextFlushAt)}</dd>
            </div>
          </dl>
          </section>

          <section className={`${styles.panel} ${styles.sectionPanel}`}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>运行节奏</p>
              <h4 className={styles.panelTitle}>Sleep</h4>
            </div>
            <span className={styles.panelPill}>短期沉淀 · 长期记忆</span>
          </div>
          <p className={styles.panelCopy}>
            固定每天一次“睡觉”，把短期记忆沉淀成长期记忆。第一版先使用固定本地时间和固定间隔天数，后续再做更复杂的睡眠规则。
          </p>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Sleep Enabled</span>
              <select
                className={styles.input}
                value={draftSettings.sleepEnabled ? 'on' : 'off'}
                onChange={(event) => updateSetting('sleepEnabled', event.target.value === 'on')}
              >
                <option value="on">启用</option>
                <option value="off">关闭</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Sleep Time</span>
              <input
                className={styles.input}
                value={draftSettings.sleepTimeLocal}
                onChange={(event) => updateSetting('sleepTimeLocal', event.target.value)}
                placeholder="03:00"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Sleep Interval Days</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                value={draftSettings.sleepIntervalDays}
                onChange={(event) => updateSetting('sleepIntervalDays', Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
          </div>
          <dl className={styles.metricList}>
            <div>
              <dt>最近一次睡眠</dt>
              <dd>{formatOptionalDate(sleepSummary?.lastSleepAt)}</dd>
            </div>
          </dl>
          </section>

          <section className={`${styles.panel} ${styles.sectionPanel}`}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>模型设置</p>
              <h4 className={styles.panelTitle}>Memory Models</h4>
            </div>
            <span className={styles.panelPill}>前置检索 · 深搜工具 · 沉淀整理</span>
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
        </div>

        <section className={`${styles.panel} ${styles.sectionPanel}`}>
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
              placeholder="按摘要或检索文本搜索"
            />
          </label>

          <label className={styles.searchField}>
            <span className={styles.fieldLabel}>层级</span>
            <select
              className={styles.searchInput}
              value={layerFilter}
              onChange={(event) => {
                setLayerFilter(event.target.value as 'all' | SqliteMemory['layer'])
                setPage(1)
              }}
            >
              <option value="all">全部层级</option>
              <option value="short_term">短期记忆</option>
              <option value="long_term">长期记忆</option>
              <option value="fixed">固化记忆</option>
            </select>
          </label>

          <div className={styles.toolbarActions}>
            <span className={styles.statusText}>
              当前结果 {memories.length} / 总数 {total}
              {deferredQuery.trim() ? ` · 搜索词：${deferredQuery.trim()}` : ''}
              {layerFilter !== 'all' ? ` · 层级：${MEMORY_LAYER_LABELS[layerFilter]}` : ''}
            </span>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => void handleClearAllMemories()}
              disabled={isClearingMemories || isFlushingContext || isSleeping || loading}
            >
              {isClearingMemories ? '正在清空…' : '清空全部记忆'}
            </button>
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
                    <th>层级</th>
                    <th>时间</th>
                    <th>会话</th>
                    <th>重要性</th>
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
                          <td className={styles.statusText}>{MEMORY_LAYER_LABELS[memory.layer]}</td>
                          <td className={styles.statusText}>{formatSqliteMemoryTime(memory)}</td>
                          <td className={styles.mono}>{memory.sessionId}</td>
                          <td className={styles.mono}>{memory.importance.toFixed(2)}</td>
                          <td>
                            <button
                              type="button"
                              className={styles.dangerButton}
                              onClick={() => void handleDelete(memory.id)}
                              disabled={toolbarState.deleteDisabled || isClearingMemories}
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
                                    <dt>生成时间</dt>
                                    <dd className={styles.statusText}>{formatDateTime(memory.createdAt)}</dd>
                                  </div>
                                  <div>
                                    <dt>层级</dt>
                                    <dd>
                                      <select
                                        className={styles.input}
                                        value={memory.layer}
                                        onChange={(event) => void handleLayerChange(memory.id, event.target.value as SqliteMemory['layer'])}
                                      >
                                        <option value="short_term">短期记忆</option>
                                        <option value="long_term">长期记忆</option>
                                        <option value="fixed">固化记忆</option>
                                      </select>
                                    </dd>
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

        <section className={styles.sectionPanel}>
          <PromptLab
            fields={[
              {
                key: 'semanticAnalyzerPrompt',
                label: 'Semantic Analyzer Prompt',
                helper: '只负责提炼 retrieval_query 的 prompt。这里应该只分析“是什么”，不要混入时间。',
                value: draftSettings.semanticAnalyzerPrompt,
                placeholder: '清空后保存会回退系统默认的 semantic analyzer prompt。',
                rows: 7,
              },
              {
                key: 'contextToShortTermPrompt',
                label: 'Context → STM Prompt',
                helper: 'daemon 从旧上下文整理短期记忆时使用。这里控制如何从一大段消息里提炼最多 N 条短期记忆。',
                value: draftSettings.contextToShortTermPrompt,
                placeholder: '清空后保存会回退系统默认的 context → short-term prompt。',
                rows: 7,
              },
              {
                key: 'shortTermToLongTermPrompt',
                label: 'STM → LTM Prompt',
                helper: '睡眠时把短期记忆沉淀成长久记忆的 prompt。这里控制如何提炼长期记忆，而不是检索逻辑。',
                value: draftSettings.shortTermToLongTermPrompt,
                placeholder: '清空后保存会回退系统默认的 short-term → long-term prompt。',
                rows: 7,
              },
              {
                key: 'shortTermFragmentPrompt',
                label: 'Short-term Fragment Prompt',
                helper: '短期记忆命中时注入主 prompt 的包装文案。是否显示未命中提示由上面的 No-hit Fragments 开关决定。',
                value: draftSettings.shortTermFragmentPrompt,
                placeholder: '清空后保存会回退系统默认的 short-term fragment prompt。',
                rows: 7,
              },
              {
                key: 'fixedFragmentPrompt',
                label: 'Fixed Fragment Prompt',
                helper: '固化记忆命中时注入主 prompt 的包装文案。是否显示未命中提示由上面的 No-hit Fragments 开关决定。',
                value: draftSettings.fixedFragmentPrompt,
                placeholder: '清空后保存会回退系统默认的 fixed fragment prompt。',
                rows: 7,
              },
            ]}
            onChange={(key, value) => updateSetting(key as keyof MemorySettings, value)}
          />
        </section>
      </div>
    </section>
  )
}
