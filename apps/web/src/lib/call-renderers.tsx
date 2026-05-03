'use client'

import React, { useState, type ReactNode } from 'react'
import { OBSERVER_UI_COPY, translateRole } from './ui-copy'

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
            {block.is_error ? '✗' : '↳'} {OBSERVER_UI_COPY.result}： <span style={{ color: '#888' }}>{preview}</span>
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
              {translateRole(m.role)}
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
          {OBSERVER_UI_COPY.trigger}
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
          {OBSERVER_UI_COPY.before}
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
          {OBSERVER_UI_COPY.after}
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
          {OBSERVER_UI_COPY.analysis}
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
          {OBSERVER_UI_COPY.latestEmotionState}
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

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readTextArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []
}

function formatScore(value: unknown) {
  const number = readNumber(value)
  return number === null ? '无' : number.toFixed(2)
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
  const mode = readText(record?.mode)
  const phase = readText(record?.phase) ?? 'unknown'
  const mergedQuery = readRecord(record?.mergedQuery)
  const retrievalQuery = readText(mergedQuery?.retrievalQuery) ?? readText(record?.retrievalQuery)
  const timeRange = readRecord(mergedQuery?.timeRange) ?? readRecord(record?.timeRange)
  const timeRangeStart = readText(timeRange?.start)
  const timeRangeEnd = readText(timeRange?.end)
  const written = readRecord(record?.written)

  const formatLayer = (layer: string | null) => {
    switch (layer) {
      case 'long_term':
        return '长期记忆'
      case 'fixed':
        return '固化记忆'
      case 'short_term':
        return '短期记忆'
      default:
        return null
    }
  }

  if (mode === 'episodic_hybrid') {
    const entityMentions = Array.isArray(record?.entityMentions)
      ? record.entityMentions.flatMap((mention) => {
        const mentionRecord = readRecord(mention)
        const surface = readText(mentionRecord?.surface)
        if (!surface) {
          return []
        }
        const type = readText(mentionRecord?.type)
        return [{ surface, type }]
      })
      : []
    const entityCandidates = Array.isArray(record?.entityCandidates)
      ? record.entityCandidates.flatMap((candidate) => {
        const candidateRecord = readRecord(candidate)
        const mentionRecord = readRecord(candidateRecord?.mention)
        const entityRecord = readRecord(candidateRecord?.entity)
        const surface = readText(mentionRecord?.surface)
        const canonicalName = readText(entityRecord?.canonicalName)
        if (!surface || !canonicalName) {
          return []
        }
        return [{
          surface,
          canonicalName,
          entityId: readText(entityRecord?.id),
          type: readText(entityRecord?.type),
          matchKind: readText(candidateRecord?.matchKind),
        }]
      })
      : []
    const activatedEntities = Array.isArray(record?.activatedEntities)
      ? record.activatedEntities.flatMap((entity) => {
        const entityRecord = readRecord(entity)
        const canonicalName = readText(entityRecord?.canonicalName)
        if (!canonicalName) {
          return []
        }
        return [{
          canonicalName,
          entityId: readText(entityRecord?.id),
          type: readText(entityRecord?.type),
          activation: readNumber(entityRecord?.activation),
        }]
      })
      : []
    const hits = Array.isArray(record?.hits)
      ? record.hits.flatMap((hit) => {
        const hitRecord = readRecord(hit)
        const id = readText(hitRecord?.id)
        const summary = readText(hitRecord?.summary)
        if (!id || !summary) {
          return []
        }
        const entities = Array.isArray(hitRecord?.entities)
          ? hitRecord.entities.flatMap((entity) => {
            const entityRecord = readRecord(entity)
            const canonicalName = readText(entityRecord?.canonicalName)
            if (!canonicalName) {
              return []
            }
            return [{
              canonicalName,
              type: readText(entityRecord?.type),
              weight: readNumber(entityRecord?.weight),
            }]
          })
          : []

        return [{
          id,
          summary,
          importance: hitRecord?.importance,
          graphScore: hitRecord?.graphScore,
          textScore: hitRecord?.textScore,
          score: hitRecord?.score,
          entities,
        }]
      })
      : []

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <MemorySection title="Hybrid Episodic Recall">
          <pre style={{ fontSize: 11, color: '#cdd9e5' }}>{mode}</pre>
        </MemorySection>
        <MemorySection title="Text Query">
          <pre style={{ fontSize: 11, color: '#cdd9e5' }}>{readText(record?.textQuery) ?? '无'}</pre>
        </MemorySection>
        <MemorySection title="Entity Mentions">
          {entityMentions.length === 0 ? (
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>[]</pre>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {entityMentions.map((mention, index) => (
                <span
                  key={`${mention.surface}-${index}`}
                  style={{
                    border: '1px solid rgba(52, 211, 153, 0.28)',
                    borderRadius: 999,
                    padding: '5px 9px',
                    color: '#bbf7d0',
                    background: 'rgba(52, 211, 153, 0.08)',
                    fontSize: 12,
                  }}
                >
                  {mention.surface}{mention.type ? ` · ${mention.type}` : ''}
                </span>
              ))}
            </div>
          )}
        </MemorySection>
        <MemorySection title="Mention Candidates">
          {entityCandidates.length === 0 ? (
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>[]</pre>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entityCandidates.map((candidate, index) => (
                <div
                  key={`${candidate.surface}-${candidate.entityId ?? candidate.canonicalName}-${index}`}
                  style={{
                    border: '1px solid rgba(96, 165, 250, 0.22)',
                    borderRadius: 10,
                    padding: 9,
                    color: '#dbeafe',
                    background: 'rgba(96, 165, 250, 0.07)',
                    fontSize: 12,
                  }}
                >
                  <strong>{candidate.surface}</strong>
                  <span style={{ color: '#93c5fd' }}> → </span>
                  <strong>{candidate.canonicalName}</strong>
                  <span style={{ color: '#93c5fd' }}>
                    {candidate.type ? ` · ${candidate.type}` : ''}
                    {candidate.matchKind ? ` · ${candidate.matchKind}` : ''}
                    {candidate.entityId ? ` · ${candidate.entityId}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </MemorySection>
        <MemorySection title="Activated Entities">
          {activatedEntities.length === 0 ? (
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>[]</pre>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {activatedEntities.map((entity, index) => (
                <span
                  key={`${entity.entityId ?? entity.canonicalName}-${index}`}
                  style={{
                    color: '#fde68a',
                    background: 'rgba(251, 191, 36, 0.1)',
                    border: '1px solid rgba(251, 191, 36, 0.22)',
                    borderRadius: 999,
                    padding: '5px 9px',
                    fontSize: 12,
                  }}
                >
                  {entity.canonicalName}
                  {entity.type ? ` · ${entity.type}` : ''}
                  {entity.activation !== null ? ` · ${entity.activation.toFixed(2)}` : ''}
                </span>
              ))}
            </div>
          )}
        </MemorySection>
        <MemorySection title={OBSERVER_UI_COPY.hits}>
          {hits.length === 0 ? (
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>[]</pre>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {hits.map((hit) => (
                <div
                  key={hit.id}
                  style={{
                    border: '1px solid rgba(52, 211, 153, 0.24)',
                    borderRadius: 12,
                    padding: 10,
                    background: 'rgba(5, 10, 22, 0.82)',
                  }}
                >
                  <div style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: 8 }}>{hit.summary}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, color: '#cdd9e5', fontSize: 12 }}>
                    <span>图分数 {formatScore(hit.graphScore)}</span>
                    <span>文本分数 {formatScore(hit.textScore)}</span>
                    <span>最终分数 {formatScore(hit.score)}</span>
                    <span>重要性 {formatScore(hit.importance)}</span>
                  </div>
                  {hit.entities.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {hit.entities.map((entity) => (
                        <span
                          key={`${hit.id}-${entity.canonicalName}`}
                          style={{
                            color: '#bfdbfe',
                            background: 'rgba(96, 165, 250, 0.1)',
                            borderRadius: 999,
                            padding: '4px 8px',
                            fontSize: 11,
                          }}
                        >
                          {entity.canonicalName}{entity.weight !== null ? ` · ${entity.weight.toFixed(2)}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </MemorySection>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <MemorySection title={OBSERVER_UI_COPY.phase}>
        <pre style={{ fontSize: 11, color: '#cdd9e5' }}>{phase}</pre>
      </MemorySection>

      {phase === 'retrieve' && (
        <>
          <MemorySection title="Time Analyzer">
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
              {JSON.stringify(readRecord(record?.timeAnalyzer) ?? null, null, 2)}
            </pre>
          </MemorySection>
          <MemorySection title="Semantic Analyzer">
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
              {JSON.stringify(readRecord(record?.semanticAnalyzer) ?? null, null, 2)}
            </pre>
          </MemorySection>
          <MemorySection title="Merged Query">
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
              {JSON.stringify({ retrievalQuery, timeRange: timeRangeStart && timeRangeEnd ? { start: timeRangeStart, end: timeRangeEnd } : null }, null, 2)}
            </pre>
          </MemorySection>
          <MemorySection title={OBSERVER_UI_COPY.hits}>
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
              {JSON.stringify(record?.hits ?? [], null, 2)}
            </pre>
          </MemorySection>
        </>
      )}

      {phase === 'summarize' && (
        <>
          {formatLayer(readText(written?.layer)) && (
            <MemorySection title="层级">
              <pre style={{ fontSize: 11, color: '#cdd9e5' }}>{formatLayer(readText(written?.layer))}</pre>
            </MemorySection>
          )}
          <MemorySection title={OBSERVER_UI_COPY.written}>
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
              {JSON.stringify(record?.written ?? null, null, 2)}
            </pre>
          </MemorySection>
        </>
      )}

      {phase === 'consolidate' && (
        <>
          {formatLayer(readText(readRecord(record?.report)?.layer)) && (
            <MemorySection title="层级">
              <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
                {formatLayer(readText(readRecord(record?.report)?.layer))}
              </pre>
            </MemorySection>
          )}
          <MemorySection title={OBSERVER_UI_COPY.report}>
            <pre style={{ fontSize: 11, color: '#cdd9e5' }}>
              {JSON.stringify(record?.report ?? null, null, 2)}
            </pre>
          </MemorySection>
        </>
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
      {pill(OBSERVER_UI_COPY.stop, stopReason ?? OBSERVER_UI_COPY.pending, '#ededed')}
      {pill(OBSERVER_UI_COPY.inputTokens, String(inputTokens ?? '?'), '#7ee787')}
      {pill(OBSERVER_UI_COPY.outputTokens, String(outputTokens ?? '?'), '#f0883e')}
      {latencyMs != null && pill(OBSERVER_UI_COPY.duration, `${(latencyMs / 1000).toFixed(2)}s`, '#a78bfa')}
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
        <div style={{ color: '#666', fontSize: 12 }}>（{OBSERVER_UI_COPY.pending}）</div>
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
