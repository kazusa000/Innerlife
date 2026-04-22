'use client'

import type { LiveCall } from './observer-types'

export interface PromptFragment {
  source: string
  priority: number
  content: string
}

export interface ConversationBlock {
  type: string
  text?: string
  name?: string
  input?: Record<string, unknown>
  id?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

export interface ConversationMessage {
  role: string
  content: string | ConversationBlock[]
}

export interface EmotionVector {
  mood: number
  energy: number
  stress: number
}

export interface RelationshipVector {
  trust: number
  affinity: number
  familiarity: number
  respect: number
}

export interface MemoryHit {
  id: string
  summary: string
  layer?: string
  tags: string[]
  importance: number
}

export interface MemoryWritten {
  id?: string
  summary: string
  layer?: string
  retrievalText?: string
  tags: string[]
  importance: number
}

export interface MemoryReport {
  before: number | null
  after: number | null
  kept: number | null
  rewritten: number | null
  merged: number | null
  layer?: string
}

export interface MemoryTimeRange {
  start: string
  end: string
}

export interface MemoryTimeAnalyzerMeta {
  timeRange: MemoryTimeRange | null
  error: string | null
}

export interface MemorySemanticAnalyzerMeta {
  mode: 'llm' | 'ltp' | null
  retrievalQuery: string | null
  candidates?: string[]
  selectedQuery?: string | null
  error: string | null
}

export interface CompactionInfo {
  beforeMessageCount: number | null
  afterMessageCount: number | null
  summary: string | null
}

export type MetadataRecord = Record<string, unknown>

export function isRecord(value: unknown): value is MetadataRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2)
}

export function formatMetric(value: number, digits = 2): string {
  return value.toFixed(digits)
}

export function formatImportance(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '?'
}

export function getMetadata(call: LiveCall): MetadataRecord | null {
  return isRecord(call.metadata) ? call.metadata : null
}

export function getCallPhase(call: LiveCall): string | null {
  return readString(getMetadata(call)?.phase)
}

export function getPromptFragments(call: LiveCall): PromptFragment[] {
  const fragments = getMetadata(call)?.fragments
  if (!Array.isArray(fragments)) {
    return []
  }

  return fragments.flatMap((fragment) => {
    if (!isRecord(fragment)) {
      return []
    }

    const source = readString(fragment.source)
    const priority = readNumber(fragment.priority)
    const content = readString(fragment.content)
    if (!source || priority === null || !content) {
      return []
    }

    return [{ source, priority, content }]
  })
}

export function getPromptFragment(call: LiveCall, source: string): PromptFragment | null {
  return getPromptFragments(call).find((fragment) => fragment.source === source) ?? null
}

export function getEmotionVector(value: unknown): EmotionVector | null {
  if (!isRecord(value)) {
    return null
  }

  const mood = readNumber(value.mood)
  const energy = readNumber(value.energy)
  const stress = readNumber(value.stress)
  if (mood === null || energy === null || stress === null) {
    return null
  }

  return { mood, energy, stress }
}

export function getRelationshipVector(value: unknown): RelationshipVector | null {
  if (!isRecord(value)) {
    return null
  }

  const trust = readNumber(value.trust)
  const affinity = readNumber(value.affinity)
  const familiarity = readNumber(value.familiarity)
  const respect = readNumber(value.respect)
  if (trust === null || affinity === null || familiarity === null || respect === null) {
    return null
  }

  return { trust, affinity, familiarity, respect }
}

export function getMemoryHits(call: LiveCall): MemoryHit[] {
  const hits = getMetadata(call)?.hits
  if (!Array.isArray(hits)) {
    return []
  }

  return hits.flatMap((hit) => {
    if (!isRecord(hit)) {
      return []
    }

    const id = readString(hit.id)
    const summary = readString(hit.summary)
    const importance = readNumber(hit.importance)
    if (!id || !summary || importance === null) {
      return []
    }

    return [{
      id,
      summary,
      layer: readString(hit.layer) ?? undefined,
      tags: readStringArray(hit.tags),
      importance,
    }]
  })
}

export function getMemoryWritten(call: LiveCall): MemoryWritten | null {
  const written = getMetadata(call)?.written
  if (!isRecord(written)) {
    return null
  }

  const summary = readString(written.summary)
  const importance = readNumber(written.importance)
  if (!summary || importance === null) {
    return null
  }

  return {
    id: readString(written.id) ?? undefined,
    summary,
    layer: readString(written.layer) ?? undefined,
    retrievalText: readString(written.retrievalText) ?? undefined,
    tags: readStringArray(written.tags),
    importance,
  }
}

export function getMemoryReport(call: LiveCall): MemoryReport | null {
  const report = getMetadata(call)?.report
  if (!isRecord(report)) {
    return null
  }

  return {
    before: readNumber(report.before),
    after: readNumber(report.after),
    kept: readNumber(report.kept),
    rewritten: readNumber(report.rewritten),
    merged: readNumber(report.merged),
    layer: readString(report.layer) ?? undefined,
  }
}

