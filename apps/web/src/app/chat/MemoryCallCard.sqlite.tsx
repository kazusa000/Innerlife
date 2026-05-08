'use client'

import React, { useState } from 'react'
import { useAppLocale } from '../use-app-locale'
import type { LiveCall } from './observer-types'
import { formatDurationLabel } from '../../lib/format-duration'
import { getObserverUiCopy, translateMemoryPhase, type UiLocale } from '../../lib/ui-copy'
import {
  getCallPhase,
  getMemoryHits,
  getMemoryRetrievalQuery,
  getMemoryReport,
  getMemorySemanticAnalyzer,
  getMemoryTimeAnalyzer,
  getMemoryTimeRange,
  getMemoryWritten,
  formatImportance,
  formatJson,
} from './observer-utils'
import { CALL_ACCENTS, CodeBlock, CollapsibleSection, DetailList, Pill } from './observer-ui'

function formatMemoryLayerLabel(layer: string | null | undefined, locale: UiLocale, none: string) {
  if (locale === 'en-US') {
    switch (layer) {
      case 'long_term':
        return 'Long-Term Memory'
      case 'fixed':
        return 'Fixed Memory'
      case 'short_term':
        return 'Short-Term Memory'
      default:
        return none
    }
  }
  switch (layer) {
    case 'long_term':
      return '长期记忆'
    case 'fixed':
      return '固化记忆'
    case 'short_term':
      return '短期记忆'
    default:
      return none
  }
}

export function MemoryCallCardSqlite({ call }: { call: LiveCall }) {
  const locale = useAppLocale()
  const copy = getObserverUiCopy(locale)
  const phase = getCallPhase(call) ?? 'unknown'
  const duration = formatDurationLabel(call.startedAt, call.finishedAt)
  const retrievalQuery = getMemoryRetrievalQuery(call)
  const timeRange = getMemoryTimeRange(call)
  const timeAnalyzer = getMemoryTimeAnalyzer(call)
  const semanticAnalyzer = getMemorySemanticAnalyzer(call)
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
          <strong style={{ color: 'var(--fg)', fontSize: 14 }}>{copy.memory}.{translateMemoryPhase(phase, locale)}</strong>
          <Pill label={copy.model} value={call.model} />
          {duration ? <Pill label={copy.duration} value={duration} /> : null}
          <Pill label={copy.stop} value={call.stopReason ?? (call.finished ? 'end_turn' : copy.pending)} accent={CALL_ACCENTS.memory.color} />
        </div>
        <span style={{ color: 'var(--fg-subtle)', fontSize: 12, flexShrink: 0 }}>{open ? copy.collapse : copy.expand}</span>
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
              <CollapsibleSection title="Time Analyzer" accent={CALL_ACCENTS.memory.color} defaultOpen>
                <DetailList
                  rows={[
                    { label: copy.mode, value: timeAnalyzer?.mode ?? copy.none },
                    {
                      label: copy.timeRange,
                      value: timeAnalyzer?.timeRange ? (
                        <DetailList
                          rows={[
                            { label: copy.start, value: timeAnalyzer.timeRange.start },
                            { label: copy.end, value: timeAnalyzer.timeRange.end },
                          ]}
                        />
                      ) : copy.none,
                    },
                    { label: copy.inputPreview, value: timeAnalyzer?.inputPreview ?? copy.none },
                    { label: copy.error, value: timeAnalyzer?.error ?? copy.none },
                  ]}
                />
              </CollapsibleSection>

              <CollapsibleSection title="Semantic Analyzer" accent={CALL_ACCENTS.memory.color} defaultOpen>
                <DetailList
                  rows={[
                    { label: copy.mode, value: semanticAnalyzer?.mode ?? copy.none },
                    { label: copy.retrievalRewrite, value: semanticAnalyzer?.retrievalQuery ?? copy.none },
                    { label: copy.inputPreview, value: semanticAnalyzer?.inputPreview ?? copy.none },
                    { label: copy.error, value: semanticAnalyzer?.error ?? copy.none },
                  ]}
                />
              </CollapsibleSection>

              <CollapsibleSection title={copy.mergedQuery} accent={CALL_ACCENTS.memory.color} defaultOpen>
                <DetailList
                  rows={[
                    { label: copy.retrievalRewrite, value: retrievalQuery ?? copy.none },
                    {
                      label: copy.timeRange,
                      value: timeRange ? (
                        <DetailList
                          rows={[
                            { label: copy.start, value: timeRange.start },
                            { label: copy.end, value: timeRange.end },
                          ]}
                        />
                      ) : copy.none,
                    },
                  ]}
                />
              </CollapsibleSection>

              <CollapsibleSection
                title={copy.hits}
                accent={CALL_ACCENTS.memory.color}
                badge={String(hits.length)}
                defaultOpen
              >
                {hits.length === 0 ? (
                  <span style={{ color: 'var(--fg-subtle)', fontSize: 13 }}>{copy.noHits}</span>
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
                            { label: copy.memoryId, value: hit.id },
                            { label: copy.layer, value: formatMemoryLayerLabel(typeof hit.layer === 'string' ? hit.layer : null, locale, copy.none) },
                            { label: copy.summaryRetrievalText, value: hit.retrievalText },
                            ...(hit.detail ? [{ label: 'detail', value: hit.detail }] : []),
                            { label: copy.importance, value: formatImportance(hit.importance) },
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
            <CollapsibleSection title={copy.written} accent={CALL_ACCENTS.memory.color} defaultOpen>
              <DetailList
                rows={[
                  ...(written?.id ? [{ label: copy.writeId, value: written.id }] : []),
                  { label: copy.layer, value: formatMemoryLayerLabel(typeof written?.layer === 'string' ? written.layer : null, locale, copy.none) },
                  { label: copy.summaryRetrievalText, value: written?.retrievalText ?? copy.none },
                  ...(written?.detail ? [{ label: 'detail', value: written.detail }] : []),
                  { label: copy.importance, value: written ? formatImportance(written.importance) : copy.none },
                ]}
              />
            </CollapsibleSection>
          )}

          {phase === 'consolidate' && (
            <CollapsibleSection title={copy.report} accent={CALL_ACCENTS.memory.color} defaultOpen>
              <DetailList
                rows={[
                  ...(typeof (report as { layer?: unknown } | null)?.layer === 'string'
                    ? [{ label: copy.layer, value: formatMemoryLayerLabel((report as { layer: string }).layer, locale, copy.none) }]
                    : []),
                  { label: copy.beforeCount, value: String(report?.before ?? '?') },
                  { label: copy.afterCount, value: String(report?.after ?? '?') },
                  { label: copy.kept, value: String(report?.kept ?? '?') },
                  { label: copy.rewritten, value: String(report?.rewritten ?? '?') },
                  { label: copy.merged, value: String(report?.merged ?? '?') },
                ]}
              />
            </CollapsibleSection>
          )}

          <CollapsibleSection title={copy.originalPrompt} accent={CALL_ACCENTS.memory.color}>
            <CodeBlock value={call.systemPrompt || copy.empty} />
          </CollapsibleSection>
          <CollapsibleSection title={copy.originalResponse} accent={CALL_ACCENTS.memory.color}>
            <CodeBlock value={formatJson(call.response ?? null)} />
          </CollapsibleSection>
        </div>
      )}
    </article>
  )
}
