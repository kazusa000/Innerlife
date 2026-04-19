'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { LiveCall } from './observer-types'

interface Props {
  calls: LiveCall[]
  activeCallId: string | null
  setActiveCallId: (id: string | null) => void
}

interface PromptFragment {
  source: string
  priority: number
  content: string
}

interface MemoryHit {
  id: string
  summary: string
  tags: string[]
  importance: number
  matchedTerms?: string[]
}

interface MemoryWritten {
  id?: string
  summary: string
  tags: string[]
  importance: number
}

interface EmotionVector {
  mood: number
  energy: number
  stress: number
}

interface ConversationBlock {
  type: string
  text?: string
  name?: string
  input?: Record<string, unknown>
  id?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface ConversationMessage {
  role: string
  content: string | ConversationBlock[]
}

type MetadataRecord = Record<string, unknown>

const CALL_ACCENTS: Record<string, { color: string; soft: string }> = {
  turn: { color: 'var(--indigo)', soft: 'rgba(129, 140, 248, 0.14)' },
  memory: { color: '#34d399', soft: 'rgba(52, 211, 153, 0.14)' },
  emotion: { color: '#f472b6', soft: 'rgba(244, 114, 182, 0.14)' },
  compaction: { color: 'var(--orange)', soft: 'rgba(251, 146, 60, 0.14)' },
  personality: { color: 'var(--indigo)', soft: 'rgba(129, 140, 248, 0.14)' },
  values: { color: '#fbbf24', soft: 'rgba(251, 191, 36, 0.14)' },
}

function isRecord(value: unknown): value is MetadataRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2)
}

function formatMetric(value: number, digits = 2): string {
  return value.toFixed(digits)
}

function formatImportance(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '?'
}

function getMetadata(call: LiveCall): MetadataRecord | null {
  return isRecord(call.metadata) ? call.metadata : null
}

function getPhase(call: LiveCall): string | null {
  const phase = getMetadata(call)?.phase
  return typeof phase === 'string' ? phase : null
}

function getCallLabel(call: LiveCall): string {
  const phase = getPhase(call)

  if (call.kind === 'turn') {
    return '主对话'
  }

  if (call.kind === 'memory') {
    if (phase === 'retrieve') return 'memory.retrieve'
    if (phase === 'summarize') return 'memory.summarize'
    if (phase === 'consolidate') return 'memory.consolidate'
    return 'memory'
  }

  if (call.kind === 'emotion') {
    return 'emotion.delta'
  }

  if (call.kind === 'compaction') {
    return 'compaction.summary'
  }

  return 'call'
}

function getCallTone(call: LiveCall) {
  if (call.kind === 'memory') return CALL_ACCENTS.memory
  if (call.kind === 'emotion') return CALL_ACCENTS.emotion
  if (call.kind === 'compaction') return CALL_ACCENTS.compaction
  return CALL_ACCENTS.turn
}

function getPromptFragments(call: LiveCall): PromptFragment[] {
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

function getPromptFragment(call: LiveCall, source: string): PromptFragment | null {
  return getPromptFragments(call).find((fragment) => fragment.source === source) ?? null
}

function getEmotionVector(value: unknown): EmotionVector | null {
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

function getMemoryHits(call: LiveCall): MemoryHit[] {
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

    const tags = readStringArray(hit.tags)
    const matchedTerms = readStringArray(hit.matchedTerms)

    return [{
      id,
      summary,
      tags,
      importance,
      ...(matchedTerms.length > 0 ? { matchedTerms } : {}),
    }]
  })
}

function getMemoryWritten(call: LiveCall): MemoryWritten | null {
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
    tags: readStringArray(written.tags),
    importance,
  }
}

