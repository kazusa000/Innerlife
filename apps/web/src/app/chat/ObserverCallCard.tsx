'use client'

import React, { useState, type CSSProperties, type ReactNode } from 'react'
import { MessagesTimeline } from './MessagesTimeline'
import type { LiveCall } from './observer-types'

interface Props {
  call: LiveCall
  compactionCall?: LiveCall
  open: boolean
  onToggle: () => void
}

interface PromptFragment {
  source: string
  priority: number
  content: string
}

interface EmotionState {
  mood: number
  energy: number
  stress: number
}

interface MemoryHit {
  id: string
  summary: string
  tags: string[]
  importance: number
  matchedTerms?: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function asFragments(value: unknown): PromptFragment[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      const record = asRecord(item)
      if (!record) {
        return null
      }

      return {
        source: typeof record.source === 'string' ? record.source : '',
        priority: typeof record.priority === 'number' ? record.priority : 0,
        content: typeof record.content === 'string' ? record.content : '',
      }
    })
    .filter((item): item is PromptFragment => !!item && !!item.source && !!item.content)
}

function asEmotionState(value: unknown): EmotionState | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const mood = typeof record.mood === 'number' ? record.mood : null
  const energy = typeof record.energy === 'number' ? record.energy : null
  const stress = typeof record.stress === 'number' ? record.stress : null

  return mood === null || energy === null || stress === null
    ? null
    : { mood, energy, stress }
}

function asMemoryHits(value: unknown): MemoryHit[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map<MemoryHit | null>((item) => {
      const record = asRecord(item)
      if (!record) {
        return null
      }

      const hit: MemoryHit = {
        id: typeof record.id === 'string' ? record.id : '',
        summary: typeof record.summary === 'string' ? record.summary : '',
        tags: asStringArray(record.tags),
        importance: typeof record.importance === 'number' ? record.importance : 0,
        matchedTerms: asStringArray(record.matchedTerms),
      }

      return hit
    })
    .filter((item): item is MemoryHit => item !== null && item.id.length > 0)
}

function callLabel(call: LiveCall): string {
  const metadata = asRecord(call.metadata)
  const phase = typeof metadata?.phase === 'string' ? metadata.phase : null

  if (call.kind === 'turn') {
    return '主对话'
  }

  if (call.kind === 'memory' && phase) {
    return `memory.${phase}`
  }

  if (call.kind === 'emotion') {
    return 'emotion.delta'
  }

  if (call.kind === 'compaction') {
    return 'compaction.summary'
  }

  return call.kind ?? 'call'
}

function callAccent(call: LiveCall): string {
  if (call.kind === 'memory') {
    return '#31c48d'
  }

  if (call.kind === 'emotion') {
    return '#ff6ea9'
  }

  if (call.kind === 'compaction') {
    return 'var(--orange)'
  }

  return 'var(--indigo)'
}

function callAccentSoft(call: LiveCall): string {
  if (call.kind === 'memory') {
    return 'rgba(49, 196, 141, 0.16)'
  }

  if (call.kind === 'emotion') {
    return 'rgba(255, 110, 169, 0.16)'
  }

  if (call.kind === 'compaction') {
    return 'rgba(251, 146, 60, 0.16)'
  }

  return 'var(--indigo-soft)'
}

function getFragmentsBySource(call: LiveCall) {
  const metadata = asRecord(call.metadata)
  return asFragments(metadata?.fragments).reduce<Record<string, string[]>>((result, fragment) => {
    result[fragment.source] ??= []
    result[fragment.source].push(fragment.content)
    return result
  }, {})
}

function formatSystemText(content: string[] | undefined): string | null {
  if (!content || content.length === 0) {
    return null
  }

  return content.join('\n\n')
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatSigned(value: number) {
  return value > 0 ? `+${value.toFixed(3)}` : value.toFixed(3)
}

function Pill({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: string
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 9px',
        borderRadius: 'var(--radius-pill)',
        background: 'rgba(255, 255, 255, 0.04)',
        border: `1px solid ${accent}`,
        color: 'var(--fg)',
        fontSize: 11,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span>{value}</span>
    </span>
  )
}

function Section({
  title,
  defaultOpen = false,
  children,
  accent,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
  accent: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        background: 'rgba(255, 255, 255, 0.02)',
        overflow: 'hidden',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          listStyle: 'none',
          padding: '14px 16px',
          color: accent,
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        {title}
      </summary>
      <div style={{ padding: '0 16px 16px' }}>{children}</div>
    </details>
  )
}

function TextPanel({ text, accent }: { text: string; accent: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: '14px 16px',
        borderRadius: 'var(--radius)',
        background: 'rgba(0, 0, 0, 0.28)',
        border: `1px solid ${accent}`,
        color: 'var(--fg)',
        fontSize: 12,
        lineHeight: 1.65,
        whiteSpace: 'pre-wrap',
        overflowX: 'auto',
      }}
    >
      {text}
    </pre>
  )
}

