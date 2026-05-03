'use client'

import { Fragment, type FormEvent, useDeferredValue, useEffect, useRef, useState, useTransition } from 'react'
import PromptLab from '../PromptLab'
import { DEFAULT_PROMPT_TEST_INPUTS } from '../PromptTestPanel'
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

interface MemoryRow {
  kind: 'sqlite' | 'episodic'
  id: string
  sessionId: string
  layer: 'short_term' | 'long_term' | 'fixed' | 'episodic'
  detail: string
  retrievalText: string
  episodicDetail: string | null
  retrievalModel: string
  hasEmbedding: boolean
  embeddingDimensions: number
  importance: number
  observedStartAt: string | null
  observedEndAt: string | null
  createdAt: string
  entities: EpisodicEntityLink[]
}

type ManagedSqliteLayer = 'short_term' | 'fixed' | 'episodic'
type EditableMemoryLayer = 'short_term' | 'fixed'

interface EpisodicEntityLink {
  id: string
  type: string
  canonicalName: string
  weight: number
}

interface EntityNode {
  id: string
  type: string
  canonicalName: string
  description: string | null
  confidence: number
  aliases: string[]
  episodicMemoryCount: number
  createdAt: string
  lastSeenAt: string | null
}

type EditableEntityType = 'person' | 'place' | 'object' | 'event'

interface EntityEdge {
  sourceEntityId: string
  sourceCanonicalName: string
  targetEntityId: string
  targetCanonicalName: string
  weight: number
  coOccurrenceCount: number
  lastSeenAt: string
}

interface PageSlice<T> {
  total: number
  page: number
  pageSize: number
  items: T[]
}

interface EntityGraphSummary {
  total: number
  nodes: PageSlice<EntityNode>
  edges: PageSlice<EntityEdge>
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
  entityMentionPrompt: string
  episodicExtractionPrompt: string
  entityResolutionPrompt: string
  shortTermFragmentPrompt: string
  fixedFragmentPrompt: string
}

interface MemoryActionResponse {
  result?: {
    ok?: boolean
    reason?: string
    createdCount?: number
    createdEntityCount?: number
    createdEpisodicCount?: number
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
  rows: MemoryRow[]
  memories?: MemoryRow[]
  layer: 'short_term' | 'long_term' | 'fixed' | 'episodic' | null
  legacyLayers?: string[]
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
  entityMentionPrompt: string | null
  episodicExtractionPrompt: string | null
  entityResolutionPrompt: string | null
  shortTermFragmentPrompt: string | null
  fixedFragmentPrompt: string | null
  contextToShortTermPromptDefault: string
  contextToShortTermPromptEffective: string
  entityMentionPromptDefault: string
  entityMentionPromptEffective: string
  episodicExtractionPromptDefault: string
  episodicExtractionPromptEffective: string
  entityResolutionPromptDefault: string
  entityResolutionPromptEffective: string
  shortTermFragmentPromptDefault: string
  shortTermFragmentPromptEffective: string
  fixedFragmentPromptDefault: string
  fixedFragmentPromptEffective: string
  semanticAnalyzerPromptDefault: string
  semanticAnalyzerPromptEffective: string
  context: ContextSummary
  sleep: SleepSummary
  entities?: EntityGraphSummary
}

const MEMORY_LAYER_LABELS: Record<MemoryRow['layer'], string> = {
  short_term: '短期记忆',
  long_term: '旧长期层',
  fixed: '固化记忆',
  episodic: '情景记忆',
}

const ENTITY_TYPE_OPTIONS: Array<{ value: EditableEntityType; label: string }> = [
  { value: 'person', label: '人物' },
  { value: 'place', label: '地点' },
  { value: 'object', label: '物品' },
  { value: 'event', label: '事件' },
]

const EMPTY_ENTITY_GRAPH_SUMMARY: EntityGraphSummary = {
  total: 0,
  nodes: { total: 0, page: 1, pageSize: 10, items: [] },
  edges: { total: 0, page: 1, pageSize: 10, items: [] },
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
const GRAPH_PAGE_SIZE = 10
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

function formatSqliteMemoryTime(memory: MemoryRow) {
  if (memory.layer === 'episodic') {
    return formatObservedRange(memory.observedStartAt, memory.observedEndAt)
  }
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
    entityMentionPrompt: typeof data.entityMentionPrompt === 'string' ? data.entityMentionPrompt : '',
    episodicExtractionPrompt: typeof data.episodicExtractionPrompt === 'string' ? data.episodicExtractionPrompt : '',
    entityResolutionPrompt: typeof data.entityResolutionPrompt === 'string' ? data.entityResolutionPrompt : '',
    shortTermFragmentPrompt: typeof data.shortTermFragmentPrompt === 'string' ? data.shortTermFragmentPrompt : '',
    fixedFragmentPrompt: typeof data.fixedFragmentPrompt === 'string' ? data.fixedFragmentPrompt : '',
  }
}

function normalizeEffectivePrompts(data: Partial<MemoryListResponse>): Pick<
  MemorySettings,
  'semanticAnalyzerPrompt'
  | 'contextToShortTermPrompt'
  | 'entityMentionPrompt'
  | 'episodicExtractionPrompt'
  | 'entityResolutionPrompt'
  | 'shortTermFragmentPrompt'
  | 'fixedFragmentPrompt'
> {
  return {
    semanticAnalyzerPrompt: typeof data.semanticAnalyzerPromptEffective === 'string' ? data.semanticAnalyzerPromptEffective : '',
    contextToShortTermPrompt: typeof data.contextToShortTermPromptEffective === 'string' ? data.contextToShortTermPromptEffective : '',
    entityMentionPrompt: typeof data.entityMentionPromptEffective === 'string' ? data.entityMentionPromptEffective : '',
    episodicExtractionPrompt: typeof data.episodicExtractionPromptEffective === 'string' ? data.episodicExtractionPromptEffective : '',
    entityResolutionPrompt: typeof data.entityResolutionPromptEffective === 'string' ? data.entityResolutionPromptEffective : '',
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

function formatObservedRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) {
    return '时间未知'
  }

  return `${formatDateTime(start)} - ${formatDateTime(end)}`
}

function formatEntityType(type: string) {
  switch (type) {
    case 'person':
      return '人物'
    case 'place':
      return '地点'
    case 'object':
      return '物品'
    case 'event':
      return '事件'
    default:
      return '物品'
  }
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function fromDateTimeLocal(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  return new Date(value).toISOString()
}

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function readFormNumber(formData: FormData, key: string, fallback: number) {
  const value = Number(readFormString(formData, key))
  return Number.isFinite(value) ? value : fallback
}

function splitListText(value: string) {
  return [...new Set(value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean))]
}

function parseEntityLinksText(value: string) {
  if (!value.trim()) {
    return []
  }

  return value
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [entityId, rawWeight] = line.split(/[:：,\s]+/).map((item) => item.trim()).filter(Boolean)
      return {
        entityId,
        weight: Math.min(1, Math.max(0.3, Number(rawWeight) || 1)),
      }
    })
    .filter((link) => link.entityId)
    .slice(0, 5)
}