function getCompactionInfo(call: LiveCall) {
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

function toBlocks(content: unknown): ConversationBlock[] {
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

function toMessages(messages: unknown): ConversationMessage[] {
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

function summarizeInput(input: unknown): string {
  if (!isRecord(input)) return ''
  const entries = Object.entries(input)
  if (entries.length === 0) return ''
  const [key, value] = entries[0]
  const rendered = typeof value === 'string' ? value : JSON.stringify(value)
  const preview = rendered.length > 60 ? `${rendered.slice(0, 60)}…` : rendered
  return entries.length === 1 ? `${key}=${preview}` : `${key}=${preview}, +${entries.length - 1}`
}

function blockText(content: unknown): string {
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

function Section({
  title,
  accent,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string
  accent: string
  defaultOpen?: boolean
  badge?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 16,
        background: 'rgba(5, 5, 10, 0.28)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 14px',
          border: 'none',
          background: 'transparent',
          color: 'var(--fg)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: accent,
              boxShadow: `0 0 18px ${accent}`,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
          {badge && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'var(--fg-muted)',
                fontSize: 11,
              }}
            >
              {badge}
            </span>
          )}
        </span>
        <span style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

function Pill({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 9px',
        borderRadius: 999,
        background: 'rgba(255, 255, 255, 0.05)',
        color: accent ?? 'var(--fg)',
        fontSize: 11,
        lineHeight: 1,
      }}
    >
      <span style={{ color: 'var(--fg-subtle)' }}>{label}</span>
      <span>{value}</span>
    </span>
  )
}

function TagPills({
  values,
  accent,
}: {
  values: string[]
  accent: string
}) {
  if (values.length === 0) {
    return <span style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>无</span>
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {values.map((value) => (
        <span
          key={value}
          style={{
            padding: '4px 9px',
            borderRadius: 999,
            border: `1px solid ${accent}`,
            background: 'rgba(255, 255, 255, 0.04)',
            color: 'var(--fg)',
            fontSize: 11,
          }}
        >
          {value}
        </span>
      ))}
    </div>
  )
}

function DetailList({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode }>
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ color: 'var(--fg-subtle)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.04 * 16 }}>
            {row.label}
          </span>
          <div style={{ color: 'var(--fg)', fontSize: 13 }}>{row.value}</div>
        </div>
      ))}
    </div>
  )
}

function CodeBlock({ value }: { value: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: 14,
        borderRadius: 14,
        background: 'rgba(0, 0, 0, 0.36)',
        border: '1px solid var(--border-subtle)',
        color: '#d7dbff',
        fontSize: 12,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        overflowX: 'auto',
      }}
    >
      {value}
    </pre>
  )
}

function RenderBlock({ block }: { block: ConversationBlock }) {
  if (block.type === 'text') {
    return (
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
        {block.text}
      </div>
    )
  }

  if (block.type === 'tool_use') {
    return (
      <div
        style={{
          border: '1px solid rgba(251, 146, 60, 0.24)',
          background: 'rgba(251, 146, 60, 0.08)',
          borderRadius: 14,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--orange)', fontSize: 11, textTransform: 'uppercase' }}>tool_use</span>
          <strong style={{ color: 'var(--fg)' }}>{block.name ?? 'tool'}</strong>
          <span style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>
            {summarizeInput(block.input)}
          </span>
        </div>
        <CodeBlock value={formatJson(block.input ?? {})} />
      </div>
    )
  }

  if (block.type === 'tool_result') {
    const accent = block.is_error ? 'var(--danger)' : 'var(--success)'
    const preview = blockText(block.content).split('\n')[0]?.slice(0, 120) ?? ''

    return (
      <div
        style={{
          border: `1px solid ${block.is_error ? 'rgba(248, 113, 113, 0.24)' : 'rgba(74, 222, 128, 0.24)'}`,
          background: block.is_error ? 'rgba(248, 113, 113, 0.08)' : 'rgba(74, 222, 128, 0.08)',
          borderRadius: 14,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: accent, fontSize: 11, textTransform: 'uppercase' }}>tool_result</span>
          <span style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>{preview || '(empty)'}</span>
        </div>
        <CodeBlock value={blockText(block.content)} />
      </div>
    )
  }

  return <CodeBlock value={formatJson(block)} />
}

function MessageCard({
  title,
  role,
  content,
}: {
  title?: string
  role: string
  content: string | ConversationBlock[]
}) {
  const roleTone: Record<string, { color: string; soft: string }> = {
    user: { color: 'var(--indigo)', soft: 'rgba(129, 140, 248, 0.12)' },
    assistant: { color: '#a78bfa', soft: 'rgba(167, 139, 250, 0.12)' },
    system: { color: 'var(--fg-muted)', soft: 'rgba(255, 255, 255, 0.06)' },
  }
  const tone = roleTone[role] ?? { color: 'var(--fg-muted)', soft: 'rgba(255, 255, 255, 0.06)' }
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content

  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 18,
        background: tone.soft,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '11px 14px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span
          style={{
            color: tone.color,
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.08 * 16,
            fontWeight: 700,
          }}
        >
          {title ?? role}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
        {blocks.map((block, index) => (
          <RenderBlock key={`${block.type}-${index}`} block={block} />
        ))}
      </div>
    </div>
  )
}

