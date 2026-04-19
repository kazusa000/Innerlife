'use client'

import React from 'react'
import type { LiveCall } from './observer-types'

interface Props {
  call: LiveCall
  compactionCall?: LiveCall
}

interface TimelineBlock {
  type: string
  text?: string
  name?: string
  input?: unknown
  id?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface TimelineMessage {
  role: string
  content: string | TimelineBlock[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value, null, 2)
}

function blockPreview(input: unknown): string {
  const record = asRecord(input)
  if (!record) {
    return ''
  }

  const entries = Object.entries(record)
  if (entries.length === 0) {
    return ''
  }

  const [key, value] = entries[0]
  const preview = stringify(value)
  return entries.length === 1
    ? `${key}=${preview.slice(0, 72)}`
    : `${key}=${preview.slice(0, 48)}, +${entries.length - 1}`
}

function renderTextBlocks(blocks: TimelineBlock[]) {
  return blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function buildTimeline(call: LiveCall): TimelineMessage[] {
  const baseMessages = asArray<TimelineMessage>(call.messages)
  const responseBlocks = asArray<TimelineBlock>(call.response)

  if (responseBlocks.length === 0 && !call.error) {
    return baseMessages
  }

  return [
    ...baseMessages,
    {
      role: 'assistant',
      content: responseBlocks.length > 0
        ? responseBlocks
        : [{ type: 'text', text: call.error ?? '(pending)' }],
    },
  ]
}

function roleLabel(role: string) {
  if (role === 'user') {
    return { text: 'user', color: 'var(--indigo)' }
  }

  if (role === 'assistant') {
    return { text: 'assistant', color: '#c5b7ff' }
  }

  return { text: role, color: 'var(--fg-muted)' }
}

function TimelinePre({ text, accent }: { text: string; accent: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: '12px 14px',
        borderRadius: 'var(--radius)',
        background: 'rgba(0, 0, 0, 0.28)',
        border: `1px solid ${accent}`,
        color: 'var(--fg)',
        fontSize: 12,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        overflowX: 'auto',
      }}
    >
      {text}
    </pre>
  )
}

function ToolCard({
  block,
  accent,
  label,
}: {
  block: TimelineBlock
  accent: string
  label: string
}) {
  const body = block.type === 'tool_result'
    ? stringify(block.content)
    : JSON.stringify(block.input ?? {}, null, 2)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 'var(--radius)',
        background: 'rgba(255, 255, 255, 0.03)',
        border: `1px solid ${accent}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            padding: '4px 8px',
            borderRadius: 'var(--radius-pill)',
            background: accent === 'var(--danger)' ? 'rgba(248, 113, 113, 0.14)' : 'rgba(251, 146, 60, 0.14)',
            color: accent,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
        {block.name && (
          <code style={{ color: 'var(--fg)', fontSize: 12 }}>
            {block.name}
            {block.type === 'tool_use' && block.input != null && (
              <span style={{ color: 'var(--fg-muted)' }}> · {blockPreview(block.input)}</span>
            )}
          </code>
        )}
      </div>
      <TimelinePre text={body} accent={accent} />
    </div>
  )
}

function CompactionInlineCard({ call }: { call: LiveCall }) {
  const metadata = asRecord(call.metadata)
  const beforeMessageCount = typeof metadata?.beforeMessageCount === 'number'
    ? metadata.beforeMessageCount
    : asArray(metadata?.beforeMessages).length
  const afterMessageCount = typeof metadata?.afterMessageCount === 'number'
    ? metadata.afterMessageCount
    : asArray(metadata?.afterMessages).length
  const keptCount = Math.max(afterMessageCount - 1, 0)
  const compactedCount = Math.max(beforeMessageCount - keptCount, 0)
  const summary = typeof metadata?.summary === 'string' ? metadata.summary : ''

  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 'var(--radius)',
        border: '1px solid rgba(251, 146, 60, 0.3)',
        background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.16), rgba(255, 255, 255, 0.03))',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            padding: '4px 8px',
            borderRadius: 'var(--radius-pill)',
            background: 'rgba(251, 146, 60, 0.18)',
            color: 'var(--orange)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          compaction
        </span>
        <span style={{ color: 'var(--fg)', fontSize: 13 }}>
          本轮压缩：{compactedCount} 条 → 1 条摘要
        </span>
      </div>
      {summary && (
        <TimelinePre text={summary} accent="rgba(251, 146, 60, 0.24)" />
      )}
    </div>
  )
}

function MessageCard({ message }: { message: TimelineMessage }) {
  const blocks = typeof message.content === 'string'
    ? [{ type: 'text', text: message.content }]
    : asArray<TimelineBlock>(message.content)
  const role = roleLabel(message.role)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '16px',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        background: 'rgba(255, 255, 255, 0.03)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: role.color,
          }}
        >
          {role.text}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {blocks.map((block, index) => {
          if (block.type === 'tool_use') {
            return (
              <ToolCard
                key={`${message.role}-${index}-${block.name ?? block.type}`}
                block={block}
                accent="var(--orange)"
                label="tool use"
              />
            )
          }

          if (block.type === 'tool_result') {
            return (
              <ToolCard
                key={`${message.role}-${index}-${block.tool_use_id ?? block.type}`}
                block={block}
                accent={block.is_error ? 'var(--danger)' : 'rgba(74, 222, 128, 0.35)'}
                label={block.is_error ? 'tool error' : 'tool result'}
              />
            )
          }

          if (block.type === 'text') {
            return (
              <TimelinePre
                key={`${message.role}-${index}-text`}
                text={renderTextBlocks([block])}
                accent="var(--border)"
              />
            )
          }

          return (
            <TimelinePre
              key={`${message.role}-${index}-${block.type}`}
              text={JSON.stringify(block, null, 2)}
              accent="var(--border)"
            />
          )
        })}
      </div>
    </div>
  )
}

export function MessagesTimeline({ call, compactionCall }: Props) {
  const timeline = buildTimeline(call)

  if (timeline.length === 0 && !compactionCall) {
    return (
      <div
        style={{
          padding: '16px',
          borderRadius: 'var(--radius-lg)',
          border: '1px dashed var(--border)',
          color: 'var(--fg-subtle)',
          fontSize: 13,
        }}
      >
        No messages recorded for this call yet.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {compactionCall && <CompactionInlineCard call={compactionCall} />}
      {timeline.map((message, index) => (
        <MessageCard key={`${call.callId}-${index}`} message={message} />
      ))}
    </div>
  )
}
