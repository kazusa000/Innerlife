'use client'

import React, { useState, type ReactNode } from 'react'
import type { LiveCall } from './observer-types'
import {
  blockText,
  formatJson,
  summarizeInput,
  toBlocks,
  toMessages,
  type ConversationBlock,
} from './observer-utils'

export interface AccentTone {
  color: string
  soft: string
}

export const CALL_ACCENTS: Record<string, AccentTone> = {
  turn: { color: 'var(--indigo)', soft: 'rgba(129, 140, 248, 0.14)' },
  memory: { color: '#34d399', soft: 'rgba(52, 211, 153, 0.14)' },
  emotion: { color: '#f472b6', soft: 'rgba(244, 114, 182, 0.14)' },
  relationship: { color: '#38bdf8', soft: 'rgba(56, 189, 248, 0.14)' },
  compaction: { color: 'var(--orange)', soft: 'rgba(251, 146, 60, 0.14)' },
  personality: { color: 'var(--indigo)', soft: 'rgba(129, 140, 248, 0.14)' },
  values: { color: '#fbbf24', soft: 'rgba(251, 191, 36, 0.14)' },
}

export function CodeBlock({
  value,
  maxHeight,
}: {
  value: string
  maxHeight?: number | string
}) {
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
        overflowY: maxHeight ? 'auto' : undefined,
        maxHeight,
      }}
    >
      {value}
    </pre>
  )
}

export function EmptyState({
  title,
  body,
}: {
  title: string
  body: string
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 22,
        background: 'rgba(255, 255, 255, 0.03)',
        padding: 18,
        color: 'var(--fg-muted)',
        fontSize: 13,
        lineHeight: 1.6,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <strong style={{ color: 'var(--fg)', fontSize: 14 }}>{title}</strong>
      <span>{body}</span>
    </div>
  )
}

export function Pill({
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

export function TagPills({
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

export function DetailList({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode }>
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              color: 'var(--fg-subtle)',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: 0.04 * 16,
            }}
          >
            {row.label}
          </span>
          <div style={{ color: 'var(--fg)', fontSize: 13 }}>{row.value}</div>
        </div>
      ))}
    </div>
  )
}

export function CollapsibleSection({
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
      {open && <div style={{ padding: '0 14px 14px' }}>{children}</div>}
    </div>
  )
}

function RenderBlock({ block }: { block: ConversationBlock }) {
  if (block.type === 'text') {
    return <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{block.text}</div>
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
          <span style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>{summarizeInput(block.input)}</span>
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
  const roleTone: Record<string, AccentTone> = {
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
  const metadata = call.metadata ?? {}
  const beforeMessageCount =
    typeof metadata.beforeMessageCount === 'number'
      ? metadata.beforeMessageCount
      : Array.isArray(metadata.beforeMessages)
        ? metadata.beforeMessages.length
        : null
  const afterMessageCount =
    typeof metadata.afterMessageCount === 'number'
      ? metadata.afterMessageCount
      : Array.isArray(metadata.afterMessages)
        ? metadata.afterMessages.length
        : null
  const summary = typeof metadata.summary === 'string' ? metadata.summary : null

  if (beforeMessageCount === null && afterMessageCount === null && !summary) {
    return null
  }

  const compactedCount = beforeMessageCount !== null && afterMessageCount !== null
    ? Math.max(0, beforeMessageCount - afterMessageCount + 1)
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
          本轮压缩：{compactedCount ?? beforeMessageCount ?? '?'} 条 → 1 条摘要
        </span>
      </div>
      {summary && <CodeBlock value={summary} />}
    </div>
  )
}

export function MessagesTimeline({
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
        <MessageCard key={`${message.role}-${index}`} role={message.role} content={message.content} />
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
        <div style={{ color: 'var(--fg-subtle)', fontSize: 13 }}>等待该 call 的消息快照…</div>
      )}
    </div>
  )
}
