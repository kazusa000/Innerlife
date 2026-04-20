'use client'

import React, { useState } from 'react'
import type { LiveCall } from './observer-types'
import { formatDurationLabel } from '../../lib/format-duration'
import { OBSERVER_UI_COPY, translateMemoryPhase } from '../../lib/ui-copy'
import {
  getCallPhase,
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
  const duration = formatDurationLabel(call.startedAt, call.finishedAt)
  const keywords = getMemoryKeywords(call)
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
          <strong style={{ color: 'var(--fg)', fontSize: 14 }}>记忆.{translateMemoryPhase(phase)}</strong>
          <Pill label={OBSERVER_UI_COPY.model} value={call.model} />
          {duration ? <Pill label={OBSERVER_UI_COPY.duration} value={duration} /> : null}
          <Pill label={OBSERVER_UI_COPY.stop} value={call.stopReason ?? (call.finished ? 'end_turn' : OBSERVER_UI_COPY.pending)} accent={CALL_ACCENTS.memory.color} />
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
              <CollapsibleSection title={OBSERVER_UI_COPY.keywords} accent={CALL_ACCENTS.memory.color} defaultOpen>
                <DetailList
                  rows={[
                    { label: OBSERVER_UI_COPY.keywords, value: <TagPills values={keywords} accent={CALL_ACCENTS.memory.color} /> },
                    {
                      label: OBSERVER_UI_COPY.timeRange,
                      value: timeRange ? (
                        <DetailList
                          rows={[
                            { label: '开始', value: timeRange.start },
                            { label: '结束', value: timeRange.end },
                          ]}
                        />
                      ) : '无',
                    },
                  ]}
                />
              </CollapsibleSection>

              <CollapsibleSection
                title={OBSERVER_UI_COPY.hits}
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
                            { label: '记忆 ID', value: hit.id },
                            { label: '摘要', value: hit.summary },
                            { label: '重要性', value: formatImportance(hit.importance) },
                            { label: '命中词', value: <TagPills values={hit.matchedTerms} accent={CALL_ACCENTS.memory.color} /> },
                            { label: '标签', value: <TagPills values={hit.tags} accent={CALL_ACCENTS.memory.color} /> },
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
            <CollapsibleSection title={OBSERVER_UI_COPY.written} accent={CALL_ACCENTS.memory.color} defaultOpen>
              <DetailList
                rows={[
                  ...(written?.id ? [{ label: '写入 ID', value: written.id }] : []),
                  { label: '摘要', value: written?.summary ?? '无' },
                  { label: '重要性', value: written ? formatImportance(written.importance) : '无' },
                  { label: '标签', value: <TagPills values={written?.tags ?? []} accent={CALL_ACCENTS.memory.color} /> },
                ]}
              />
            </CollapsibleSection>
          )}

          {phase === 'consolidate' && (
            <CollapsibleSection title={OBSERVER_UI_COPY.report} accent={CALL_ACCENTS.memory.color} defaultOpen>
              <DetailList
                rows={[
                  { label: '整理前', value: String(report?.before ?? '?') },
                  { label: '整理后', value: String(report?.after ?? '?') },
                  { label: '保留', value: String(report?.kept ?? '?') },
                  { label: '重写', value: String(report?.rewritten ?? '?') },
                  { label: '合并', value: String(report?.merged ?? '?') },
                ]}
              />
            </CollapsibleSection>
          )}

          <CollapsibleSection title="原 prompt" accent={CALL_ACCENTS.memory.color}>
            <CodeBlock value={call.systemPrompt || '（空）'} />
          </CollapsibleSection>
          <CollapsibleSection title="原 response" accent={CALL_ACCENTS.memory.color}>
            <CodeBlock value={formatJson(call.response ?? null)} />
          </CollapsibleSection>
        </div>
      )}
    </article>
  )
}
