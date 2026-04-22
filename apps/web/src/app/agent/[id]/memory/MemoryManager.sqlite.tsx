'use client'

import { Fragment, useDeferredValue, useEffect, useRef, useState, useTransition } from 'react'
import PromptLab from '../PromptLab'
import styles from '../manager-ui.module.css'
import { getSqliteMemoryToolbarState } from './MemoryManager.sqlite.state'
import { getMemoryManagerSections, type MemoryManagerSectionId } from './MemoryManager.sqlite.sections'

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
  tags: string[]
  importance: number
  createdAt: string
}

interface MemorySettings {
  summarizeModel: string
  embeddingModel: string
  contextWindowMessages: number
  contextOverflowBatchSize: number
  contextIdleFlushMinutes: number
  maxShortTermMemoriesPerFlush: number
  sleepEnabled: boolean
  sleepTimeLocal: string
  sleepIntervalDays: number
  timeAnalyzerPrompt: string
  semanticAnalyzerPrompt: string
  summarizePrompt: string
  contextToShortTermPrompt: string
  shortTermToLongTermPrompt: string
  shortTermFragmentPrompt: string
  fixedFragmentPrompt: string
  consolidatePrompt: string
}

interface ConsolidationReport {
  before: number
  after: number
  kept: number
  rewritten: number
  merged: number
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
  contextWindowMessages: number
  contextOverflowBatchSize: number
  contextIdleFlushMinutes: number
  maxShortTermMemoriesPerFlush: number
  sleepEnabled: boolean
  sleepTimeLocal: string | null
  sleepIntervalDays: number
  timeAnalyzerPrompt: string | null
  semanticAnalyzerPrompt: string | null
  summarizePrompt: string | null
  contextToShortTermPrompt: string | null
  shortTermToLongTermPrompt: string | null
  shortTermFragmentPrompt: string | null
  fixedFragmentPrompt: string | null
  consolidatePrompt: string | null
  contextToShortTermPromptDefault: string
  contextToShortTermPromptEffective: string
  shortTermToLongTermPromptDefault: string
  shortTermToLongTermPromptEffective: string
  shortTermFragmentPromptDefault: string
  shortTermFragmentPromptEffective: string
  fixedFragmentPromptDefault: string
  fixedFragmentPromptEffective: string
  timeAnalyzerPromptDefault: string
  timeAnalyzerPromptEffective: string
  semanticAnalyzerPromptDefault: string
  semanticAnalyzerPromptEffective: string
  summarizePromptDefault: string
  summarizePromptEffective: string
  consolidatePromptDefault: string
  consolidatePromptEffective: string
  context: ContextSummary
  sleep: SleepSummary
}

const MEMORY_LAYER_LABELS: Record<SqliteMemory['layer'], string> = {
  short_term: '短期记忆',
  long_term: '长期记忆',
  fixed: '固化记忆',
}

const MEMORY_MANAGER_SECTIONS = getMemoryManagerSections()

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
    contextWindowMessages: typeof data.contextWindowMessages === 'number' ? data.contextWindowMessages : 50,
    contextOverflowBatchSize: typeof data.contextOverflowBatchSize === 'number' ? data.contextOverflowBatchSize : 25,
    contextIdleFlushMinutes: typeof data.contextIdleFlushMinutes === 'number' ? data.contextIdleFlushMinutes : 30,
    maxShortTermMemoriesPerFlush: typeof data.maxShortTermMemoriesPerFlush === 'number' ? data.maxShortTermMemoriesPerFlush : 3,
    sleepEnabled: typeof data.sleepEnabled === 'boolean' ? data.sleepEnabled : true,
    sleepTimeLocal: typeof data.sleepTimeLocal === 'string' ? data.sleepTimeLocal : '03:00',
    sleepIntervalDays: typeof data.sleepIntervalDays === 'number' ? data.sleepIntervalDays : 1,
    timeAnalyzerPrompt: typeof data.timeAnalyzerPrompt === 'string' ? data.timeAnalyzerPrompt : '',
    semanticAnalyzerPrompt: typeof data.semanticAnalyzerPrompt === 'string' ? data.semanticAnalyzerPrompt : '',
    summarizePrompt: typeof data.summarizePrompt === 'string' ? data.summarizePrompt : '',
    contextToShortTermPrompt: typeof data.contextToShortTermPrompt === 'string' ? data.contextToShortTermPrompt : '',
    shortTermToLongTermPrompt: typeof data.shortTermToLongTermPrompt === 'string' ? data.shortTermToLongTermPrompt : '',
    shortTermFragmentPrompt: typeof data.shortTermFragmentPrompt === 'string' ? data.shortTermFragmentPrompt : '',
    fixedFragmentPrompt: typeof data.fixedFragmentPrompt === 'string' ? data.fixedFragmentPrompt : '',
    consolidatePrompt: typeof data.consolidatePrompt === 'string' ? data.consolidatePrompt : '',
  }
}