function DimensionCard({
  title,
  accent,
  children,
}: {
  title: string
  accent: string
  children: ReactNode
}) {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '16px',
        borderRadius: 'var(--radius-lg)',
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02))',
        border: `1px solid ${accent}`,
        boxShadow: 'var(--shadow-lift)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: accent,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </div>
      {children}
    </section>
  )
}

function EmotionRows({
  before,
  after,
  delta,
}: {
  before: EmotionState
  after: EmotionState
  delta: EmotionState
}) {
  const rows = [
    { key: 'mood', label: 'mood', before: before.mood, after: after.mood, delta: delta.mood },
    { key: 'energy', label: 'energy', before: before.energy, after: after.energy, delta: delta.energy },
    { key: 'stress', label: 'stress', before: before.stress, after: after.stress, delta: delta.stress },
  ]

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            display: 'grid',
            gridTemplateColumns: '90px 1fr 1fr 1fr',
            gap: 10,
            alignItems: 'center',
            padding: '12px 14px',
            borderRadius: 'var(--radius)',
            background: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{row.label}</span>
          <span style={{ color: 'var(--fg-muted)' }}>before {row.before.toFixed(3)}</span>
          <span style={{ color: 'var(--fg)' }}>after {row.after.toFixed(3)}</span>
          <span style={{ color: row.delta >= 0 ? '#79e6b0' : '#ff9bc2' }}>
            {formatSigned(row.delta)}
          </span>
        </div>
      ))}
    </div>
  )
}

function MemoryHitCard({ hit }: { hit: MemoryHit }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        borderRadius: 'var(--radius)',
        background: 'rgba(0, 0, 0, 0.2)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <code style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{hit.id}</code>
        <span style={{ color: '#79e6b0', fontSize: 12 }}>
          importance {formatPercent(hit.importance)}
        </span>
      </div>
      <div style={{ color: 'var(--fg)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{hit.summary}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {hit.tags.map((tag) => (
          <Pill key={`${hit.id}-${tag}`} label="tag" value={tag} accent="rgba(49, 196, 141, 0.35)" />
        ))}
        {(hit.matchedTerms ?? []).map((term) => (
          <Pill key={`${hit.id}-${term}`} label="match" value={term} accent="rgba(129, 140, 248, 0.32)" />
        ))}
      </div>
    </div>
  )
}

function renderDimensionCards(call: LiveCall) {
  const metadata = asRecord(call.metadata)
  const fragments = getFragmentsBySource(call)
  const cards: ReactNode[] = []

  const personality = formatSystemText(fragments.personality)
  if (personality) {
    cards.push(
      <DimensionCard key="personality" title="性格" accent="#6f86ff">
        <TextPanel text={personality} accent="rgba(111, 134, 255, 0.32)" />
      </DimensionCard>,
    )
  }

  const values = formatSystemText(fragments.values)
  if (values) {
    cards.push(
      <DimensionCard key="values" title="价值观" accent="#f4b45c">
        <TextPanel text={values} accent="rgba(244, 180, 92, 0.32)" />
      </DimensionCard>,
    )
  }

  const emotionFragment = formatSystemText(fragments.emotion)
  const before = asEmotionState(metadata?.before)
  const after = asEmotionState(metadata?.after)
  const delta = asEmotionState(metadata?.delta)
  const trigger = typeof metadata?.trigger === 'string' ? metadata.trigger : null
  if (before && after && delta) {
    cards.push(
      <DimensionCard key="emotion-metadata" title="情绪" accent="#ff6ea9">
        <EmotionRows before={before} after={after} delta={delta} />
        {trigger && (
          <TextPanel text={`trigger\n${trigger}`} accent="rgba(255, 110, 169, 0.32)" />
        )}
      </DimensionCard>,
    )
  } else if (emotionFragment) {
    cards.push(
      <DimensionCard key="emotion-fragment" title="情绪" accent="#ff6ea9">
        <TextPanel text={emotionFragment} accent="rgba(255, 110, 169, 0.32)" />
      </DimensionCard>,
    )
  }

  const memoryFragment = formatSystemText(fragments.memory)
  const phase = typeof metadata?.phase === 'string' ? metadata.phase : null
  if (call.kind === 'memory' && phase === 'retrieve') {
    const keywords = asStringArray(metadata?.keywords)
    const hits = asMemoryHits(metadata?.hits)
    cards.push(
      <DimensionCard key="memory-retrieve" title="记忆" accent="#31c48d">
        {keywords.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {keywords.map((keyword) => (
              <Pill key={keyword} label="keyword" value={keyword} accent="rgba(49, 196, 141, 0.35)" />
            ))}
          </div>
        )}
        {hits.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {hits.map((hit) => (
              <MemoryHitCard key={hit.id} hit={hit} />
            ))}
          </div>
        ) : (
          <TextPanel text="No memory hits." accent="rgba(49, 196, 141, 0.28)" />
        )}
      </DimensionCard>,
    )
  } else if (call.kind === 'memory' && phase === 'summarize') {
    const written = asRecord(metadata?.written)
    const tags = asStringArray(written?.tags)
    cards.push(
      <DimensionCard key="memory-summarize" title="记忆" accent="#31c48d">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {typeof written?.importance === 'number' && (
            <Pill label="importance" value={formatPercent(written.importance)} accent="rgba(49, 196, 141, 0.35)" />
          )}
          {typeof written?.id === 'string' && (
            <Pill label="id" value={written.id} accent="rgba(49, 196, 141, 0.35)" />
          )}
        </div>
        <TextPanel
          text={typeof written?.summary === 'string' ? written.summary : 'No written memory summary.'}
          accent="rgba(49, 196, 141, 0.28)"
        />
        {tags.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {tags.map((tag) => (
              <Pill key={tag} label="tag" value={tag} accent="rgba(49, 196, 141, 0.35)" />
            ))}
          </div>
        )}
      </DimensionCard>,
    )
  } else if (call.kind === 'memory' && phase === 'consolidate') {
    const report = asRecord(metadata?.report)
    cards.push(
      <DimensionCard key="memory-consolidate" title="记忆" accent="#31c48d">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['before', 'after', 'kept', 'rewritten', 'merged'].map((key) =>
            typeof report?.[key] === 'number'
              ? (
                  <Pill
                    key={key}
                    label={key}
                    value={String(report[key])}
                    accent="rgba(49, 196, 141, 0.35)"
                  />
                )
              : null,
          )}
        </div>
      </DimensionCard>,
    )
  } else if (memoryFragment) {
    cards.push(
      <DimensionCard key="memory-fragment" title="记忆" accent="#31c48d">
        <TextPanel text={memoryFragment} accent="rgba(49, 196, 141, 0.32)" />
      </DimensionCard>,
    )
  }

  return cards
}

