'use client'

import { Fragment, type FormEvent, useDeferredValue, useEffect, useRef, useState, useTransition } from 'react'
import { useAppLocale } from '@/app/use-app-locale'
import PromptLab from '../PromptLab'
import { DEFAULT_PROMPT_TEST_INPUTS } from '../PromptTestPanel'
import styles from '../manager-ui.module.css'
import {
  getEntityTypeLabel,
  getEntityTypeOptions,
  getMemoryLayerLabel,
  getSqliteMemoryCopy,
  type AppLocale,
} from './MemoryManager.sqlite.copy'
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
  embeddingProvider: 'openrouter'
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
  embeddingProvider: 'openrouter' | null
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

function formatDateTime(value: string, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatSqliteMemoryTime(memory: MemoryRow, locale: AppLocale, copy: ReturnType<typeof getSqliteMemoryCopy>) {
  if (memory.layer === 'episodic') {
    return formatObservedRange(memory.observedStartAt, memory.observedEndAt, locale, copy)
  }
  if (memory.layer === 'short_term') {
    if (!memory.observedStartAt || !memory.observedEndAt) {
      return copy.common.unknownTime
    }

    return `${formatDateTime(memory.observedStartAt, locale)} - ${formatDateTime(memory.observedEndAt, locale)}`
  }

  return formatDateTime(memory.createdAt, locale)
}

function normalizeSettings(data: Partial<MemoryListResponse> | Partial<MemorySettings>): MemorySettings {
  return {
    summarizeModel: typeof data.summarizeModel === 'string' ? data.summarizeModel : '',
    embeddingProvider: 'openrouter',
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

function formatOptionalDate(value: string | null | undefined, locale: AppLocale, copy: ReturnType<typeof getSqliteMemoryCopy>) {
  if (!value) {
    return copy.common.none
  }

  return formatDateTime(value, locale)
}

function formatObservedRange(
  start: string | null | undefined,
  end: string | null | undefined,
  locale: AppLocale,
  copy: ReturnType<typeof getSqliteMemoryCopy>,
) {
  if (!start || !end) {
    return copy.common.unknownTime
  }

  return `${formatDateTime(start, locale)} - ${formatDateTime(end, locale)}`
}

function formatEntityType(type: string, locale: AppLocale) {
  return getEntityTypeLabel(type, locale)
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
  const locale = useAppLocale()
  const copy = getSqliteMemoryCopy(locale)
  const entityTypeOptions = getEntityTypeOptions(locale)
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
        throw new Error(readErrorMessage(data, copy.errors.load))
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
      setError(err instanceof Error ? err.message : copy.errors.load)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh(deferredQuery, page, layerFilter, deferredGraphQuery, nodePage, edgePage)
  }, [agentId, deferredQuery, page, layerFilter, deferredGraphQuery, nodePage, edgePage, locale])

  function updateSetting<K extends keyof MemorySettings>(key: K, value: MemorySettings[K]) {
    settingsDirtyRef.current = true
    setDraftSettings((current) => ({ ...current, [key]: value }))
  }

  async function handleDelete(memoryId: string) {
    if (!window.confirm(copy.confirms.deleteSqlite)) {
      return
    }

    setError(null)
    setNotice(null)

    const response = await fetch(`/api/agents/${agentId}/memory/sqlite/${memoryId}`, {
      method: 'DELETE',
    })
    const data = await response.json()
    if (!response.ok) {
      setError(typeof data?.error === 'string' ? data.error : copy.errors.delete)
      return
    }

    setNotice(copy.notices.deletedSqlite)
    startTransition(() => {
      void refresh()
    })
  }

  async function handleClearAllMemories() {
    if (!window.confirm(copy.confirms.clearAll)) {
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
        throw new Error(typeof data?.error === 'string' ? data.error : copy.errors.clear)
      }

      const deletedCount = typeof data.deletedCount === 'number' ? data.deletedCount : 0
      setNotice(copy.notices.cleared(deletedCount))
      setExpandedId(null)
      setPage(1)
      startTransition(() => {
        void refresh(deferredQuery, 1, layerFilter)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.clear)
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
        throw new Error(typeof data?.error === 'string' ? data.error : copy.errors.updateLayer)
      }

      setNotice(copy.notices.layerUpdated(getMemoryLayerLabel(layer, locale)))
      startTransition(() => {
        void refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.updateLayer)
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
        throw new Error(typeof data?.error === 'string' ? data.error : copy.errors.edit)
      }

      setNotice(successMessage)
      startTransition(() => {
        void refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.edit)
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
    }, copy.notices.savedSqlite)
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
    }, copy.notices.savedEpisodic)
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
    }, copy.notices.createdEpisodic)
    event.currentTarget.reset()
  }

  function handleDeleteEpisodicMemory(memoryId: string) {
    if (!window.confirm(copy.confirms.deleteEpisodic)) {
      return
    }
    void postMemoryEdit({ action: 'episodic.delete', memoryId }, copy.notices.deletedEpisodic)
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
    }, copy.notices.createdEntity)
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
    }, copy.notices.savedEntity)
  }

  function handleDeleteEntity(entityId: string) {
    if (!window.confirm(copy.confirms.deleteEntity)) {
      return
    }
    void postMemoryEdit({ action: 'entity.delete', entityId }, copy.notices.deletedEntity)
  }

  function handleMergeEntity(sourceEntityId: string, targetEntityId: string) {
    if (!targetEntityId.trim() || !window.confirm(copy.confirms.mergeEntity)) {
      return
    }
    void postMemoryEdit({
      action: 'entity.merge',
      sourceEntityId,
      targetEntityId: targetEntityId.trim(),
    }, copy.notices.mergedEntity)
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
    }, copy.notices.savedEdge)
  }

  function handleDeleteEdge(edge: EntityEdge) {
    if (!window.confirm(copy.confirms.deleteEdge)) {
      return
    }
    void postMemoryEdit({
      action: 'edge.delete',
      sourceEntityId: edge.sourceEntityId,
      targetEntityId: edge.targetEntityId,
    }, copy.notices.deletedEdge)
  }

  async function handleFlushContext() {
    setError(null)
    setNotice(copy.notices.contextFlushStart)
    setIsFlushingContext(true)

    try {
      const response = await fetch(`/api/agents/${agentId}/memory/context`, {
        method: 'POST',
      })
      const data = await response.json() as MemoryActionResponse & { error?: string; sessionId?: string }
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : copy.errors.contextFlush)
      }

      const result = data.result
      if (!result?.ok) {
        setNotice(copy.notices.contextFlushSkipped(result?.reason ?? 'nothing_to_flush'))
      } else {
        setNotice(
          copy.notices.contextFlushDone(result.createdCount ?? 0, result.flushedMessageCount ?? 0),
        )
      }
      startTransition(() => {
        void refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.contextFlush)
      setNotice(null)
    } finally {
      setIsFlushingContext(false)
    }
  }

  async function handleSleep() {
    setError(null)
    setNotice(copy.notices.sleepStart)
    setIsSleeping(true)

    try {
      const response = await fetch(`/api/agents/${agentId}/memory/sleep`, {
        method: 'POST',
      })
      const data = await response.json() as MemoryActionResponse & { error?: string }
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : copy.errors.sleep)
      }

      const result = data.result
      if (!result?.ok) {
        setNotice(copy.notices.sleepSkipped(result?.reason ?? 'not_sleep_time'))
      } else {
        setNotice(
          copy.notices.sleepDone(
            result.createdEpisodicCount ?? result.createdCount ?? 0,
            result.createdEntityCount ?? 0,
            result.deletedShortTermCount ?? 0,
          ),
        )
      }
      startTransition(() => {
        void refresh()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.sleep)
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
          embeddingProvider: draftSettings.embeddingProvider,
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
        throw new Error(typeof data?.error === 'string' ? data.error : copy.errors.settings)
      }

      const normalizedOverride = normalizeSettings(data)
      const normalizedEffective = {
        ...normalizedOverride,
        ...normalizeEffectivePrompts(data),
      }
      setSavedSettings(normalizedEffective)
      setDraftSettings(normalizedEffective)
      settingsDirtyRef.current = false
      setNotice(copy.notices.settingsSaved)
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.settings)
    }
  }

  return (
    <section className={styles.workspace}>
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{copy.hero.eyebrow}</p>
          <h3 className={styles.title}>{copy.hero.title}</h3>
          <p className={styles.copy}>
            {copy.hero.copy}
          </p>
        </div>
        <div className={styles.heroActions}>
          <span className={styles.statusPill}>{toolbarState.status ?? copy.hero.count(total)}</span>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => startTransition(() => { void refresh() })}
            disabled={toolbarState.refreshDisabled}
          >
            {copy.actions.refresh}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void handleFlushContext()}
            disabled={isFlushingContext || isSleeping || isClearingMemories || loading}
          >
            {isFlushingContext ? copy.actions.flushing : copy.actions.flush}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void handleSleep()}
            disabled={isSleeping || isFlushingContext || isClearingMemories || loading}
          >
            {isSleeping ? copy.actions.sleeping : copy.actions.sleep}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleSaveSettings()}
            disabled={!settingsDirty || isFlushingContext || isSleeping || isClearingMemories}
          >
            {copy.actions.saveSettings}
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
                <p className={styles.panelLabel}>{copy.settings.preRetrieval}</p>
                <h4 className={styles.panelTitle}>Short-term Retrieval</h4>
              </div>
              <span className={styles.panelPill}>{copy.settings.shortTermPill}</span>
            </div>
            <p className={styles.panelCopy}>
              {copy.settings.shortTermCopy}
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
                <p className={styles.panelLabel}>{copy.settings.preRetrieval}</p>
                <h4 className={styles.panelTitle}>Fixed Retrieval</h4>
              </div>
              <span className={styles.panelPill}>{copy.settings.fixedPill}</span>
            </div>
            <p className={styles.panelCopy}>
              {copy.settings.fixedCopy}
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
                <p className={styles.panelLabel}>{copy.settings.semanticLabel}</p>
                <h4 className={styles.panelTitle}>Semantic / Episodic</h4>
              </div>
              <span className={styles.panelPill}>{copy.settings.semanticPill}</span>
            </div>
            <p className={styles.panelCopy}>
              {copy.settings.semanticCopy}
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
                  <option value="on">{copy.settings.noHitOn}</option>
                  <option value="off">{copy.settings.noHitOff}</option>
                </select>
              </label>
            </div>
          </section>
          <section className={`${styles.panel} ${styles.sectionPanel} ${styles.panelFrame}`}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>{copy.settings.rhythm}</p>
              <h4 className={styles.panelTitle}>Context</h4>
            </div>
            <span className={styles.panelPill}>{copy.settings.contextPill}</span>
          </div>
          <p className={styles.panelCopy}>
            {copy.settings.contextCopy}
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
              <dt>{copy.settings.activeSession}</dt>
              <dd className={styles.mono}>{contextSummary?.activeSessionId ?? copy.common.none}</dd>
            </div>
            <div>
              <dt>{copy.settings.activeContextMessages}</dt>
              <dd>{contextSummary?.activeMessageCount ?? 0}</dd>
            </div>
            <div>
              <dt>{copy.settings.totalSessionMessages}</dt>
              <dd>{contextSummary?.totalSessionMessages ?? 0}</dd>
            </div>
            <div>
              <dt>{copy.settings.activeStartMessage}</dt>
              <dd className={styles.mono}>{contextSummary?.activeStartMessageId ?? copy.common.none}</dd>
            </div>
            <div>
              <dt>{copy.settings.pendingFlushUntil}</dt>
              <dd className={styles.mono}>{contextSummary?.pendingFlushUntilMessageId ?? copy.common.none}</dd>
            </div>
            <div>
              <dt>{copy.settings.lastUserMessage}</dt>
              <dd>{formatOptionalDate(contextSummary?.lastUserMessageAt, locale, copy)}</dd>
            </div>
            <div>
              <dt>{copy.settings.lastContextFlush}</dt>
              <dd>{formatOptionalDate(contextSummary?.lastContextFlushAt, locale, copy)}</dd>
            </div>
          </dl>
          </section>

          <section className={`${styles.panel} ${styles.sectionPanel} ${styles.panelFrame}`}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>{copy.settings.rhythm}</p>
              <h4 className={styles.panelTitle}>Sleep</h4>
            </div>
            <span className={styles.panelPill}>{copy.settings.sleepPill}</span>
          </div>
          <p className={styles.panelCopy}>
            {copy.settings.sleepCopy}
          </p>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Sleep Enabled</span>
              <select
                className={styles.input}
                value={draftSettings.sleepEnabled ? 'on' : 'off'}
                onChange={(event) => updateSetting('sleepEnabled', event.target.value === 'on')}
              >
                <option value="on">{copy.common.enabled}</option>
                <option value="off">{copy.common.disabled}</option>
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
              <dt>{copy.settings.lastSleep}</dt>
              <dd>{formatOptionalDate(sleepSummary?.lastSleepAt, locale, copy)}</dd>
            </div>
          </dl>
          </section>

          <section className={`${styles.panel} ${styles.sectionPanel} ${styles.panelFrame}`}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.panelLabel}>{copy.settings.modelLabel}</p>
              <h4 className={styles.panelTitle}>Memory Models</h4>
            </div>
            <span className={styles.panelPill}>{copy.settings.modelPill}</span>
          </div>
          <p className={styles.panelCopy}>
            {copy.settings.modelCopy}
          </p>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Memory Model</span>
              <input
                className={styles.input}
                value={draftSettings.summarizeModel}
                onChange={(event) => updateSetting('summarizeModel', event.target.value)}
                placeholder={copy.settings.memoryModelPlaceholder}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Embedding Provider</span>
              <select
                className={styles.input}
                value={draftSettings.embeddingProvider}
                onChange={() => updateSetting('embeddingProvider', 'openrouter')}
              >
                <option value="openrouter">OpenRouter</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Embedding Model</span>
              <input
                className={styles.input}
                value={draftSettings.embeddingModel}
                onChange={(event) => updateSetting('embeddingModel', event.target.value)}
                placeholder={copy.settings.embeddingModelPlaceholder}
              />
            </label>
          </div>
          </section>
        </div>

        <section className={`${styles.sectionPanel} ${styles.graphPanel}`}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.tableLabel}>{copy.graph.label}</p>
              <h4 className={styles.panelTitle}>Entity Graph</h4>
            </div>
            <div className={styles.graphStats}>
              <span>{entityGraphSummary.nodes.total} {copy.graph.nodesUnit}</span>
              <span>{entityGraphSummary.edges.total} {copy.graph.edgesUnit}</span>
            </div>
          </div>
          <p className={styles.panelCopy}>
            {copy.graph.copy}
          </p>
          <div className={styles.graphToolbar}>
            <label className={`${styles.searchField} ${styles.graphSearchField}`}>
              <span className={styles.fieldLabel}>{copy.graph.searchLabel}</span>
              <input
                className={styles.searchInput}
                value={graphQuery}
                onChange={(event) => {
                  setGraphQuery(event.target.value)
                  setNodePage(1)
                  setEdgePage(1)
                }}
                placeholder={copy.graph.searchPlaceholder}
              />
            </label>
            <span className={styles.graphQueryState}>
              {copy.graph.searchState(deferredGraphQuery.trim())}
            </span>
          </div>

          <details className={styles.editBlock}>
            <summary>{copy.graph.addEntity}</summary>
            <form className={styles.editForm} onSubmit={handleCreateEntity}>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{copy.graph.name}</span>
                  <input className={styles.input} name="canonicalName" required placeholder={copy.graph.namePlaceholder} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{copy.graph.type}</span>
                  <select className={styles.input} name="type" defaultValue="object">
                    {entityTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{copy.graph.confidence}</span>
                  <input className={styles.input} name="confidence" type="number" min={0} max={1} step={0.01} defaultValue={0.8} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{copy.graph.aliases}</span>
                  <textarea className={styles.textarea} name="aliases" rows={2} placeholder={copy.graph.aliasesPlaceholder} />
                </label>
                <label className={styles.wideField}>
                  <span className={styles.fieldLabel}>{copy.graph.description}</span>
                  <textarea className={styles.textarea} name="description" rows={2} placeholder={copy.graph.descriptionPlaceholder} />
                </label>
              </div>
              <div className={styles.inlineActions}>
                <button type="submit" className={styles.primaryButton} disabled={isSavingMemoryEdit}>{copy.graph.createEntity}</button>
              </div>
            </form>
          </details>

          <div className={styles.graphGrid}>
            <div className={styles.graphColumn}>
              <div className={styles.graphColumnHead}>
                <div>
                  <p className={styles.panelLabel}>Nodes</p>
                  <h4 className={styles.panelTitle}>{copy.graph.nodesTitle}</h4>
                </div>
                <span className={styles.graphPagePill}>{copy.graph.page(entityGraphSummary.nodes.page, nodePageCount)}</span>
              </div>
              {entityGraphSummary.nodes.items.length === 0 ? (
                <div className={styles.graphEmpty}>{deferredGraphQuery.trim() ? copy.graph.emptyNodesForQuery : copy.graph.emptyNodes}</div>
              ) : (
                <div className={styles.graphList}>
                  {entityGraphSummary.nodes.items.map((entity) => (
                    <article key={entity.id} className={styles.graphNodeRow}>
                      <div className={styles.graphNodeMain}>
                        <div className={styles.graphNodeRead}>
                          <div className={styles.graphNodeTitleLine}>
                            <strong>{entity.canonicalName}</strong>
                            <span className={styles.graphTypeBadge}>{formatEntityType(entity.type, locale)}</span>
                            <span className={styles.graphConfidence}>{copy.graph.confidence} {entity.confidence.toFixed(2)}</span>
                          </div>
                          {entity.description && <p className={styles.graphDescription}>{entity.description}</p>}
                          <div className={styles.graphAliasLine}>
                            {entity.aliases.length === 0 ? (
                              <span>{copy.graph.noAlias}</span>
                            ) : entity.aliases.map((alias) => (
                              <span key={`${entity.id}-${alias}`}>{alias}</span>
                            ))}
                          </div>
                        </div>
                        <details className={styles.rowEditDetails}>
                          <summary>{copy.graph.editNode}</summary>
                          <form className={styles.entityEditForm} onSubmit={(event) => handleSaveEntity(event, entity)}>
                            <div className={styles.graphNodeTitleLine}>
                              <input className={styles.input} name="canonicalName" defaultValue={entity.canonicalName} required />
                              <select className={styles.input} name="type" defaultValue={entity.type}>
                                {entityTypeOptions.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>
                            <textarea className={styles.textarea} name="description" rows={2} defaultValue={entity.description ?? ''} placeholder={copy.graph.entityDescriptionPlaceholder} />
                            <textarea className={styles.textarea} name="aliases" rows={2} defaultValue={entity.aliases.join('\n')} placeholder={copy.graph.aliasesEachLine} />
                            <div className={styles.inlineActions}>
                              <label className={styles.inlineField}>
                                <span>{copy.graph.confidence}</span>
                                <input className={styles.input} name="confidence" type="number" min={0} max={1} step={0.01} defaultValue={entity.confidence} />
                              </label>
                              <button type="submit" className={styles.primaryButton} disabled={isSavingMemoryEdit}>{copy.graph.saveNode}</button>
                              <button type="button" className={styles.dangerButton} onClick={() => handleDeleteEntity(entity.id)} disabled={isSavingMemoryEdit}>{copy.common.delete}</button>
                            </div>
                            <div className={styles.mergeLine}>
                              <input className={styles.input} name="mergeTargetEntityId" placeholder={copy.graph.targetEntityId} />
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
                                {copy.graph.mergeIntoTarget}
                              </button>
                            </div>
                          </form>
                        </details>
                      </div>
                      <div className={styles.graphNodeMeta}>
                        <span className={styles.mono} title={entity.id}>{shortId(entity.id)}</span>
                        <span>{copy.graph.episodicCount(entity.episodicMemoryCount)}</span>
                        <span>{formatOptionalDate(entity.lastSeenAt, locale, copy)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <div className={styles.graphPagination}>
                <span>{copy.graph.rangeNodes(nodeRangeStart, nodeRangeEnd, entityGraphSummary.nodes.total)}</span>
                <div className={styles.pagerGroup}>
                  <button type="button" className={styles.pagerButton} onClick={() => setNodePage((current) => Math.max(1, current - 1))} disabled={nodePage <= 1 || loading}>{copy.common.previous}</button>
                  <button type="button" className={styles.pagerButton} onClick={() => setNodePage((current) => current + 1)} disabled={nodePage >= nodePageCount || loading}>{copy.common.next}</button>
                </div>
              </div>
            </div>

            <div className={styles.graphColumn}>
              <div className={styles.graphColumnHead}>
                <div>
                  <p className={styles.panelLabel}>Edges</p>
                  <h4 className={styles.panelTitle}>{copy.graph.edgesTitle}</h4>
                </div>
                <span className={styles.graphPagePill}>{copy.graph.page(entityGraphSummary.edges.page, edgePageCount)}</span>
              </div>
              <details className={styles.rowEditDetails}>
                <summary>{copy.graph.addEdge}</summary>
                <form className={styles.edgeEditForm} onSubmit={handleUpsertEdge}>
                  <input className={styles.input} name="sourceEntityId" placeholder="source entity id" required />
                  <input className={styles.input} name="targetEntityId" placeholder="target entity id" required />
                  <input className={styles.input} name="weight" type="number" min={0} max={1} step={0.01} defaultValue={0.5} />
                  <input className={styles.input} name="coOccurrenceCount" type="number" min={0} step={1} defaultValue={0} />
                  <button type="submit" className={styles.secondaryButton} disabled={isSavingMemoryEdit}>{copy.graph.saveEdge}</button>
                </form>
              </details>
              {entityGraphSummary.edges.items.length === 0 ? (
                <div className={styles.graphEmpty}>{deferredGraphQuery.trim() ? copy.graph.emptyEdgesForQuery : copy.graph.emptyEdges}</div>
              ) : (
                <div className={styles.graphList}>
                  {entityGraphSummary.edges.items.map((edge) => (
                    <article key={`${edge.sourceEntityId}-${edge.targetEntityId}`} className={styles.graphEdgeRow}>
                      <div className={styles.graphEdgeMain}>
                        <strong>{edge.sourceCanonicalName} ↔ {edge.targetCanonicalName}</strong>
                        <span>{formatDateTime(edge.lastSeenAt, locale)}</span>
                      </div>
                      <div className={styles.graphEdgeMeta}>
                        <span>{copy.graph.weight} {edge.weight.toFixed(2)}</span>
                        <span>{copy.graph.coOccurrences} {edge.coOccurrenceCount}</span>
                        <button type="button" className={styles.dangerButton} onClick={() => handleDeleteEdge(edge)} disabled={isSavingMemoryEdit}>{copy.common.delete}</button>
                      </div>
                      <details className={styles.edgeRowEditor}>
                        <summary>{copy.graph.editEdge}</summary>
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
                            <span className={styles.fieldLabel}>{copy.graph.weight}</span>
                            <input className={styles.input} name="weight" type="number" min={0} max={1} step={0.01} defaultValue={edge.weight} />
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>{copy.graph.coOccurrenceCount}</span>
                            <input className={styles.input} name="coOccurrenceCount" type="number" min={0} step={1} defaultValue={edge.coOccurrenceCount} />
                          </label>
                          <button type="submit" className={styles.secondaryButton} disabled={isSavingMemoryEdit}>{copy.graph.saveEdge}</button>
                        </form>
                      </details>
                    </article>
                  ))}
                </div>
              )}
              <div className={styles.graphPagination}>
                <span>{copy.graph.rangeEdges(edgeRangeStart, edgeRangeEnd, entityGraphSummary.edges.total)}</span>
                <div className={styles.pagerGroup}>
                  <button type="button" className={styles.pagerButton} onClick={() => setEdgePage((current) => Math.max(1, current - 1))} disabled={edgePage <= 1 || loading}>{copy.common.previous}</button>
                  <button type="button" className={styles.pagerButton} onClick={() => setEdgePage((current) => current + 1)} disabled={edgePage >= edgePageCount || loading}>{copy.common.next}</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.sectionPanel} ${styles.panelFrame}`}>
        <div className={styles.panelHead}>
          <div>
            <p className={styles.tableLabel}>{copy.table.label}</p>
            <h4 className={styles.panelTitle}>Memory Rows</h4>
          </div>
          <span className={styles.panelPill}>
            {copy.table.page(page, pageCount)}
          </span>
        </div>

        <div className={styles.tableToolbar}>
          <label className={styles.searchField}>
            <span className={styles.fieldLabel}>{copy.table.search}</span>
            <input
              className={styles.searchInput}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder={copy.table.searchPlaceholder}
            />
          </label>

          <label className={styles.searchField}>
            <span className={styles.fieldLabel}>{copy.table.layer}</span>
            <select
              className={styles.searchInput}
              value={layerFilter}
              onChange={(event) => {
                setLayerFilter(event.target.value as 'all' | ManagedSqliteLayer)
                setPage(1)
              }}
            >
              <option value="all">{copy.table.allLayers}</option>
              <option value="short_term">{getMemoryLayerLabel('short_term', locale)}</option>
              <option value="fixed">{getMemoryLayerLabel('fixed', locale)}</option>
              <option value="episodic">{getMemoryLayerLabel('episodic', locale)}</option>
            </select>
          </label>

          <div className={styles.toolbarActions}>
            <span className={styles.statusText}>
              {copy.table.results(memoryRows.length, total)}
              {deferredQuery.trim() ? copy.table.searchTerm(deferredQuery.trim()) : ''}
              {layerFilter !== 'all' ? copy.table.layerFilter(getMemoryLayerLabel(layerFilter, locale)) : ''}
            </span>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => void handleClearAllMemories()}
              disabled={isClearingMemories || isFlushingContext || isSleeping || loading}
            >
              {isClearingMemories ? copy.actions.clearing : copy.actions.clearAll}
            </button>
          </div>
        </div>

        <details className={styles.editBlock}>
          <summary>{copy.table.addEpisodic}</summary>
          <form className={styles.editForm} onSubmit={handleCreateEpisodicMemory}>
            <label className={styles.wideField}>
              <span className={styles.fieldLabel}>{copy.table.summaryLabel}</span>
              <textarea className={styles.textarea} name="summary" rows={2} required placeholder={copy.table.summaryPlaceholder} />
            </label>
            <label className={styles.wideField}>
              <span className={styles.fieldLabel}>{copy.table.detailLabel}</span>
              <textarea className={styles.textarea} name="detail" rows={3} placeholder={copy.table.detailPlaceholder} />
            </label>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{copy.table.importance}</span>
                <input className={styles.input} name="importance" type="number" min={0} max={1} step={0.01} defaultValue={0.6} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{copy.table.entityLinks}</span>
                <textarea className={styles.textarea} name="entityLinks" rows={3} placeholder="entity-sc2:1&#10;entity-wow:0.55" />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{copy.table.observedStart}</span>
                <input className={styles.input} name="observedStartAt" type="datetime-local" />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{copy.table.observedEnd}</span>
                <input className={styles.input} name="observedEndAt" type="datetime-local" />
              </label>
            </div>
            <div className={styles.inlineActions}>
              <button type="submit" className={styles.primaryButton} disabled={isSavingMemoryEdit}>{copy.table.createEpisodic}</button>
            </div>
          </form>
        </details>

        {loading && memoryRows.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>{copy.table.loading}</h3>
          </div>
        ) : memoryRows.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>{copy.table.emptyTitle}</h3>
            <p className={styles.emptyCopy}>{copy.table.emptyCopy}</p>
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{copy.table.summaryColumn}</th>
                    <th>{copy.table.layer}</th>
                    <th>{copy.table.time}</th>
                    <th>{copy.table.session}</th>
                    <th>{copy.table.importance}</th>
                    <th>{copy.table.actions}</th>
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
                              <span className={styles.tableSecondary}>{expanded ? copy.table.collapse : copy.table.expand}</span>
                            </button>
                          </td>
                          <td className={styles.statusText}>{getMemoryLayerLabel(memory.layer, locale)}</td>
                          <td className={styles.statusText}>{formatSqliteMemoryTime(memory, locale, copy)}</td>
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
                                {copy.common.delete}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={styles.dangerButton}
                                onClick={() => handleDeleteEpisodicMemory(memory.id)}
                                disabled={isSavingMemoryEdit}
                              >
                                {copy.common.delete}
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
                                        <span className={styles.fieldLabel}>{copy.table.summaryLabel}</span>
                                        <textarea className={styles.textarea} name="summary" rows={2} defaultValue={memory.detail} required />
                                      </label>
                                      <label className={styles.wideField}>
                                        <span className={styles.fieldLabel}>{copy.table.detailLabel}</span>
                                        <textarea className={styles.textarea} name="detail" rows={4} defaultValue={memory.episodicDetail ?? ''} />
                                      </label>
                                      <div className={styles.fieldGrid}>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>{copy.table.importance}</span>
                                          <input className={styles.input} name="importance" type="number" min={0} max={1} step={0.01} defaultValue={memory.importance} />
                                        </label>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>{copy.table.entityLinks}</span>
                                          <textarea className={styles.textarea} name="entityLinks" rows={3} defaultValue={entityLinksToText(memory.entities)} />
                                        </label>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>{copy.table.observedStart}</span>
                                          <input className={styles.input} name="observedStartAt" type="datetime-local" defaultValue={toDateTimeLocal(memory.observedStartAt)} />
                                        </label>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>{copy.table.observedEnd}</span>
                                          <input className={styles.input} name="observedEndAt" type="datetime-local" defaultValue={toDateTimeLocal(memory.observedEndAt)} />
                                        </label>
                                      </div>
                                      <div className={styles.chips}>
                                        {memory.entities.length === 0 ? (
                                          <span className={styles.statusText}>{copy.table.noBoundEntities}</span>
                                        ) : memory.entities.map((entity) => (
                                          <span key={`${memory.id}-${entity.id}`} className={styles.chip}>
                                            {entity.canonicalName} · {formatEntityType(entity.type, locale)} · {entity.weight.toFixed(2)}
                                          </span>
                                        ))}
                                      </div>
                                      <div className={styles.inlineActions}>
                                        <button type="submit" className={styles.primaryButton} disabled={isSavingMemoryEdit}>{copy.table.saveEpisodic}</button>
                                      </div>
                                    </form>
                                  )}
                                  {memory.kind === 'sqlite' && (
                                    <form className={styles.editForm} onSubmit={(event) => handleSaveSqliteMemory(event, memory)}>
                                      <label className={styles.wideField}>
                                        <span className={styles.fieldLabel}>{copy.table.retrievalTextLabel}</span>
                                        <textarea className={styles.textarea} name="retrievalText" rows={2} defaultValue={memory.retrievalText} required disabled={!isEditableSqlite} />
                                      </label>
                                      <label className={styles.wideField}>
                                        <span className={styles.fieldLabel}>detail</span>
                                        <textarea className={styles.textarea} name="detail" rows={4} defaultValue={memory.detail} required disabled={!isEditableSqlite} />
                                      </label>
                                      <div className={styles.fieldGrid}>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>{copy.table.layer}</span>
                                          <select className={styles.input} name="layer" defaultValue={memory.layer} disabled={!isEditableSqlite}>
                                            <option value="short_term">{getMemoryLayerLabel('short_term', locale)}</option>
                                            <option value="fixed">{getMemoryLayerLabel('fixed', locale)}</option>
                                          </select>
                                        </label>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>{copy.table.importance}</span>
                                          <input className={styles.input} name="importance" type="number" min={0} max={1} step={0.01} defaultValue={memory.importance} disabled={!isEditableSqlite} />
                                        </label>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>{copy.table.observedStart}</span>
                                          <input className={styles.input} name="observedStartAt" type="datetime-local" defaultValue={toDateTimeLocal(memory.observedStartAt)} disabled={!isEditableSqlite} />
                                        </label>
                                        <label className={styles.field}>
                                          <span className={styles.fieldLabel}>{copy.table.observedEnd}</span>
                                          <input className={styles.input} name="observedEndAt" type="datetime-local" defaultValue={toDateTimeLocal(memory.observedEndAt)} disabled={!isEditableSqlite} />
                                        </label>
                                      </div>
                                      <div className={styles.inlineActions}>
                                        <button type="submit" className={styles.primaryButton} disabled={!isEditableSqlite || isSavingMemoryEdit}>{copy.table.saveMemory}</button>
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
                                    <dt>{copy.table.createdAt}</dt>
                                    <dd className={styles.statusText}>{formatDateTime(memory.createdAt, locale)}</dd>
                                  </div>
                                  <div>
                                    <dt>{copy.table.layer}</dt>
                                    <dd>
                                      {!isEditableSqlite ? (
                                        <span className={styles.statusText}>{getMemoryLayerLabel(memory.layer, locale)}</span>
                                      ) : (
                                        <select
                                          className={styles.input}
                                          value={memory.layer}
                                          onChange={(event) => void handleLayerChange(memory.id, event.target.value as EditableMemoryLayer)}
                                        >
                                          <option value="short_term">{getMemoryLayerLabel('short_term', locale)}</option>
                                          <option value="fixed">{getMemoryLayerLabel('fixed', locale)}</option>
                                        </select>
                                      )}
                                    </dd>
                                  </div>
                                    {memory.kind === 'episodic' && (
                                      <>
                                        <div>
                                          <dt>embedding</dt>
                                          <dd className={styles.statusText}>
                                            {memory.hasEmbedding ? `${memory.retrievalModel || 'unknown'} · ${memory.embeddingDimensions}d` : copy.table.notEmbedded}
                                          </dd>
                                        </div>
                                        <div>
                                          <dt>{copy.table.observedTime}</dt>
                                          <dd className={styles.statusText}>{formatObservedRange(memory.observedStartAt, memory.observedEndAt, locale, copy)}</dd>
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
                {copy.table.showing((page - 1) * PAGE_SIZE + 1, Math.min(page * PAGE_SIZE, total), total)}
              </span>
              <div className={styles.pagerGroup}>
                <button
                  type="button"
                  className={styles.pagerButton}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1 || loading}
                >
                  {copy.common.previous}
                </button>
                <button
                  type="button"
                  className={styles.pagerButton}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  disabled={page >= pageCount || loading}
                >
                  {copy.common.next}
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
                helper: copy.promptLab.semanticHelper,
                value: draftSettings.semanticAnalyzerPrompt,
                placeholder: copy.promptLab.semanticPlaceholder,
                rows: 7,
              },
              {
                key: 'contextToShortTermPrompt',
                label: 'Context → STM Prompt',
                helper: copy.promptLab.contextHelper,
                value: draftSettings.contextToShortTermPrompt,
                placeholder: copy.promptLab.contextPlaceholder,
                rows: 7,
              },
              {
                key: 'entityMentionPrompt',
                label: 'Entity Mention Prompt',
                helper: copy.promptLab.mentionHelper,
                value: draftSettings.entityMentionPrompt,
                placeholder: copy.promptLab.mentionPlaceholder,
                rows: 7,
              },
              {
                key: 'episodicExtractionPrompt',
                label: 'Episodic Extraction Prompt',
                helper: copy.promptLab.episodicHelper,
                value: draftSettings.episodicExtractionPrompt,
                placeholder: copy.promptLab.episodicPlaceholder,
                rows: 7,
              },
              {
                key: 'entityResolutionPrompt',
                label: 'Entity Resolution Prompt',
                helper: copy.promptLab.resolutionHelper,
                value: draftSettings.entityResolutionPrompt,
                placeholder: copy.promptLab.resolutionPlaceholder,
                rows: 7,
              },
              {
                key: 'shortTermFragmentPrompt',
                label: 'Short-term Fragment Prompt',
                helper: copy.promptLab.shortTermHelper,
                value: draftSettings.shortTermFragmentPrompt,
                placeholder: copy.promptLab.shortTermPlaceholder,
                rows: 7,
              },
              {
                key: 'fixedFragmentPrompt',
                label: 'Fixed Fragment Prompt',
                helper: copy.promptLab.fixedHelper,
                value: draftSettings.fixedFragmentPrompt,
                placeholder: copy.promptLab.fixedPlaceholder,
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
