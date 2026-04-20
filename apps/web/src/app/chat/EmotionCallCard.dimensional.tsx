'use client'

import React, { useState } from 'react'
import type { LiveCall } from './observer-types'
import { formatDurationLabel } from '../../lib/format-duration'
import { formatJson, formatMetric, getMetadata, getEmotionVector, readString } from './observer-utils'
import { CALL_ACCENTS, CodeBlock, CollapsibleSection, DetailList, Pill } from './observer-ui'

export function EmotionCallCardDimensional({ call }: { call: LiveCall }) {
  const metadata = getMetadata(call)
  const duration = formatDurationLabel(call.startedAt, call.finishedAt)
  const before = getEmotionVector(metadata?.before)
  const after = getEmotionVector(metadata?.after)
  const delta = getEmotionVector(metadata?.delta)
  const trigger = readString(metadata?.trigger)
  const [open, setOpen] = useState(true)

  return (
    <article
      style={{
        border: `1px solid ${CALL_ACCENTS.emotion.color}`,
        borderRadius: 20,
        background: CALL_ACCENTS.emotion.soft,
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
          <strong style={{ color: 'var(--fg)', fontSize: 14 }}>emotion.delta</strong>
          <Pill label="model" value={call.model} />
          {duration ? <Pill label="duration" value={duration} /> : null}
          <Pill label="stop" value={call.stopReason ?? (call.finished ? 'end_turn' : 'pending')} accent={CALL_ACCENTS.emotion.color} />
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
          <CollapsibleSection title="Before" accent={CALL_ACCENTS.emotion.color} defaultOpen>
            <DetailList
              rows={[
                { label: 'mood', value: before ? formatMetric(before.mood) : '无' },
                { label: 'energy', value: before ? formatMetric(before.energy) : '无' },
                { label: 'stress', value: before ? formatMetric(before.stress) : '无' },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title="After" accent={CALL_ACCENTS.emotion.color} defaultOpen>
            <DetailList
              rows={[
                { label: 'mood', value: after ? formatMetric(after.mood) : '无' },
                { label: 'energy', value: after ? formatMetric(after.energy) : '无' },
                { label: 'stress', value: after ? formatMetric(after.stress) : '无' },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Delta" accent={CALL_ACCENTS.emotion.color} defaultOpen>
            <DetailList
              rows={[
                { label: 'mood', value: delta ? formatMetric(delta.mood) : '无' },
                { label: 'energy', value: delta ? formatMetric(delta.energy) : '无' },
                { label: 'stress', value: delta ? formatMetric(delta.stress) : '无' },
                { label: 'trigger', value: trigger ?? '无' },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title="原 prompt" accent={CALL_ACCENTS.emotion.color}>
            <CodeBlock value={call.systemPrompt || '(empty)'} />
          </CollapsibleSection>
          <CollapsibleSection title="原 response" accent={CALL_ACCENTS.emotion.color}>
            <CodeBlock value={formatJson(call.response ?? null)} />
          </CollapsibleSection>
        </div>
      )}
    </article>
  )
}
