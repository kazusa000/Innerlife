'use client'

import React, { useState, type ReactNode } from 'react'

interface Block {
  type: string
  text?: string
  name?: string
  input?: unknown
  id?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface ChatMsg {
  role: string
  content: string | Block[]
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) return ''
  const [k, v] = entries[0]
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  const trimmed = s.length > 60 ? s.slice(0, 60) + '…' : s
  return entries.length === 1 ? `${k}=${trimmed}` : `${k}=${trimmed}, +${entries.length - 1}`
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'object' && b && 'text' in b ? String((b as Block).text ?? '') : JSON.stringify(b)))
      .join('\n')
  }
  return JSON.stringify(content, null, 2)
}

function Collapsible({
  label,
  body,
  accent,
  defaultOpen = false,
}: {
  label: React.ReactNode
  body: string
  accent: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'transparent',
          border: 'none',
          color: accent,
          cursor: 'pointer',
          padding: 0,
          fontFamily: 'inherit',
          fontSize: 12,
          textAlign: 'left',
        }}
      >
        {open ? '▾' : '▸'} {label}
      </button>
      {open && (
        <pre
          style={{
            marginTop: 4,
            padding: 8,
            background: '#05050a',
            borderLeft: `2px solid ${accent}`,
            borderRadius: 2,
            whiteSpace: 'pre-wrap',
            fontSize: 11,
            color: '#cdd9e5',
            overflow: 'auto',
            maxHeight: 300,
          }}
        >
          {body}
        </pre>
      )}
    </div>
  )
}

function RenderBlock({ block }: { block: Block }) {
  if (block.type === 'text') {
    return (
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, color: '#cdd9e5' }}>{block.text}</div>
    )
  }
  if (block.type === 'tool_use') {
    return (
      <Collapsible
        label={
          <span>
            🔧 <strong>{block.name}</strong>
            <span style={{ color: '#666' }}>({summarizeInput(block.input)})</span>
          </span>
        }
        body={JSON.stringify(block.input, null, 2)}
        accent="#f0883e"
      />
    )
  }
  if (block.type === 'tool_result') {
    const body = toolResultText(block.content)
    const preview = body.split('\n')[0].slice(0, 80)
    const accent = block.is_error ? '#f85149' : '#7ee787'
    return (
      <Collapsible
        label={
          <span style={{ color: accent }}>
            {block.is_error ? '✗' : '↳'} result: <span style={{ color: '#888' }}>{preview}</span>
          </span>
        }
        body={body}
        accent={accent}
      />
    )
  }
  return (
    <pre style={{ fontSize: 11, color: '#888' }}>{JSON.stringify(block, null, 2)}</pre>
  )
}