function normalizePromptDefaults(data: Partial<MemoryListResponse>): Pick<
  MemorySettings,
  'timeAnalyzerPrompt'
  | 'semanticAnalyzerPrompt'
  | 'summarizePrompt'
  | 'contextToShortTermPrompt'
  | 'shortTermToLongTermPrompt'
  | 'shortTermFragmentPrompt'
  | 'fixedFragmentPrompt'
  | 'consolidatePrompt'
> {
  return {
    timeAnalyzerPrompt: typeof data.timeAnalyzerPromptDefault === 'string' ? data.timeAnalyzerPromptDefault : '',
    semanticAnalyzerPrompt: typeof data.semanticAnalyzerPromptDefault === 'string' ? data.semanticAnalyzerPromptDefault : '',
    summarizePrompt: typeof data.summarizePromptDefault === 'string' ? data.summarizePromptDefault : '',
    contextToShortTermPrompt: typeof data.contextToShortTermPromptDefault === 'string' ? data.contextToShortTermPromptDefault : '',
    shortTermToLongTermPrompt: typeof data.shortTermToLongTermPromptDefault === 'string' ? data.shortTermToLongTermPromptDefault : '',
    shortTermFragmentPrompt: typeof data.shortTermFragmentPromptDefault === 'string' ? data.shortTermFragmentPromptDefault : '',
    fixedFragmentPrompt: typeof data.fixedFragmentPromptDefault === 'string' ? data.fixedFragmentPromptDefault : '',
    consolidatePrompt: typeof data.consolidatePromptDefault === 'string' ? data.consolidatePromptDefault : '',
  }
}

function normalizeEffectivePrompts(data: Partial<MemoryListResponse>): Pick<
  MemorySettings,
  'timeAnalyzerPrompt'
  | 'semanticAnalyzerPrompt'
  | 'summarizePrompt'
  | 'contextToShortTermPrompt'
  | 'shortTermToLongTermPrompt'
  | 'shortTermFragmentPrompt'
  | 'fixedFragmentPrompt'
  | 'consolidatePrompt'
