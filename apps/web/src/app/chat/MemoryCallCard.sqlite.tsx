'use client'

import React, { useState } from 'react'
import type { LiveCall } from './observer-types'
import {
  getCallPhase,
  getMemoryFallbackKeywords,
  getMemoryHits,
  getMemoryKeywords,
  getMemoryReport,
  getMemoryTimeRange,
  getMemoryWritten,
  formatImportance,
  formatJson,
} from './observer-utils'
import { CALL_ACCENTS, CodeBlock, CollapsibleSection, DetailList, Pill, TagPills } from './observer-ui'

export function MemoryCallCardSqlite({ call }: { call: LiveCall }) {
  const phase = getCallPhase(call) ?? 'unknown'
  const keywords = getMemoryKeywords(call)
  const fallbackKeywords = getMemoryFallbackKeywords(call)
  const timeRange = getMemoryTimeRange(call)
  const hits = getMemoryHits(call)
  const written = getMemoryWritten(call)
  const report = getMemoryReport(call)
  const [open, setOpen] = useState(true)

  return (
    <article
      style={{
        border: `1px solid ${CALL_ACCENTS.memory.color}`,
        borderRadius: 20,
        background: CALL_ACCENTS.memory.soft,
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
          padding: '14px 16px',
          border: 'none',
          background: 'transparent',
          color: 'var(--fg)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--fg)', fontSize: 14 }}>memory.{phase}</strong>
          <Pill label="model" value={call.model} />
          <Pill label="stop" value={call.stopReason ?? (call.finished ? 'end_turn' : 'pending')} accent={CALL_ACCENTS.memory.color} />
        </div>
        <span style={{ color: 'var(--fg-subtle)', fontSize: 12, flexShrink: 0 }}>{open ? '收起' : '展开'}</span>
      </button>

      {open && (
        <div
          style={{
            padding: '0 16px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {phase === 'retrieve' && (
            <>
              <CollapsibleSection title="Keywords" accent={CALL_ACCENTS.memory.color} defaultOpen>
                <DetailList
                  rows={[
                    { label: 'keywords', value: <TagPills values={keywords} accent={CALL_ACCENTS.memory.color} /> },
                    { label: 'fallback keywords', value: <TagPills values={fallbackKeywords} accent={CALL_ACCENTS.memory.color} /> },
                    {
                      label: 'time range',
                      value: timeRange ? (
                        <DetailList
                          rows={[
                            { label: 'start', value: timeRange.start },
                            { label: 'end', value: timeRange.end },
                          ]}
                        />
                      ) : 'none',
                    },
                  ]}
                />
              </CollapsibleSection>

              <CollapsibleSection
                title="Hits"
                accent={CALL_ACCENTS.memory.color}
                badge={String(hits.length)}
                defaultOpen
              >
                {hits.length === 0 ? (
                  <span style={{ color: 'var(--fg-subtle)', fontSize: 13 }}>无命中</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {hits.map((hit) => (
                      <div
                        key={hit.id}
                        style={{
                          border: '1px solid rgba(52, 211, 153, 0.22)',
                          borderRadius: 14,
                          background: 'rgba(0, 0, 0, 0.2)',
                          padding: 12,
                        }}
                      >
                        <DetailList
                          rows={[
                            { label: 'memory id', value: hit.id },
                            { label: 'summary', value: hit.summary },
                            { label: 'importance', value: formatImportance(hit.importance) },
                            { label: 'matched terms', value: <TagPills values={hit.matchedTerms} accent={CALL_ACCENTS.memory.color} /> },
                            { label: 'tags', value: <TagPills values={hit.tags} accent={CALL_ACCENTS.memory.color} /> },
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleSection>
            </>
          )}

          {phase === 'summarize' && (
            <CollapsibleSection title="Written" accent={CALL_ACCENTS.memory.color} defaultOpen>
              <DetailList
                rows={[
                  ...(written?.id ? [{ label: 'written id', value: written.id }] : []),
                  { label: 'summary', value: written?.summary ?? '无' },
                  { label: 'importance', value: written ? formatImportance(written.importance) : '无' },
                  { label: 'tags', value: <TagPills values={written?.tags ?? []} accent={CALL_ACCENTS.memory.color} /> },
                ]}
              />
            </CollapsibleSection>
          )}

          {phase === 'consolidate' && (
            <CollapsibleSection title="Report" accent={CALL_ACCENTS.memory.color} defaultOpen>
              <DetailList
                rows={[
                  { label: 'before', value: String(report?.before ?? '?') },
                  { label: 'after', value: String(report?.after ?? '?') },
                  { label: 'kept', value: String(report?.kept ?? '?') },
                  { label: 'rewritten', value: String(report?.rewritten ?? '?') },
                  { label: 'merged', value: String(report?.merged ?? '?') },
                ]}
              />
            </CollapsibleSection>
          )}

          <CollapsibleSection title="原 prompt" accent={CALL_ACCENTS.memory.color}>
            <CodeBlock value={call.systemPrompt || '(empty)'} />
          </CollapsibleSection>
          <CollapsibleSection title="原 response" accent={CALL_ACCENTS.memory.color}>
            <CodeBlock value={formatJson(call.response ?? null)} />
          </CollapsibleSection>
        </div>
      )}
    </article>
  )
}