export function MessagesView({ messages }: { messages: unknown }) {
  if (!Array.isArray(messages)) {
    return <pre style={{ fontSize: 11 }}>{JSON.stringify(messages, null, 2)}</pre>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {(messages as ChatMsg[]).map((m, i) => {
        const blocks: Block[] =
          typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content ?? []
        const roleColor = m.role === 'user' ? '#4a9eff' : m.role === 'assistant' ? '#a78bfa' : '#888'
        return (
          <div
            key={i}
            style={{
              border: '1px solid #1f1f2e',
              borderRadius: 6,
              padding: '8px 10px',
              background: '#0d0d16',
            }}
          >
            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: roleColor,
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              {m.role}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {blocks.map((b, j) => (
                <RenderBlock key={j} block={b} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function CompactionView({ metadata }: { metadata: unknown }) {
  if (!metadata || typeof metadata !== 'object') {
    return <pre style={{ fontSize: 11 }}>{JSON.stringify(metadata, null, 2)}</pre>
  }

  const record = metadata as {
    reason?: unknown
    beforeMessages?: unknown
    afterMessages?: unknown
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: '#f0883e',
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          Trigger
        </div>
        <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
          {JSON.stringify(record.reason ?? null, null, 2)}
        </pre>
      </div>
      <div>
        <div
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: '#4a9eff',
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          Before
        </div>
        <MessagesView messages={record.beforeMessages ?? []} />
      </div>
      <div>
        <div
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: '#7ee787',
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          After
        </div>
        <MessagesView messages={record.afterMessages ?? []} />
      </div>
    </div>
  )
}

export function EmotionView({
  metadata,
  latestState,
}: {
  metadata: unknown
  latestState: unknown
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: '#f0883e',
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          Analysis
        </div>
        <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
          {JSON.stringify(metadata ?? null, null, 2)}
        </pre>
      </div>
      <div>
        <div
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: '#7ee787',
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          Latest emotion_state row
        </div>
        <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
          {JSON.stringify(latestState ?? null, null, 2)}
        </pre>
      </div>
    </div>
  )
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readTextArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []
}

function MemorySection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: '#34d399',
          marginBottom: 6,
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

export function MemoryView({ metadata }: { metadata: unknown }) {
  const record = readRecord(metadata)
  const phase = readText(record?.phase) ?? 'unknown'
  const keywords = readTextArray(record?.keywords)
  const fallbackKeywords = readTextArray(record?.fallbackKeywords)
  const timeRange = readRecord(record?.timeRange)
  const timeRangeStart = readText(timeRange?.start)
  const timeRangeEnd = readText(timeRange?.end)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <MemorySection title="Phase">
        <pre style={{ fontSize: 11, color: '#cdd9e5' }}>{phase}</pre>
      </MemorySection>

      {phase === 'retrieve' && (
        <>
          <MemorySection title="Keywords">
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
              {JSON.stringify({ keywords, fallbackKeywords }, null, 2)}
            </pre>
          </MemorySection>
          <MemorySection title="Time range">
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
              {JSON.stringify(
                timeRangeStart && timeRangeEnd
                  ? { start: timeRangeStart, end: timeRangeEnd }
                  : null,
                null,
                2,
              )}
            </pre>
          </MemorySection>
          <MemorySection title="Hits">
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
              {JSON.stringify(record?.hits ?? [], null, 2)}
            </pre>
          </MemorySection>
        </>
      )}

      {phase === 'summarize' && (
        <MemorySection title="Written">
          <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
            {JSON.stringify(record?.written ?? null, null, 2)}
          </pre>
        </MemorySection>
      )}

      {phase === 'consolidate' && (
        <MemorySection title="Report">
          <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
            {JSON.stringify(record?.report ?? null, null, 2)}
          </pre>
        </MemorySection>
      )}
    </div>
  )
}

export function ResponseInfoBar({
  stopReason,
  inputTokens,
  outputTokens,
  latencyMs,
}: {
  stopReason?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  latencyMs?: number | null
}) {
  const pill = (label: string, value: string, color: string) => (
    <span
      style={{
        padding: '3px 8px',
        borderRadius: 4,
        background: '#1a1a2e',
        color,
        fontSize: 11,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <span style={{ color: '#666' }}>{label}</span> {value}
    </span>
  )
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
      {pill('stop', stopReason ?? 'pending', '#ededed')}
      {pill('in', String(inputTokens ?? '?'), '#7ee787')}
      {pill('out', String(outputTokens ?? '?'), '#f0883e')}
      {latencyMs != null && pill('time', `${(latencyMs / 1000).toFixed(2)}s`, '#a78bfa')}
    </div>
  )
}

export function ResponseView({
  response,
  stopReason,
  inputTokens,
  outputTokens,
  latencyMs,
  error,
}: {
  response: unknown
  stopReason?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  latencyMs?: number | null
  error?: string | null
}) {
  const blocks: Block[] = Array.isArray(response) ? (response as Block[]) : []
  return (
    <div>
      <ResponseInfoBar
        stopReason={stopReason}
        inputTokens={inputTokens}
        outputTokens={outputTokens}
        latencyMs={latencyMs}
      />
      {error && (
        <div
          style={{
            padding: 8,
            background: '#2a0f0f',
            border: '1px solid #f85149',
            borderRadius: 4,
            color: '#f85149',
            marginBottom: 8,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
      {blocks.length === 0 && !error ? (
        <div style={{ color: '#666', fontSize: 12 }}>(pending)</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {blocks.map((b, i) => (
            <RenderBlock key={i} block={b} />
          ))}
        </div>
      )}
    </div>
  )
}