function CompactionInlineCard({ call }: { call: LiveCall }) {
  const info = getCompactionInfo(call)
  if (!info) {
    return null
  }

  const compactedCount = info.beforeMessageCount !== null && info.afterMessageCount !== null
    ? Math.max(0, info.beforeMessageCount - info.afterMessageCount + 1)
    : null

  return (
    <div
      style={{
        border: '1px solid rgba(251, 146, 60, 0.24)',
        borderRadius: 18,
        background: 'rgba(251, 146, 60, 0.1)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            color: 'var(--orange)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.08 * 16,
            fontWeight: 700,
          }}
        >
          compaction.summary
        </span>
        <span style={{ color: 'var(--fg)', fontSize: 13 }}>
          本轮压缩：{compactedCount ?? info.beforeMessageCount ?? '?'} 条 → 1 条摘要
        </span>
      </div>
      {info.summary && <CodeBlock value={info.summary} />}
    </div>
  )
}

function MessagesTimeline({
  call,
  inlineCompactionCall,
}: {
  call: LiveCall
  inlineCompactionCall: LiveCall | null
}) {
  const messages = toMessages(call.messages)
  const responseBlocks = toBlocks(call.response)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {inlineCompactionCall && <CompactionInlineCard call={inlineCompactionCall} />}
      {messages.map((message, index) => (
        <MessageCard
          key={`${message.role}-${index}`}
          role={message.role}
          content={message.content}
        />
      ))}
      {(responseBlocks.length > 0 || call.error) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <MessageCard role="assistant" title="response" content={responseBlocks} />
          {call.error && (
            <div
              style={{
                padding: 12,
                borderRadius: 14,
                border: '1px solid rgba(248, 113, 113, 0.24)',
                background: 'rgba(248, 113, 113, 0.08)',
                color: 'var(--danger)',
                fontSize: 13,
              }}
            >
              {call.error}
            </div>
          )}
        </div>
      )}
      {messages.length === 0 && responseBlocks.length === 0 && !call.error && (
        <div style={{ color: 'var(--fg-subtle)', fontSize: 13 }}>
          等待该 call 的消息快照…
        </div>
      )}
    </div>
  )
}

function DimensionCard({
  title,
  accent,
  children,
}: {
  title: string
  accent: { color: string; soft: string }
  children: ReactNode
}) {
  return (
    <div
      style={{
        border: `1px solid ${accent.color}`,
        background: accent.soft,
        borderRadius: 18,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: accent.color,
            boxShadow: `0 0 18px ${accent.color}`,
          }}
        />
        <strong style={{ color: 'var(--fg)', fontSize: 14 }}>{title}</strong>
      </div>
      {children}
    </div>
  )
}

function EmotionStateView({
  label,
  vector,
}: {
  label: string
  vector: EmotionVector
}) {
  return (
    <DetailList
      rows={[
        { label: `${label} mood`, value: formatMetric(vector.mood) },
        { label: `${label} energy`, value: formatMetric(vector.energy) },
        { label: `${label} stress`, value: formatMetric(vector.stress) },
      ]}
    />
  )
}