> {
  return {
    timeAnalyzerPrompt: typeof data.timeAnalyzerPromptEffective === 'string' ? data.timeAnalyzerPromptEffective : '',
    semanticAnalyzerPrompt: typeof data.semanticAnalyzerPromptEffective === 'string' ? data.semanticAnalyzerPromptEffective : '',
    summarizePrompt: typeof data.summarizePromptEffective === 'string' ? data.summarizePromptEffective : '',
    contextToShortTermPrompt: typeof data.contextToShortTermPromptEffective === 'string' ? data.contextToShortTermPromptEffective : '',
    shortTermToLongTermPrompt: typeof data.shortTermToLongTermPromptEffective === 'string' ? data.shortTermToLongTermPromptEffective : '',
    shortTermFragmentPrompt: typeof data.shortTermFragmentPromptEffective === 'string' ? data.shortTermFragmentPromptEffective : '',
    fixedFragmentPrompt: typeof data.fixedFragmentPromptEffective === 'string' ? data.fixedFragmentPromptEffective : '',
    consolidatePrompt: typeof data.consolidatePromptEffective === 'string' ? data.consolidatePromptEffective : '',
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
  const [savedOverrides, setSavedOverrides] = useState<MemorySettings>(() => normalizeSettings({}))
  const [defaultPrompts, setDefaultPrompts] = useState<Pick<
    MemorySettings,
    | 'timeAnalyzerPrompt'
    | 'semanticAnalyzerPrompt'
    | 'summarizePrompt'
    | 'contextToShortTermPrompt'
    | 'shortTermToLongTermPrompt'
    | 'shortTermFragmentPrompt'
    | 'fixedFragmentPrompt'
    | 'consolidatePrompt'
  >>(() => normalizePromptDefaults({}))
  const [draftSettings, setDraftSettings] = useState<MemorySettings>(() => normalizeSettings({}))
  const [contextSummary, setContextSummary] = useState<ContextSummary | null>(null)
  const [sleepSummary, setSleepSummary] = useState<SleepSummary | null>(null)
  const settingsDirtyRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [isConsolidating, setIsConsolidating] = useState(false)
  const [isFlushingContext, setIsFlushingContext] = useState(false)
  const [isSleeping, setIsSleeping] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [activeSection, setActiveSection] = useState<MemoryManagerSectionId>('context')

  const settingsDirty = !areSettingsEqual(savedSettings, draftSettings)
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const toolbarState = getSqliteMemoryToolbarState({
    loading,
    pending,
    isConsolidating,
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
      setSavedOverrides(rawSettings)
      setDefaultPrompts(normalizePromptDefaults(payload))
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

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => {
            if (right.intersectionRatio !== left.intersectionRatio) {
              return right.intersectionRatio - left.intersectionRatio
            }
            return left.boundingClientRect.top - right.boundingClientRect.top
          })

        const nextSectionId = visibleEntries[0]?.target.getAttribute('data-section-id')
        if (
          nextSectionId === 'context'
          || nextSectionId === 'sleep'
          || nextSectionId === 'prompt'
          || nextSectionId === 'memory'
        ) {
          setActiveSection(nextSectionId)
        }
      },
      {
        rootMargin: '-18% 0px -52% 0px',
        threshold: [0.12, 0.36, 0.64],
      },
    )

    const targets = MEMORY_MANAGER_SECTIONS
      .map((section) => document.getElementById(section.anchor))
      .filter((node): node is HTMLElement => node instanceof HTMLElement)

    targets.forEach((target) => observer.observe(target))

    return () => {
      targets.forEach((target) => observer.unobserve(target))
      observer.disconnect()
    }
  }, [])

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
          contextWindowMessages: draftSettings.contextWindowMessages,
          contextOverflowBatchSize: draftSettings.contextOverflowBatchSize,
          contextIdleFlushMinutes: draftSettings.contextIdleFlushMinutes,
          maxShortTermMemoriesPerFlush: draftSettings.maxShortTermMemoriesPerFlush,
          sleepEnabled: draftSettings.sleepEnabled,
          sleepTimeLocal: draftSettings.sleepTimeLocal,
          sleepIntervalDays: draftSettings.sleepIntervalDays,
          timeAnalyzerPrompt: draftSettings.timeAnalyzerPrompt.trim() === defaultPrompts.timeAnalyzerPrompt.trim()
            ? null
            : draftSettings.timeAnalyzerPrompt,
          semanticAnalyzerPrompt: draftSettings.semanticAnalyzerPrompt.trim() === defaultPrompts.semanticAnalyzerPrompt.trim()
            ? null
            : draftSettings.semanticAnalyzerPrompt,
          summarizePrompt: draftSettings.summarizePrompt.trim() === defaultPrompts.summarizePrompt.trim()
            ? null
            : draftSettings.summarizePrompt,
          contextToShortTermPrompt: draftSettings.contextToShortTermPrompt.trim() === defaultPrompts.contextToShortTermPrompt.trim()
            ? null
            : draftSettings.contextToShortTermPrompt,
          shortTermToLongTermPrompt: draftSettings.shortTermToLongTermPrompt.trim() === defaultPrompts.shortTermToLongTermPrompt.trim()
            ? null
            : draftSettings.shortTermToLongTermPrompt,
          shortTermFragmentPrompt: draftSettings.shortTermFragmentPrompt.trim() === defaultPrompts.shortTermFragmentPrompt.trim()
            ? null
            : draftSettings.shortTermFragmentPrompt,
          fixedFragmentPrompt: draftSettings.fixedFragmentPrompt.trim() === defaultPrompts.fixedFragmentPrompt.trim()
            ? null
            : draftSettings.fixedFragmentPrompt,
          consolidatePrompt: draftSettings.consolidatePrompt.trim() === defaultPrompts.consolidatePrompt.trim()
            ? null
            : draftSettings.consolidatePrompt,
        }),
      })
      const data = await response.json() as Partial<MemorySettings> & {
        error?: string
        timeAnalyzerPromptDefault?: string
        timeAnalyzerPromptEffective?: string
        semanticAnalyzerPromptDefault?: string
        semanticAnalyzerPromptEffective?: string
        summarizePromptDefault?: string
        summarizePromptEffective?: string
        contextToShortTermPromptDefault?: string
        contextToShortTermPromptEffective?: string
        shortTermToLongTermPromptDefault?: string
        shortTermToLongTermPromptEffective?: string
        shortTermFragmentPromptDefault?: string
        shortTermFragmentPromptEffective?: string
        fixedFragmentPromptDefault?: string
        fixedFragmentPromptEffective?: string
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
        timeAnalyzerPrompt: typeof data.timeAnalyzerPromptDefault === 'string' ? data.timeAnalyzerPromptDefault : current.timeAnalyzerPrompt,
        semanticAnalyzerPrompt: typeof data.semanticAnalyzerPromptDefault === 'string' ? data.semanticAnalyzerPromptDefault : current.semanticAnalyzerPrompt,
        summarizePrompt: typeof data.summarizePromptDefault === 'string' ? data.summarizePromptDefault : current.summarizePrompt,
        contextToShortTermPrompt: typeof data.contextToShortTermPromptDefault === 'string' ? data.contextToShortTermPromptDefault : current.contextToShortTermPrompt,
        shortTermToLongTermPrompt: typeof data.shortTermToLongTermPromptDefault === 'string' ? data.shortTermToLongTermPromptDefault : current.shortTermToLongTermPrompt,
        shortTermFragmentPrompt: typeof data.shortTermFragmentPromptDefault === 'string' ? data.shortTermFragmentPromptDefault : current.shortTermFragmentPrompt,
        fixedFragmentPrompt: typeof data.fixedFragmentPromptDefault === 'string' ? data.fixedFragmentPromptDefault : current.fixedFragmentPrompt,
        consolidatePrompt: typeof data.consolidatePromptDefault === 'string' ? data.consolidatePromptDefault : current.consolidatePrompt,
      }))
      setSavedSettings(normalizedEffective)
      setDraftSettings(normalizedEffective)
      settingsDirtyRef.current = false
      setNotice('记忆管线参数、模型和全部 prompt 已保存。')
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
            disabled={!settingsDirty || isConsolidating || isFlushingContext || isSleeping}
          >
            保存配置
          </button>
        </div>
      </div>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.sectionLayout}>
        <aside className={styles.sideNav} aria-label="记忆工作台导航">
          <div className={styles.sideNavHead}>
            <p className={styles.panelLabel}>导航</p>
            <h4 className={styles.sideNavTitle}>记忆工作台导航</h4>
            <p className={styles.sideNavCopy}>跳到上下文、睡眠、Prompt Lab 和记忆表，不用在长页里反复拖动。</p>
          </div>
          <nav className={styles.sideNavList}>
            {MEMORY_MANAGER_SECTIONS.map((section) => {
              const isActive = section.id === activeSection

              return (
                <a
                  key={section.id}
                  href={`#${section.anchor}`}
                  className={`${styles.sideNavLink} ${isActive ? styles.sideNavLinkActive : ''}`}
                  onClick={() => setActiveSection(section.id)}
                >
                  <span className={styles.sideNavLabel}>{section.label}</span>
                  <span className={styles.sideNavMeta}>{section.description}</span>
                </a>
              )
            })}
          </nav>
        </aside>

        <div className={styles.contentStack}>
        <section
          id="memory-section-context"
          data-section-id="context"
          className={`${styles.panel} ${styles.sectionPanel}`}
        >
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>上下文控制</p>
              <h4 className={styles.panelTitle}>Context 控制区</h4>
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
          <div className={styles.heroActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void handleFlushContext()}
              disabled={isFlushingContext || isSleeping || isConsolidating || loading}
            >
              {isFlushingContext ? '正在整理旧上下文…' : '立即整理当前旧上下文'}
            </button>
          </div>
        </section>

        <section
          id="memory-section-sleep"
          data-section-id="sleep"
          className={`${styles.panel} ${styles.sectionPanel}`}
        >
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>睡眠区</p>
              <h4 className={styles.panelTitle}>Sleep 区</h4>
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
          <div className={styles.heroActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void handleSleep()}
              disabled={isSleeping || isFlushingContext || isConsolidating || loading}
            >
              {isSleeping ? '正在执行睡眠沉淀…' : '立即睡觉'}
            </button>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.sectionPanel}`}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>模型设置</p>
              <h4 className={styles.panelTitle}>LLM & Embedding</h4>
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

        <section
          id="memory-section-prompt"
          data-section-id="prompt"
          className={styles.sectionPanel}
        >
        <PromptLab
          fields={[
            {
              key: 'timeAnalyzerPrompt',
              label: 'Time Analyzer Prompt',
              helper: '只负责提取 time_range 的 prompt。这里应该只分析“什么时候”，不要碰语义主题。',
              value: draftSettings.timeAnalyzerPrompt,
              defaultValue: defaultPrompts.timeAnalyzerPrompt,
              sourceLabel: savedOverrides.timeAnalyzerPrompt ? '自定义 override' : '系统默认',
              placeholder: '留空则使用系统默认的 time analyzer prompt。',
              rows: 7,
            },
            {
              key: 'semanticAnalyzerPrompt',
              label: 'Semantic Analyzer Prompt',
              helper: '只负责提炼 retrieval_query 和 focus 的 prompt。这里应该只分析“是什么”，不要混入时间。',
              value: draftSettings.semanticAnalyzerPrompt,
              defaultValue: defaultPrompts.semanticAnalyzerPrompt,
              sourceLabel: savedOverrides.semanticAnalyzerPrompt ? '自定义 override' : '系统默认',
              placeholder: '留空则使用系统默认的 semantic analyzer prompt。',
              rows: 7,
            },
            {
              key: 'summarizePrompt',
              label: 'Summarize Prompt',
              helper: '保留给兼容旧路径或手动整理使用。新的分层记忆主要由 Context → STM / STM → LTM 两条 prompt 驱动。',
              value: draftSettings.summarizePrompt,
              defaultValue: defaultPrompts.summarizePrompt,
              sourceLabel: savedOverrides.summarizePrompt ? '自定义 override' : '系统默认',
              placeholder: '留空则使用系统默认的 summarize prompt。',
              rows: 7,
            },
            {
              key: 'contextToShortTermPrompt',
              label: 'Context → STM Prompt',
              helper: 'daemon 从旧上下文整理短期记忆时使用。这里控制如何从一大段消息里提炼最多 N 条短期记忆。',
              value: draftSettings.contextToShortTermPrompt,
              defaultValue: defaultPrompts.contextToShortTermPrompt,
              sourceLabel: savedOverrides.contextToShortTermPrompt ? '自定义 override' : '系统默认',
              placeholder: '留空则使用系统默认的 context → short-term prompt。',
              rows: 7,
            },
            {
              key: 'shortTermToLongTermPrompt',
              label: 'STM → LTM Prompt',
              helper: '睡眠时把短期记忆沉淀成长久记忆的 prompt。这里控制如何提炼长期记忆，而不是检索逻辑。',
              value: draftSettings.shortTermToLongTermPrompt,
              defaultValue: defaultPrompts.shortTermToLongTermPrompt,
              sourceLabel: savedOverrides.shortTermToLongTermPrompt ? '自定义 override' : '系统默认',
              placeholder: '留空则使用系统默认的 short-term → long-term prompt。',
              rows: 7,
            },
            {
              key: 'shortTermFragmentPrompt',
              label: 'Short-term Fragment Prompt',
              helper: '短期记忆命中时注入主 prompt 的包装文案。未命中时系统会固定写入“短期记忆检索结果：未搜索到相关记忆”。',
              value: draftSettings.shortTermFragmentPrompt,
              defaultValue: defaultPrompts.shortTermFragmentPrompt,
              sourceLabel: savedOverrides.shortTermFragmentPrompt ? '自定义 override' : '系统默认',
              placeholder: '留空则使用系统默认的 short-term fragment prompt。',
              rows: 7,
            },
            {
              key: 'fixedFragmentPrompt',
              label: 'Fixed Fragment Prompt',
              helper: '固化记忆命中时注入主 prompt 的包装文案。未命中时系统会固定写入“固化记忆检索结果：未搜索到相关记忆”。',
              value: draftSettings.fixedFragmentPrompt,
              defaultValue: defaultPrompts.fixedFragmentPrompt,
              sourceLabel: savedOverrides.fixedFragmentPrompt ? '自定义 override' : '系统默认',
              placeholder: '留空则使用系统默认的 fixed fragment prompt。',
              rows: 7,
            },
            {
              key: 'consolidatePrompt',
              label: 'Consolidate Prompt',
              helper: '控制人工 memory consolidate 时如何 rewrite / merge / keep。它仍然只会在同 layer 内整理，不做跨层合并。',
              value: draftSettings.consolidatePrompt,
              defaultValue: defaultPrompts.consolidatePrompt,
              sourceLabel: savedOverrides.consolidatePrompt ? '自定义 override' : '系统默认',
              placeholder: '留空则使用系统默认的 consolidate prompt。',
              rows: 7,
            },
          ]}
          onChange={(key, value) => updateSetting(key as keyof MemorySettings, value)}
          onReset={(key) => {
            if (key === 'timeAnalyzerPrompt') {
              updateSetting('timeAnalyzerPrompt', defaultPrompts.timeAnalyzerPrompt)
            } else if (key === 'semanticAnalyzerPrompt') {
              updateSetting('semanticAnalyzerPrompt', defaultPrompts.semanticAnalyzerPrompt)
            } else if (key === 'summarizePrompt') {
              updateSetting('summarizePrompt', defaultPrompts.summarizePrompt)
            } else if (key === 'contextToShortTermPrompt') {
              updateSetting('contextToShortTermPrompt', defaultPrompts.contextToShortTermPrompt)
            } else if (key === 'shortTermToLongTermPrompt') {
              updateSetting('shortTermToLongTermPrompt', defaultPrompts.shortTermToLongTermPrompt)
            } else if (key === 'shortTermFragmentPrompt') {
              updateSetting('shortTermFragmentPrompt', defaultPrompts.shortTermFragmentPrompt)
            } else if (key === 'fixedFragmentPrompt') {
              updateSetting('fixedFragmentPrompt', defaultPrompts.fixedFragmentPrompt)
            } else if (key === 'consolidatePrompt') {
              updateSetting('consolidatePrompt', defaultPrompts.consolidatePrompt)
            }
          }}
        />
        </section>

      <section
        id="memory-section-memory"
        data-section-id="memory"
        className={`${styles.panel} ${styles.sectionPanel}`}
      >
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
                          <td className={styles.statusText}>{MEMORY_LAYER_LABELS[memory.layer]}</td>
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
                            <td colSpan={7}>
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
        </div>
      </div>
    </section>
  )
}
