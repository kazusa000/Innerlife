'use client'

import React, { useState } from 'react'
import type { LiveCall } from './observer-types'
import { formatDurationLabel } from '../../lib/format-duration'
import { formatJson, formatMetric, getMetadata, getRelationshipVector, readString } from './observer-utils'
import { CALL_ACCENTS, CodeBlock, CollapsibleSection, DetailList, Pill } from './observer-ui'

export function RelationshipCallCardMultiDim({ call }: { call: LiveCall }) {
  const metadata = getMetadata(call)
  const duration = formatDurationLabel(call.startedAt, call.finishedAt)
  const before = getRelationshipVector(metadata?.before)
  const after = getRelationshipVector(metadata?.after)
  const delta = getRelationshipVector(metadata?.delta)
  const trigger = readString(metadata?.trigger)
  const [open, setOpen] = useState(true)

  return (
    <article
      style={{
        border: `1px solid ${CALL_ACCENTS.relationship.color}`,
        borderRadius: 20,
        background: CALL_ACCENTS.relationship.soft,
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
          <strong style={{ color: 'var(--fg)', fontSize: 14 }}>relationship.delta</strong>
          <Pill label="model" value={call.model} />
          {duration ? <Pill label="duration" value={duration} /> : null}
          <Pill
            label="stop"
            value={call.stopReason ?? (call.finished ? 'end_turn' : 'pending')}
            accent={CALL_ACCENTS.relationship.color}
          />
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
          <CollapsibleSection title="Before" accent={CALL_ACCENTS.relationship.color} defaultOpen>
            <DetailList
              rows={[
                { label: 'trust', value: before ? formatMetric(before.trust) : '无' },
                { label: 'affinity', value: before ? formatMetric(before.affinity) : '无' },
                { label: 'familiarity', value: before ? formatMetric(before.familiarity) : '无' },
                { label: 'respect', value: before ? formatMetric(before.respect) : '无' },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title="After" accent={CALL_ACCENTS.relationship.color} defaultOpen>
            <DetailList
              rows={[
                { label: 'trust', value: after ? formatMetric(after.trust) : '无' },
                { label: 'affinity', value: after ? formatMetric(after.affinity) : '无' },
                { label: 'familiarity', value: after ? formatMetric(after.familiarity) : '无' },
                { label: 'respect', value: after ? formatMetric(after.respect) : '无' },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Delta" accent={CALL_ACCENTS.relationship.color} defaultOpen>
            <DetailList
              rows={[
                { label: 'trust', value: delta ? formatMetric(delta.trust) : '无' },
                { label: 'affinity', value: delta ? formatMetric(delta.affinity) : '无' },
                { label: 'familiarity', value: delta ? formatMetric(delta.familiarity) : '无' },
                { label: 'respect', value: delta ? formatMetric(delta.respect) : '无' },
                { label: 'trigger', value: trigger ?? '无' },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title="原 prompt" accent={CALL_ACCENTS.relationship.color}>
            <CodeBlock value={call.systemPrompt || '(empty)'} />
          </CollapsibleSection>
          <CollapsibleSection title="原 response" accent={CALL_ACCENTS.relationship.color}>
            <CodeBlock value={formatJson(call.response ?? null)} />
          </CollapsibleSection>
        </div>
      )}
    </article>
  )
}