export function getMemoryRetrievalQuery(call: LiveCall): string | null {
  const metadata = getMetadata(call)
  const merged = isRecord(metadata?.mergedQuery) ? metadata?.mergedQuery : null
  return readString(merged?.retrievalQuery) ?? readString(metadata?.retrievalQuery)
}

export function getMemoryTimeRange(call: LiveCall): MemoryTimeRange | null {
  const metadata = getMetadata(call)
  const merged = isRecord(metadata?.mergedQuery) ? metadata?.mergedQuery : null
  const timeRange = merged?.timeRange ?? metadata?.timeRange
  if (!isRecord(timeRange)) {
    return null
  }

  const start = readString(timeRange.start)
  const end = readString(timeRange.end)
  if (!start || !end) {
    return null
  }

  return { start, end }
}

function readMemoryTimeRange(value: unknown): MemoryTimeRange | null {
  const timeRange = value
  if (!isRecord(timeRange)) {
    return null
  }

  const start = readString(timeRange.start)
  const end = readString(timeRange.end)
  if (!start || !end) {
    return null
  }

  return { start, end }
}

export function getMemoryTimeAnalyzer(call: LiveCall): MemoryTimeAnalyzerMeta | null {
  const analyzer = getMetadata(call)?.timeAnalyzer
  if (!isRecord(analyzer)) {
    return null
  }

  return {
    timeRange: readMemoryTimeRange(analyzer.timeRange),
    error: readString(analyzer.error),
  }
}

export function getMemorySemanticAnalyzer(call: LiveCall): MemorySemanticAnalyzerMeta | null {
  const analyzer = getMetadata(call)?.semanticAnalyzer
  if (!isRecord(analyzer)) {
    return null
  }

  return {
    mode: readString(analyzer.mode) as 'llm' | 'ltp' | null,
    retrievalQuery: readString(analyzer.retrievalQuery),
    candidates: Array.isArray(analyzer.candidates) ? readStringArray(analyzer.candidates) : undefined,
    selectedQuery: readString(analyzer.selectedQuery),
    error: readString(analyzer.error),
  }
}

export function getCompactionInfo(call: LiveCall): CompactionInfo | null {
  const metadata = getMetadata(call)
  if (!metadata) {
    return null
  }

  const beforeMessageCount = readNumber(metadata.beforeMessageCount)
    ?? (Array.isArray(metadata.beforeMessages) ? metadata.beforeMessages.length : null)
  const afterMessageCount = readNumber(metadata.afterMessageCount)
    ?? (Array.isArray(metadata.afterMessages) ? metadata.afterMessages.length : null)
  const summary = readString(metadata.summary)

  if (beforeMessageCount === null && afterMessageCount === null && !summary) {
    return null
  }

  return {
    beforeMessageCount,
    afterMessageCount,
    summary,
  }
}

export function toBlocks(content: unknown): ConversationBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }

  if (!Array.isArray(content)) {
    return [{ type: 'unknown', content }]
  }

  return content.map((item) => {
    if (!isRecord(item)) {
      return { type: 'unknown', content: item }
    }

    return {
      type: readString(item.type) ?? 'unknown',
      text: readString(item.text) ?? undefined,
      name: readString(item.name) ?? undefined,
      input: isRecord(item.input) ? item.input : undefined,
      id: readString(item.id) ?? undefined,
      tool_use_id: readString(item.tool_use_id) ?? undefined,
      content: item.content,
      is_error: typeof item.is_error === 'boolean' ? item.is_error : undefined,
    }
  })
}

export function toMessages(messages: unknown): ConversationMessage[] {
  if (!Array.isArray(messages)) {
    return []
  }

  return messages.flatMap((message) => {
    if (!isRecord(message)) {
      return []
    }

    const role = readString(message.role) ?? 'unknown'
    const content = typeof message.content === 'string'
      ? message.content
      : toBlocks(message.content)

    return [{ role, content }]
  })
}

export function summarizeInput(input: unknown): string {
  if (!isRecord(input)) return ''
  const entries = Object.entries(input)
  if (entries.length === 0) return ''
  const [key, value] = entries[0]
  const rendered = typeof value === 'string' ? value : JSON.stringify(value)
  const preview = rendered.length > 60 ? `${rendered.slice(0, 60)}…` : rendered
  return entries.length === 1 ? `${key}=${preview}` : `${key}=${preview}, +${entries.length - 1}`
}

export function blockText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!isRecord(block)) {
          return JSON.stringify(block)
        }

        return typeof block.text === 'string'
          ? block.text
          : JSON.stringify(block)
      })
      .join('\n')
  }

  return JSON.stringify(content, null, 2)
}