function formatMetadataBlock(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function headerStyle(accent: string, open: boolean): CSSProperties {
  return {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '16px 18px',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    borderBottom: open ? '1px solid var(--border)' : 'none',
  }
}

export function ObserverCallCard({ call, compactionCall, open, onToggle }: Props) {
  const accent = callAccent(call)
  const accentSoft = callAccentSoft(call)
  const metadata = asRecord(call.metadata)
  const dimensions = renderDimensionCards(call)
  const infoPills = [
    <Pill key="model" label="model" value={call.model} accent={accent} />,
    <Pill key="turn" label="call" value={`#${call.turnIndex}`} accent={accent} />,
    <Pill key="stop" label="stop" value={call.stopReason ?? 'pending'} accent={accent} />,
  ]

  if (call.usage) {
    infoPills.push(
      <Pill key="tokens" label="tokens" value={`${call.usage.inputTokens}/${call.usage.outputTokens}`} accent={accent} />,
    )
  }

  return (
    <article
      className="card"
      style={{
        overflow: 'hidden',
        borderColor: open ? accent : 'var(--border)',
        background: open ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.03)',
      }}
    >
      <button onClick={onToggle} style={headerStyle(accent, open)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '5px 9px',
                borderRadius: 'var(--radius-pill)',
                background: accentSoft,
                color: accent,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              {callLabel(call)}
            </span>
            <span style={{ color: 'var(--fg)', fontSize: 14, fontWeight: 600 }}>
              {call.finished ? 'finished' : 'streaming'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {infoPills}
          </div>
        </div>
        <span style={{ color: accent, fontSize: 18 }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16 }}>
          {call.error && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius)',
                border: '1px solid rgba(248, 113, 113, 0.35)',
                background: 'rgba(248, 113, 113, 0.12)',
                color: '#ffb0b0',
                fontSize: 13,
              }}
            >
              {call.error}
            </div>
          )}

          {dimensions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {dimensions}
            </div>
          )}

          <Section title="Final system prompt" accent={accent}>
            <TextPanel text={call.systemPrompt || '(empty)'} accent={accent} />
          </Section>

          <Section title="Tools schema" accent={accent}>
            <TextPanel text={formatMetadataBlock(call.tools)} accent={accent} />
          </Section>

          <Section title="Messages 时间线" defaultOpen accent={accent}>
            <MessagesTimeline call={call} compactionCall={compactionCall} />
          </Section>

          {call.kind !== 'turn' && metadata && (
            <Section title="Raw metadata" accent={accent}>
              <TextPanel text={formatMetadataBlock(metadata)} accent={accent} />
            </Section>
          )}
        </div>
      )}
    </article>
  )
}