function DimensionCards({ call }: { call: LiveCall }) {
  const metadata = getMetadata(call)
  const personality = getPromptFragment(call, 'personality')
  const values = getPromptFragment(call, 'values')
  const emotion = getPromptFragment(call, 'emotion')
  const memory = getPromptFragment(call, 'memory')
  const emotionBefore = metadata ? getEmotionVector(metadata.before) : null
  const emotionAfter = metadata ? getEmotionVector(metadata.after) : null
  const emotionDelta = metadata ? getEmotionVector(metadata.delta) : null
  const emotionTrigger = metadata ? readString(metadata.trigger) : null
  const memoryKeywords = metadata ? readStringArray(metadata.keywords) : []
  const memoryFallbackKeywords = metadata ? readStringArray(metadata.fallbackKeywords) : []
  const memoryHits = getMemoryHits(call)
  const memoryWritten = getMemoryWritten(call)
  const memoryReport = isRecord(metadata?.report) ? metadata?.report : null
  const turnMemoryMetadata = metadata?.memory

  const cards: ReactNode[] = []

  if (personality) {
    cards.push(
      <DimensionCard key="personality" title="性格" accent={CALL_ACCENTS.personality}>
        <CodeBlock value={personality.content} />
      </DimensionCard>,
    )
  }

  if (values) {
    cards.push(
      <DimensionCard key="values" title="价值观" accent={CALL_ACCENTS.values}>
        <CodeBlock value={values.content} />
      </DimensionCard>,
    )
  }

  if (emotionBefore && emotionAfter && emotionDelta) {
    cards.push(
      <DimensionCard key="emotion-delta" title="情绪" accent={CALL_ACCENTS.emotion}>
        <div style={{ display: 'grid', gap: 14 }}>
          <EmotionStateView label="before" vector={emotionBefore} />
          <EmotionStateView label="after" vector={emotionAfter} />
          <EmotionStateView label="delta" vector={emotionDelta} />
          <DetailList rows={[{ label: 'trigger', value: emotionTrigger ?? '无' }]} />
        </div>
      </DimensionCard>,
    )
  } else if (emotion) {
    cards.push(
      <DimensionCard key="emotion-fragment" title="情绪" accent={CALL_ACCENTS.emotion}>
        <CodeBlock value={emotion.content} />
      </DimensionCard>,
    )
  }

  if (getPhase(call) === 'retrieve') {
    cards.push(
      <DimensionCard key="memory-retrieve" title="记忆" accent={CALL_ACCENTS.memory}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <DetailList
            rows={[
              { label: 'keywords', value: <TagPills values={memoryKeywords} accent={CALL_ACCENTS.memory.color} /> },
              { label: 'fallback keywords', value: <TagPills values={memoryFallbackKeywords} accent={CALL_ACCENTS.memory.color} /> },
            ]}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ color: 'var(--fg-subtle)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.04 * 16 }}>
              Hits
            </span>
            {memoryHits.length === 0 ? (
              <span style={{ color: 'var(--fg-subtle)', fontSize: 13 }}>无命中</span>
            ) : (
              memoryHits.map((hit) => (
                <div
                  key={hit.id}
                  style={{
                    border: '1px solid rgba(52, 211, 153, 0.22)',
                    borderRadius: 14,
                    background: 'rgba(0, 0, 0, 0.2)',
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <DetailList
                    rows={[
                      { label: 'memory id', value: hit.id },
                      { label: 'summary', value: hit.summary },
                      { label: 'importance', value: formatImportance(hit.importance) },
                      { label: 'matched terms', value: <TagPills values={hit.matchedTerms ?? []} accent={CALL_ACCENTS.memory.color} /> },
                      { label: 'tags', value: <TagPills values={hit.tags} accent={CALL_ACCENTS.memory.color} /> },
                    ]}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </DimensionCard>,
    )
  } else if (getPhase(call) === 'summarize' && memoryWritten) {
    cards.push(
      <DimensionCard key="memory-written" title="记忆" accent={CALL_ACCENTS.memory}>
        <DetailList
          rows={[
            ...(memoryWritten.id ? [{ label: 'written id', value: memoryWritten.id }] : []),
            { label: 'summary', value: memoryWritten.summary },
            { label: 'importance', value: formatImportance(memoryWritten.importance) },
            { label: 'tags', value: <TagPills values={memoryWritten.tags} accent={CALL_ACCENTS.memory.color} /> },
          ]}
        />
      </DimensionCard>,
    )
  } else if (getPhase(call) === 'consolidate' && memoryReport) {
    const rows = [
      { label: 'before', value: String(readNumber(memoryReport.before) ?? '?') },
      { label: 'after', value: String(readNumber(memoryReport.after) ?? '?') },
      { label: 'kept', value: String(readNumber(memoryReport.kept) ?? '?') },
      { label: 'rewritten', value: String(readNumber(memoryReport.rewritten) ?? '?') },
      { label: 'merged', value: String(readNumber(memoryReport.merged) ?? '?') },
    ]

    cards.push(
      <DimensionCard key="memory-consolidate" title="记忆" accent={CALL_ACCENTS.memory}>
        <DetailList rows={rows} />
      </DimensionCard>,
    )
  } else if (memory) {
    cards.push(
      <DimensionCard key="memory-fragment" title="记忆" accent={CALL_ACCENTS.memory}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <CodeBlock value={memory.content} />
          {turnMemoryMetadata !== undefined && <CodeBlock value={formatJson(turnMemoryMetadata)} />}
        </div>
      </DimensionCard>,
    )
  }

  if (cards.length === 0) {
    return null
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {cards}
    </div>
  )
}

function ObserverCallCard({
  call,
  expanded,
  onToggle,
  inlineCompactionCall,
}: {
  call: LiveCall
  expanded: boolean
  onToggle: () => void
  inlineCompactionCall: LiveCall | null
}) {
  const tone = getCallTone(call)
  const label = getCallLabel(call)
  const toolsCount = Array.isArray(call.tools) ? call.tools.length : 0
  const fragmentsCount = getPromptFragments(call).length
  const headerStyle: CSSProperties = {
    width: '100%',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    padding: expanded ? '16px 16px 12px' : '16px',
    border: 'none',
    background: 'transparent',
    color: 'var(--fg)',
    cursor: 'pointer',
    textAlign: 'left',
  }

  return (
    <article
      style={{
        border: `1px solid ${expanded ? tone.color : 'var(--border)'}`,
        borderRadius: 22,
        background: expanded ? tone.soft : 'rgba(255, 255, 255, 0.03)',
        boxShadow: expanded ? 'var(--shadow-lift)' : 'none',
        overflow: 'hidden',
      }}
    >
      <button type="button" onClick={onToggle} style={headerStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 10px',
                borderRadius: 999,
                background: 'rgba(0, 0, 0, 0.22)',
                color: tone.color,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.06 * 16,
                textTransform: 'uppercase',
              }}
            >
              {label}
            </span>
            <span style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>
              #{call.turnIndex}
            </span>
            <span style={{ color: call.finished ? 'var(--fg-muted)' : 'var(--orange)', fontSize: 12 }}>
              {call.finished ? 'finished' : 'running'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Pill label="model" value={call.model} />
            <Pill label="tools" value={String(toolsCount)} />
            <Pill label="fragments" value={String(fragmentsCount)} />
            <Pill label="stop" value={call.stopReason ?? (call.finished ? 'end_turn' : 'pending')} accent={tone.color} />
            <Pill label="in" value={String(call.usage?.inputTokens ?? '?')} />
            <Pill label="out" value={String(call.usage?.outputTokens ?? '?')} />
          </div>
        </div>
        <span style={{ color: 'var(--fg-subtle)', fontSize: 12, flexShrink: 0 }}>
          {expanded ? '收起' : '展开'}
        </span>
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px 16px' }}>
          <DimensionCards call={call} />
          <Section title="Final system prompt" accent={tone.color}>
            <CodeBlock value={call.systemPrompt || '(empty)'} />
          </Section>
          <Section title="Tools schema" accent={tone.color} badge={String(toolsCount)}>
            <CodeBlock value={formatJson(call.tools)} />
          </Section>
          <Section title="Messages 时间线" accent={tone.color} defaultOpen>
            <MessagesTimeline call={call} inlineCompactionCall={inlineCompactionCall} />
          </Section>
        </div>
      )}
    </article>
  )
}

export function ObserverDrawer({ calls, activeCallId, setActiveCallId }: Props) {
  useEffect(() => {
    if (!activeCallId && calls.length > 0) {
      setActiveCallId(calls[calls.length - 1].callId)
      return
    }

    if (activeCallId && calls.every((call) => call.callId !== activeCallId)) {
      setActiveCallId(calls[calls.length - 1]?.callId ?? null)
    }
  }, [calls, activeCallId, setActiveCallId])

  return (
    <aside
      style={{
        width: 500,
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: 'rgba(8, 8, 13, 0.82)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
      }}
    >
      <div
        style={{
          padding: '16px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <strong style={{ color: 'var(--fg)', fontSize: 14 }}>Observer</strong>
        <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
          {calls.length === 0 ? 'waiting for next turn…' : `${calls.length} LLM call(s)`}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {calls.length === 0 ? (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 22,
              background: 'rgba(255, 255, 255, 0.03)',
              padding: 18,
              color: 'var(--fg-muted)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            等待下一次 LLM 调用。新的 call 会按时间顺序追加在这里。
          </div>
        ) : (
          calls.map((call, index) => (
            <ObserverCallCard
              key={call.callId}
              call={call}
              expanded={call.callId === activeCallId}
              onToggle={() => setActiveCallId(call.callId === activeCallId ? null : call.callId)}
              inlineCompactionCall={calls[index - 1]?.kind === 'compaction' ? calls[index - 1] : null}
            />
          ))
        )}
      </div>
    </aside>
  )
}