function entityLinksToText(links: EpisodicEntityLink[]) {
  return links.map((link) => `${link.id}:${link.weight}`).join('\n')
}

export default function MemoryManagerSqlite({ agentId }: MemoryManagerProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [graphQuery, setGraphQuery] = useState('')
  const deferredGraphQuery = useDeferredValue(graphQuery)
  const [layerFilter, setLayerFilter] = useState<'all' | ManagedSqliteLayer>('all')
  const [page, setPage] = useState(1)
  const [nodePage, setNodePage] = useState(1)
  const [edgePage, setEdgePage] = useState(1)
  const [memoryRows, setMemoryRows] = useState<MemoryRow[]>([])
  const [entityGraphSummary, setEntityGraphSummary] = useState<EntityGraphSummary>(EMPTY_ENTITY_GRAPH_SUMMARY)
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
  const [isSavingMemoryEdit, setIsSavingMemoryEdit] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const settingsDirty = !areSettingsEqual(savedSettings, draftSettings)
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const nodePageCount = Math.max(1, Math.ceil(entityGraphSummary.nodes.total / entityGraphSummary.nodes.pageSize))
  const edgePageCount = Math.max(1, Math.ceil(entityGraphSummary.edges.total / entityGraphSummary.edges.pageSize))
  const nodeRangeStart = entityGraphSummary.nodes.total === 0 ? 0 : (entityGraphSummary.nodes.page - 1) * entityGraphSummary.nodes.pageSize + 1
  const nodeRangeEnd = Math.min(entityGraphSummary.nodes.page * entityGraphSummary.nodes.pageSize, entityGraphSummary.nodes.total)
  const edgeRangeStart = entityGraphSummary.edges.total === 0 ? 0 : (entityGraphSummary.edges.page - 1) * entityGraphSummary.edges.pageSize + 1
  const edgeRangeEnd = Math.min(entityGraphSummary.edges.page * entityGraphSummary.edges.pageSize, entityGraphSummary.edges.total)
  const toolbarState = getSqliteMemoryToolbarState({
    loading,
    pending,
    memoryCount: total,
  })

  async function refresh(
    search = deferredQuery,
    nextPage = page,
    nextLayer: 'all' | ManagedSqliteLayer = layerFilter,
    nextGraphQuery = deferredGraphQuery,
    nextNodePage = nodePage,
    nextEdgePage = edgePage,
  ) {
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
      if (nextGraphQuery.trim()) {
        params.set('graphQ', nextGraphQuery.trim())
      }
      params.set('nodePage', String(nextNodePage))
      params.set('edgePage', String(nextEdgePage))
      params.set('graphPageSize', String(GRAPH_PAGE_SIZE))

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
      setMemoryRows(Array.isArray(payload.rows) ? payload.rows : (Array.isArray(payload.memories) ? payload.memories : []))
      setEntityGraphSummary(payload.entities ?? EMPTY_ENTITY_GRAPH_SUMMARY)
      setTotal(typeof payload.total === 'number' ? payload.total : 0)
      setPage(typeof payload.page === 'number' ? payload.page : nextPage)
      setSavedSettings(settings)
      setContextSummary(payload.context)
      setSleepSummary(payload.sleep)
      if (!settingsDirtyRef.current) {
        setDraftSettings(settings)
      }
      if (expandedId && !(payload.rows ?? payload.memories ?? []).some((memory) => memory.id === expandedId)) {
        setExpandedId(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 sqlite 记忆失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh(deferredQuery, page, layerFilter, deferredGraphQuery, nodePage, edgePage)
  }, [agentId, deferredQuery, page, layerFilter, deferredGraphQuery, nodePage, edgePage])

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
    if (!window.confirm('要清空当前 persona 的全部 sqlite 记忆吗？这会删除短期记忆、旧长期层和固化记忆，但不会清除聊天上下文、情景记忆或其他 persona 的记忆。')) {
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

  async function handleLayerChange(memoryId: string, layer: EditableMemoryLayer) {
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

  async function postMemoryEdit(body: Record<string, unknown>, successMessage: string) {
    setError(null)
    setNotice(null)
    setIsSavingMemoryEdit(true)

    try {
      const response = await fetch(`/api/agents/${agentId}/memory/sqlite/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json() as { error?: string }
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '保存记忆编辑失败')
      }

      setNotice(successMessage)
      startTransition(() => {
        void refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存记忆编辑失败')
    } finally {
      setIsSavingMemoryEdit(false)
    }
  }

  function handleSaveSqliteMemory(event: FormEvent<HTMLFormElement>, memory: MemoryRow) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    void postMemoryEdit({
      action: 'sqliteMemory.update',
      memoryId: memory.id,
      layer: readFormString(formData, 'layer') || memory.layer,
      detail: readFormString(formData, 'detail'),
      retrievalText: readFormString(formData, 'retrievalText'),
      importance: readFormNumber(formData, 'importance', memory.importance),
      observedStartAt: fromDateTimeLocal(formData.get('observedStartAt')),
      observedEndAt: fromDateTimeLocal(formData.get('observedEndAt')),
    }, '已保存 STM / 固化记忆，并重新写入 embedding。')
  }

  function handleSaveEpisodicMemory(event: FormEvent<HTMLFormElement>, memory: MemoryRow) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    void postMemoryEdit({
      action: 'episodic.update',
      memoryId: memory.id,
      summary: readFormString(formData, 'summary'),
      detail: readFormString(formData, 'detail') || null,
      importance: readFormNumber(formData, 'importance', memory.importance),
      observedStartAt: fromDateTimeLocal(formData.get('observedStartAt')),
      observedEndAt: fromDateTimeLocal(formData.get('observedEndAt')),
      entityLinks: parseEntityLinksText(readFormString(formData, 'entityLinks')),
    }, '已保存情景记忆，并按 summary 重新写入 embedding。')
  }

  function handleCreateEpisodicMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    void postMemoryEdit({
      action: 'episodic.create',
      summary: readFormString(formData, 'summary'),
      detail: readFormString(formData, 'detail') || null,
      importance: readFormNumber(formData, 'importance', 0.6),
      observedStartAt: fromDateTimeLocal(formData.get('observedStartAt')),
      observedEndAt: fromDateTimeLocal(formData.get('observedEndAt')),
      entityLinks: parseEntityLinksText(readFormString(formData, 'entityLinks')),
    }, '已新增情景记忆。')
    event.currentTarget.reset()
  }

  function handleDeleteEpisodicMemory(memoryId: string) {
    if (!window.confirm('要删除这条情景记忆吗？实体节点和实体边会保留。')) {
      return
    }
    void postMemoryEdit({ action: 'episodic.delete', memoryId }, '已删除这条情景记忆。')
  }

  function handleCreateEntity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    void postMemoryEdit({
      action: 'entity.create',
      type: readFormString(formData, 'type'),
      canonicalName: readFormString(formData, 'canonicalName'),
      description: readFormString(formData, 'description') || null,
      confidence: readFormNumber(formData, 'confidence', 0.8),
      aliases: splitListText(readFormString(formData, 'aliases')),
    }, '已新增实体节点。')
    event.currentTarget.reset()
  }

  function handleSaveEntity(event: FormEvent<HTMLFormElement>, entity: EntityNode) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    void postMemoryEdit({
      action: 'entity.update',
      entityId: entity.id,
      type: readFormString(formData, 'type'),
      canonicalName: readFormString(formData, 'canonicalName'),
      description: readFormString(formData, 'description') || null,
      confidence: readFormNumber(formData, 'confidence', entity.confidence),
      aliases: splitListText(readFormString(formData, 'aliases')),
    }, '已保存实体节点，并重新写入实体 embedding。')
  }

  function handleDeleteEntity(entityId: string) {
    if (!window.confirm('要删除这个实体节点吗？相关 alias、边和情景记忆绑定会删除，但情景记忆文本会保留。')) {
      return
    }
    void postMemoryEdit({ action: 'entity.delete', entityId }, '已删除实体节点。')
  }

  function handleMergeEntity(sourceEntityId: string, targetEntityId: string) {
    if (!targetEntityId.trim() || !window.confirm('要把当前实体合并进目标实体吗？source 会被删除，alias / 情景绑定 / 边会迁移。')) {
      return
    }
    void postMemoryEdit({
      action: 'entity.merge',
      sourceEntityId,
      targetEntityId: targetEntityId.trim(),
    }, '已合并实体节点。')
  }

  function handleUpsertEdge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    void postMemoryEdit({
      action: 'edge.upsert',
      sourceEntityId: readFormString(formData, 'sourceEntityId'),
      targetEntityId: readFormString(formData, 'targetEntityId'),
      weight: readFormNumber(formData, 'weight', 0.5),
      coOccurrenceCount: Math.max(0, Math.floor(readFormNumber(formData, 'coOccurrenceCount', 0))),
    }, '已保存实体边。')
  }

  function handleDeleteEdge(edge: EntityEdge) {
    if (!window.confirm('要删除这条实体边吗？')) {
      return
    }
    void postMemoryEdit({
      action: 'edge.delete',
      sourceEntityId: edge.sourceEntityId,
      targetEntityId: edge.targetEntityId,
    }, '已删除实体边。')
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
    setNotice('正在执行睡眠沉淀，把短期记忆整理进情景记忆…')
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
          `睡眠完成：沉淀出 ${result.createdEpisodicCount ?? result.createdCount ?? 0} 条情景记忆，新增 ${result.createdEntityCount ?? 0} 个实体，消费 ${result.deletedShortTermCount ?? 0} 条短期记忆。`,
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
          entityMentionPrompt: draftSettings.entityMentionPrompt.trim() || null,
          episodicExtractionPrompt: draftSettings.episodicExtractionPrompt.trim() || null,
          entityResolutionPrompt: draftSettings.entityResolutionPrompt.trim() || null,
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
        entityMentionPromptDefault?: string
        entityMentionPromptEffective?: string
        episodicExtractionPromptDefault?: string
        episodicExtractionPromptEffective?: string
        entityResolutionPromptDefault?: string
        entityResolutionPromptEffective?: string
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
        <div className={styles.memorySettingsRail}>
          <section className={`${styles.panel} ${styles.sectionPanel} ${styles.panelFrame}`}>
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

          <section className={`${styles.panel} ${styles.sectionPanel} ${styles.panelFrame}`}>
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

          <section className={`${styles.panel} ${styles.sectionPanel} ${styles.panelFrame}`}>
            <div className={styles.panelHead}>
              <div>
                <p className={styles.panelLabel}>语义分析</p>
                <h4 className={styles.panelTitle}>Semantic / Episodic</h4>
              </div>
              <span className={styles.panelPill}>补全 · 深搜默认值</span>
            </div>
            <p className={styles.panelCopy}>
              这里控制 semantic analyser 看多少历史，以及情景记忆 tool 未显式传参时的默认载入条数。
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
                <span className={styles.fieldLabel}>Episodic Tool Default TopK</span>
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
          <section className={`${styles.panel} ${styles.sectionPanel} ${styles.panelFrame}`}>
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

          <section className={`${styles.panel} ${styles.sectionPanel} ${styles.panelFrame}`}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>运行节奏</p>
              <h4 className={styles.panelTitle}>Sleep</h4>
            </div>
            <span className={styles.panelPill}>短期沉淀 · 情景记忆</span>
          </div>
          <p className={styles.panelCopy}>
            固定每天一次“睡觉”，把短期记忆沉淀成情景记忆和实体图。第一版先使用固定本地时间和固定间隔天数，后续再做更复杂的睡眠规则。
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

          <section className={`${styles.panel} ${styles.sectionPanel} ${styles.panelFrame}`}>
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

        <section className={`${styles.sectionPanel} ${styles.graphPanel}`}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.tableLabel}>实体图</p>
              <h4 className={styles.panelTitle}>Entity Graph</h4>
            </div>
            <div className={styles.graphStats}>
              <span>{entityGraphSummary.nodes.total} 节点</span>
              <span>{entityGraphSummary.edges.total} 边</span>
            </div>
          </div>
          <p className={styles.panelCopy}>
            实体节点、alias 和无类型权重边都由后台 merge/consolidation 维护。这里单独查询和分页，不再一次性渲染整张图。
          </p>
          <div className={styles.graphToolbar}>
            <label className={`${styles.searchField} ${styles.graphSearchField}`}>
              <span className={styles.fieldLabel}>查询节点和边</span>
              <input
                className={styles.searchInput}
                value={graphQuery}
                onChange={(event) => {
                  setGraphQuery(event.target.value)
                  setNodePage(1)
                  setEdgePage(1)
                }}
                placeholder="按实体名、alias 或边两端搜索"
              />
            </label>
            <span className={styles.graphQueryState}>
              {deferredGraphQuery.trim() ? `图谱搜索：${deferredGraphQuery.trim()}` : '显示最近节点和最高权重边'}
            </span>
          </div>

          <details className={styles.editBlock}>
            <summary>新增实体节点</summary>
            <form className={styles.editForm} onSubmit={handleCreateEntity}>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>名称</span>
                  <input className={styles.input} name="canonicalName" required placeholder="例如 星际争霸2" />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>类型</span>
                  <select className={styles.input} name="type" defaultValue="object">
                    {ENTITY_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>置信度</span>
                  <input className={styles.input} name="confidence" type="number" min={0} max={1} step={0.01} defaultValue={0.8} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>alias（逗号或换行分隔）</span>
                  <textarea className={styles.textarea} name="aliases" rows={2} placeholder="星际2&#10;SC2" />
                </label>
                <label className={styles.wideField}>
                  <span className={styles.fieldLabel}>描述</span>
                  <textarea className={styles.textarea} name="description" rows={2} placeholder="这个节点在个人记忆图中的含义" />
                </label>
              </div>
              <div className={styles.inlineActions}>
                <button type="submit" className={styles.primaryButton} disabled={isSavingMemoryEdit}>新增实体</button>
              </div>
            </form>
          </details>

          <div className={styles.graphGrid}>
            <div className={styles.graphColumn}>
              <div className={styles.graphColumnHead}>
                <div>
                  <p className={styles.panelLabel}>Nodes</p>
                  <h4 className={styles.panelTitle}>实体节点</h4>
                </div>
                <span className={styles.graphPagePill}>第 {entityGraphSummary.nodes.page} / {nodePageCount} 页</span>
              </div>
              {entityGraphSummary.nodes.items.length === 0 ? (
                <div className={styles.graphEmpty}>{deferredGraphQuery.trim() ? '当前查询没有实体节点。' : '还没有实体节点。'}</div>
              ) : (
                <div className={styles.graphList}>
                  {entityGraphSummary.nodes.items.map((entity) => (
                    <article key={entity.id} className={styles.graphNodeRow}>
                      <div className={styles.graphNodeMain}>
                        <div className={styles.graphNodeRead}>
                          <div className={styles.graphNodeTitleLine}>
                            <strong>{entity.canonicalName}</strong>
                            <span className={styles.graphTypeBadge}>{formatEntityType(entity.type)}</span>
                            <span className={styles.graphConfidence}>置信度 {entity.confidence.toFixed(2)}</span>
                          </div>
                          {entity.description && <p className={styles.graphDescription}>{entity.description}</p>}
                          <div className={styles.graphAliasLine}>
                            {entity.aliases.length === 0 ? (
                              <span>无 alias</span>
                            ) : entity.aliases.map((alias) => (
                              <span key={`${entity.id}-${alias}`}>{alias}</span>
                            ))}
                          </div>
                        </div>
                        <details className={styles.rowEditDetails}>
                          <summary>编辑节点</summary>
                          <form className={styles.entityEditForm} onSubmit={(event) => handleSaveEntity(event, entity)}>
                            <div className={styles.graphNodeTitleLine}>
                              <input className={styles.input} name="canonicalName" defaultValue={entity.canonicalName} required />
                              <select className={styles.input} name="type" defaultValue={entity.type}>
                                {ENTITY_TYPE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>
                            <textarea className={styles.textarea} name="description" rows={2} defaultValue={entity.description ?? ''} placeholder="实体描述" />
                            <textarea className={styles.textarea} name="aliases" rows={2} defaultValue={entity.aliases.join('\n')} placeholder="alias，每行一个" />
                            <div className={styles.inlineActions}>
                              <label className={styles.inlineField}>
                                <span>置信度</span>
                                <input className={styles.input} name="confidence" type="number" min={0} max={1} step={0.01} defaultValue={entity.confidence} />
                              </label>
                              <button type="submit" className={styles.primaryButton} disabled={isSavingMemoryEdit}>保存节点</button>
                              <button type="button" className={styles.dangerButton} onClick={() => handleDeleteEntity(entity.id)} disabled={isSavingMemoryEdit}>删除</button>
                            </div>
                            <div className={styles.mergeLine}>
                              <input className={styles.input} name="mergeTargetEntityId" placeholder="目标 entity id" />
                              <button
                                type="button"
                                className={styles.secondaryButton}
                                disabled={isSavingMemoryEdit}
                                onClick={(event) => {
                                  const form = event.currentTarget.form
                                  const target = form ? readFormString(new FormData(form), 'mergeTargetEntityId') : ''
                                  handleMergeEntity(entity.id, target)
                                }}
                              >
                                合并到目标
                              </button>
                            </div>
                          </form>
                        </details>
                      </div>
                      <div className={styles.graphNodeMeta}>
                        <span className={styles.mono} title={entity.id}>{shortId(entity.id)}</span>
                        <span>{entity.episodicMemoryCount} 情景</span>
                        <span>{formatOptionalDate(entity.lastSeenAt)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <div className={styles.graphPagination}>
                <span>{nodeRangeStart}-{nodeRangeEnd} / {entityGraphSummary.nodes.total} 节点</span>
                <div className={styles.pagerGroup}>
                  <button type="button" className={styles.pagerButton} onClick={() => setNodePage((current) => Math.max(1, current - 1))} disabled={nodePage <= 1 || loading}>上一页</button>
                  <button type="button" className={styles.pagerButton} onClick={() => setNodePage((current) => current + 1)} disabled={nodePage >= nodePageCount || loading}>下一页</button>
                </div>
              </div>
            </div>

            <div className={styles.graphColumn}>
              <div className={styles.graphColumnHead}>
                <div>
                  <p className={styles.panelLabel}>Edges</p>
                  <h4 className={styles.panelTitle}>无类型权重边</h4>
                </div>
                <span className={styles.graphPagePill}>第 {entityGraphSummary.edges.page} / {edgePageCount} 页</span>
              </div>
              <details className={styles.rowEditDetails}>
                <summary>新增边</summary>
                <form className={styles.edgeEditForm} onSubmit={handleUpsertEdge}>
                  <input className={styles.input} name="sourceEntityId" placeholder="source entity id" required />
                  <input className={styles.input} name="targetEntityId" placeholder="target entity id" required />
                  <input className={styles.input} name="weight" type="number" min={0} max={1} step={0.01} defaultValue={0.5} />
                  <input className={styles.input} name="coOccurrenceCount" type="number" min={0} step={1} defaultValue={0} />
                  <button type="submit" className={styles.secondaryButton} disabled={isSavingMemoryEdit}>保存边</button>
                </form>
              </details>
              {entityGraphSummary.edges.items.length === 0 ? (
                <div className={styles.graphEmpty}>{deferredGraphQuery.trim() ? '当前查询没有实体边。' : '还没有实体边。'}</div>
              ) : (
                <div className={styles.graphList}>
                  {entityGraphSummary.edges.items.map((edge) => (
                    <article key={`${edge.sourceEntityId}-${edge.targetEntityId}`} className={styles.graphEdgeRow}>
                      <div className={styles.graphEdgeMain}>
                        <strong>{edge.sourceCanonicalName} ↔ {edge.targetCanonicalName}</strong>
                        <span>{formatDateTime(edge.lastSeenAt)}</span>
                      </div>
                      <div className={styles.graphEdgeMeta}>
                        <span>权重 {edge.weight.toFixed(2)}</span>
                        <span>共现 {edge.coOccurrenceCount}</span>
                        <button type="button" className={styles.dangerButton} onClick={() => handleDeleteEdge(edge)} disabled={isSavingMemoryEdit}>删除</button>
                      </div>
                      <details className={styles.edgeRowEditor}>
                        <summary>编辑边</summary>
                        <form className={styles.edgeEditForm} onSubmit={handleUpsertEdge}>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>source</span>
                            <input className={styles.input} name="sourceEntityId" defaultValue={edge.sourceEntityId} readOnly title={edge.sourceEntityId} />
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>target</span>
                            <input className={styles.input} name="targetEntityId" defaultValue={edge.targetEntityId} readOnly title={edge.targetEntityId} />
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>权重</span>
                            <input className={styles.input} name="weight" type="number" min={0} max={1} step={0.01} defaultValue={edge.weight} />
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>共现次数</span>
                            <input className={styles.input} name="coOccurrenceCount" type="number" min={0} step={1} defaultValue={edge.coOccurrenceCount} />
                          </label>
                          <button type="submit" className={styles.secondaryButton} disabled={isSavingMemoryEdit}>保存边</button>
                        </form>
                      </details>
                    </article>
                  ))}
                </div>
              )}
              <div className={styles.graphPagination}>
                <span>{edgeRangeStart}-{edgeRangeEnd} / {entityGraphSummary.edges.total} 边</span>
                <div className={styles.pagerGroup}>
                  <button type="button" className={styles.pagerButton} onClick={() => setEdgePage((current) => Math.max(1, current - 1))} disabled={edgePage <= 1 || loading}>上一页</button>
                  <button type="button" className={styles.pagerButton} onClick={() => setEdgePage((current) => current + 1)} disabled={edgePage >= edgePageCount || loading}>下一页</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.sectionPanel} ${styles.panelFrame}`}>
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
              placeholder="按摘要、检索文本或 detail 搜索"
            />
          </label>

          <label className={styles.searchField}>
            <span className={styles.fieldLabel}>层级</span>
            <select
              className={styles.searchInput}
              value={layerFilter}
              onChange={(event) => {
                setLayerFilter(event.target.value as 'all' | ManagedSqliteLayer)
                setPage(1)
              }}
            >
              <option value="all">全部层级</option>
              <option value="short_term">短期记忆</option>
              <option value="fixed">固化记忆</option>
              <option value="episodic">情景记忆</option>
            </select>
          </label>

          <div className={styles.toolbarActions}>
            <span className={styles.statusText}>
              当前结果 {memoryRows.length} / 总数 {total}
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

        <details className={styles.editBlock}>
          <summary>新增情景记忆</summary>
          <form className={styles.editForm} onSubmit={handleCreateEpisodicMemory}>
            <label className={styles.wideField}>
              <span className={styles.fieldLabel}>summary（用于 embedding）</span>
              <textarea className={styles.textarea} name="summary" rows={2} required placeholder="WJJ 现在最喜欢的游戏是星际2。" />
            </label>
            <label className={styles.wideField}>
              <span className={styles.fieldLabel}>detail（返回给长期记忆 tool 阅读）</span>
              <textarea className={styles.textarea} name="detail" rows={3} placeholder="更完整的情景细节" />
            </label>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>重要性</span>
                <input className={styles.input} name="importance" type="number" min={0} max={1} step={0.01} defaultValue={0.6} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>实体绑定（entityId:weight，每行一个，最多 5 个）</span>
                <textarea className={styles.textarea} name="entityLinks" rows={3} placeholder="entity-sc2:1&#10;entity-wow:0.55" />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>观测开始</span>
                <input className={styles.input} name="observedStartAt" type="datetime-local" />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>观测结束</span>
                <input className={styles.input} name="observedEndAt" type="datetime-local" />
              </label>
            </div>
            <div className={styles.inlineActions}>
              <button type="submit" className={styles.primaryButton} disabled={isSavingMemoryEdit}>新增情景记忆</button>
            </div>
          </form>
        </details>

        {loading && memoryRows.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>正在加载记忆…</h3>
          </div>
        ) : memoryRows.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>还没有可管理的记忆</h3>
            <p className={styles.emptyCopy}>先去聊天几轮让系统写入 memory，或者清空搜索词查看全部结果。</p>
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>摘要 / 检索文本</th>
                    <th>层级</th>
                    <th>时间</th>
                    <th>会话</th>
                    <th>重要性</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {memoryRows.map((memory) => {
                    const expanded = expandedId === memory.id
                    const isEditableSqlite = memory.kind === 'sqlite' && memory.layer !== 'long_term'
                    return (
                      <Fragment key={memory.id}>
                        <tr key={memory.id}>
                          <td>
                            <button
                              type="button"
                              className={styles.tableRowButton}
                              onClick={() => setExpandedId(expanded ? null : memory.id)}
                            >
                              <span className={styles.tablePrimary}>
                                {memory.kind === 'episodic' ? memory.detail : memory.retrievalText}
                              </span>
                              <span className={styles.tableSecondary}>{expanded ? '点击收起详情' : '点击展开详情'}</span>
                            </button>
                          </td>
                          <td className={styles.statusText}>{MEMORY_LAYER_LABELS[memory.layer]}</td>
                          <td className={styles.statusText}>{formatSqliteMemoryTime(memory)}</td>
                          <td className={styles.mono}>{memory.sessionId}</td>
                          <td className={styles.mono}>{memory.importance.toFixed(2)}</td>
                          <td>
                            {memory.kind === 'sqlite' ? (
                              <button
                                type="button"
                                className={styles.dangerButton}
                                onClick={() => void handleDelete(memory.id)}
                                disabled={toolbarState.deleteDisabled || isClearingMemories}
                              >
                                删除
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={styles.dangerButton}
                                onClick={() => handleDeleteEpisodicMemory(memory.id)}
                                disabled={isSavingMemoryEdit}
                              >
                                删除
                              </button>
                            )}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className={styles.expandedRow}>
                            <td colSpan={6}>
                              <div className={styles.expandedGrid}>
                                <div>
                                  {memory.kind === 'episodic' && (
                                    <form className={styles.editForm} onSubmit={(event) => handleSaveEpisodicMemory(event, memory)}>
                                      <label className={styles.wideField}>
                                        <span className={styles.fieldLabel}>summary（用于 embedding）</span>
                                        <textarea className={styles.textarea} name="summary" rows={2} defaultValue={memory.detail} required />
                                      </label>
                                      <label className={styles.wideField}>
                                        <span className={styles.fieldLabel}>detail（返回给长期记忆 tool 阅读）</span>
                                        <textarea className={styles.textarea} name="detail" rows={4} defaultValue={memory.episodicDetail ?? ''} />
                                      </label>
                                      <div className={styles.fieldGrid}>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>重要性</span>
                                          <input className={styles.input} name="importance" type="number" min={0} max={1} step={0.01} defaultValue={memory.importance} />
                                        </label>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>实体绑定（entityId:weight，每行一个，最多 5 个）</span>
                                          <textarea className={styles.textarea} name="entityLinks" rows={3} defaultValue={entityLinksToText(memory.entities)} />
                                        </label>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>观测开始</span>
                                          <input className={styles.input} name="observedStartAt" type="datetime-local" defaultValue={toDateTimeLocal(memory.observedStartAt)} />
                                        </label>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>观测结束</span>
                                          <input className={styles.input} name="observedEndAt" type="datetime-local" defaultValue={toDateTimeLocal(memory.observedEndAt)} />
                                        </label>
                                      </div>
                                      <div className={styles.chips}>
                                        {memory.entities.length === 0 ? (
                                          <span className={styles.statusText}>无绑定实体</span>
                                        ) : memory.entities.map((entity) => (
                                          <span key={`${memory.id}-${entity.id}`} className={styles.chip}>
                                            {entity.canonicalName} · {formatEntityType(entity.type)} · {entity.weight.toFixed(2)}
                                          </span>
                                        ))}
                                      </div>
                                      <div className={styles.inlineActions}>
                                        <button type="submit" className={styles.primaryButton} disabled={isSavingMemoryEdit}>保存情景记忆</button>
                                      </div>
                                    </form>
                                  )}
                                  {memory.kind === 'sqlite' && (
                                    <form className={styles.editForm} onSubmit={(event) => handleSaveSqliteMemory(event, memory)}>
                                      <label className={styles.wideField}>
                                        <span className={styles.fieldLabel}>retrieval_text（用于 embedding）</span>
                                        <textarea className={styles.textarea} name="retrievalText" rows={2} defaultValue={memory.retrievalText} required disabled={!isEditableSqlite} />
                                      </label>
                                      <label className={styles.wideField}>
                                        <span className={styles.fieldLabel}>detail</span>
                                        <textarea className={styles.textarea} name="detail" rows={4} defaultValue={memory.detail} required disabled={!isEditableSqlite} />
                                      </label>
                                      <div className={styles.fieldGrid}>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>层级</span>
                                          <select className={styles.input} name="layer" defaultValue={memory.layer} disabled={!isEditableSqlite}>
                                            <option value="short_term">短期记忆</option>
                                            <option value="fixed">固化记忆</option>
                                          </select>
                                        </label>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>重要性</span>
                                          <input className={styles.input} name="importance" type="number" min={0} max={1} step={0.01} defaultValue={memory.importance} disabled={!isEditableSqlite} />
                                        </label>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>观测开始</span>
                                          <input className={styles.input} name="observedStartAt" type="datetime-local" defaultValue={toDateTimeLocal(memory.observedStartAt)} disabled={!isEditableSqlite} />
                                        </label>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>观测结束</span>
                                          <input className={styles.input} name="observedEndAt" type="datetime-local" defaultValue={toDateTimeLocal(memory.observedEndAt)} disabled={!isEditableSqlite} />
                                        </label>
                                      </div>
                                      <div className={styles.inlineActions}>
                                        <button type="submit" className={styles.primaryButton} disabled={!isEditableSqlite || isSavingMemoryEdit}>保存记忆</button>
                                      </div>
                                    </form>
                                  )}
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
                                      {!isEditableSqlite ? (
                                        <span className={styles.statusText}>{MEMORY_LAYER_LABELS[memory.layer]}</span>
                                      ) : (
                                        <select
                                          className={styles.input}
                                          value={memory.layer}
                                          onChange={(event) => void handleLayerChange(memory.id, event.target.value as EditableMemoryLayer)}
                                        >
                                          <option value="short_term">短期记忆</option>
                                          <option value="fixed">固化记忆</option>
                                        </select>
                                      )}
                                    </dd>
                                  </div>
                                    {memory.kind === 'episodic' && (
                                      <>
                                        <div>
                                          <dt>embedding</dt>
                                          <dd className={styles.statusText}>
                                            {memory.hasEmbedding ? `${memory.retrievalModel || 'unknown'} · ${memory.embeddingDimensions}d` : '未写入 embedding'}
                                          </dd>
                                        </div>
                                        <div>
                                          <dt>观测时间</dt>
                                          <dd className={styles.statusText}>{formatObservedRange(memory.observedStartAt, memory.observedEndAt)}</dd>
                                        </div>
                                      </>
                                    )}
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
            agentId={agentId}
            layout="grid"
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
                key: 'entityMentionPrompt',
                label: 'Entity Mention Prompt',
                helper: '长期记忆 tool 召回前使用，只从当前问题提取实体 mention；不得创建实体、合并实体或新增 alias。',
                value: draftSettings.entityMentionPrompt,
                placeholder: '清空后保存会回退系统默认的 entity mention prompt。',
                rows: 7,
              },
              {
                key: 'episodicExtractionPrompt',
                label: 'Episodic Extraction Prompt',
                helper: '后台整合 STM 的阶段 A，负责抽取实体和情景记忆；alias 和 merge 不在这一阶段发生。',
                value: draftSettings.episodicExtractionPrompt,
                placeholder: '清空后保存会回退系统默认的 episodic extraction prompt。',
                rows: 7,
              },
              {
                key: 'entityResolutionPrompt',
                label: 'Entity Resolution Prompt',
                helper: '后台整合 STM 的阶段 B，负责 merge/create_new，并且只允许在 merge 时通过 alias_to_add 建立 alias。',
                value: draftSettings.entityResolutionPrompt,
                placeholder: '清空后保存会回退系统默认的 entity resolution prompt。',
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
            tests={{
              semanticAnalyzerPrompt: {
                testId: 'memory.semanticAnalyzer',
                defaultInput: DEFAULT_PROMPT_TEST_INPUTS.memorySemantic,
              },
              contextToShortTermPrompt: {
                testId: 'memory.contextToShortTerm',
                defaultInput: DEFAULT_PROMPT_TEST_INPUTS.memoryContextToShortTerm,
              },
              entityMentionPrompt: {
                testId: 'memory.entityMention',
                defaultInput: DEFAULT_PROMPT_TEST_INPUTS.memoryEntityMention,
              },
              episodicExtractionPrompt: {
                testId: 'memory.episodicExtraction',
                defaultInput: DEFAULT_PROMPT_TEST_INPUTS.memoryEpisodicExtraction,
              },
              entityResolutionPrompt: {
                testId: 'memory.entityResolution',
                defaultInput: DEFAULT_PROMPT_TEST_INPUTS.memoryEntityResolution,
              },
              shortTermFragmentPrompt: {
                testId: 'memory.shortTermFragment',
                defaultInput: DEFAULT_PROMPT_TEST_INPUTS.memoryShortTermFragment,
              },
              fixedFragmentPrompt: {
                testId: 'memory.fixedFragment',
                defaultInput: DEFAULT_PROMPT_TEST_INPUTS.memoryFixedFragment,
              },
            }}
            onChange={(key, value) => updateSetting(key as keyof MemorySettings, value)}
          />
        </section>
      </div>
    </section>
  )
}
