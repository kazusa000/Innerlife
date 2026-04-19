'use client'

import React from 'react'
import type { LiveCall } from './observer-types'
import {
  getCallPhase,
  getMemoryFallbackKeywords,
  getMemoryHits,
  getMemoryKeywords,
  getMemoryReport,
  getMemoryWritten,
  formatImportance,
  formatJson,
} from './observer-utils'
import { CALL_ACCENTS, CodeBlock, CollapsibleSection, DetailList, Pill, TagPills } from './observer-ui'

export function MemoryCallCardSqlite({ call }: { call: LiveCall }) {
  const phase = getCallPhase(call) ?? 'unknown'
  const keywords = getMemoryKeywords(call)
  const fallbackKeywords = getMemoryFallbackKeywords(call)
  const hits = getMemoryHits(call)
  const written = getMemoryWritten(call)
  const report = getMemoryReport(call)

  return (
    <article
      style={{
        border: `1px solid ${CALL_ACCENTS.memory.color}`,
        borderRadius: 20,
        background: CALL_ACCENTS.memory.soft,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--fg)', fontSize: 14 }}>memory.{phase}</strong>
          <Pill label="model" value={call.model} />
          <Pill label="stop" value={call.stopReason ?? (call.finished ? 'end_turn' : 'pending')} accent={CALL_ACCENTS.memory.color} />
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            maxHeight: 'min(56vh, 560px)',
            overflowY: 'auto',
            paddingRight: 4,
          }}
        >
          {phase === 'retrieve' && (
            <>
              <DetailList
                rows={[
                  { label: 'keywords', value: <TagPills values={keywords} accent={CALL_ACCENTS.memory.color} /> },
                  { label: 'fallback keywords', value: <TagPills values={fallbackKeywords} accent={CALL_ACCENTS.memory.color} /> },
                ]}
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span
                  style={{
                    color: 'var(--fg-subtle)',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: 0.04 * 16,
                  }}
                >
                  hits
                </span>
                {hits.length === 0 ? (
                  <span style={{ color: 'var(--fg-subtle)', fontSize: 13 }}>无命中</span>
                ) : (
                  hits.map((hit) => (
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
                  ))
                )}
              </div>
            </>
          )}

          {phase === 'summarize' && (
            <DetailList
              rows={[
                ...(written?.id ? [{ label: 'written id', value: written.id }] : []),
                { label: 'summary', value: written?.summary ?? '无' },
                { label: 'importance', value: written ? formatImportance(written.importance) : '无' },
                { label: 'tags', value: <TagPills values={written?.tags ?? []} accent={CALL_ACCENTS.memory.color} /> },
              ]}
            />
          )}

          {phase === 'consolidate' && (
            <DetailList
              rows={[
                { label: 'before', value: String(report?.before ?? '?') },
                { label: 'after', value: String(report?.after ?? '?') },
                { label: 'kept', value: String(report?.kept ?? '?') },
                { label: 'rewritten', value: String(report?.rewritten ?? '?') },
                { label: 'merged', value: String(report?.merged ?? '?') },
              ]}
            />
          )}

          <CollapsibleSection title="原 prompt" accent={CALL_ACCENTS.memory.color}>
            <CodeBlock value={call.systemPrompt || '(empty)'} maxHeight={260} />
          </CollapsibleSection>
          <CollapsibleSection title="原 response" accent={CALL_ACCENTS.memory.color}>
            <CodeBlock value={formatJson(call.response ?? null)} maxHeight={260} />
          </CollapsibleSection>
        </div>
      </div>
    </article>
  )
}
