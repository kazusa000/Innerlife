'use client'

import React from 'react'
import type { LiveCall } from './observer-types'
import { formatJson, formatMetric, getMetadata, getEmotionVector, readString } from './observer-utils'
import { CALL_ACCENTS, CodeBlock, CollapsibleSection, DetailList, Pill } from './observer-ui'

export function EmotionCallCardDimensional({ call }: { call: LiveCall }) {
  const metadata = getMetadata(call)
  const before = getEmotionVector(metadata?.before)
  const after = getEmotionVector(metadata?.after)
  const delta = getEmotionVector(metadata?.delta)
  const trigger = readString(metadata?.trigger)

  return (
    <article
      style={{
        border: `1px solid ${CALL_ACCENTS.emotion.color}`,
        borderRadius: 20,
        background: CALL_ACCENTS.emotion.soft,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--fg)', fontSize: 14 }}>emotion.delta</strong>
          <Pill label="model" value={call.model} />
          <Pill label="stop" value={call.stopReason ?? (call.finished ? 'end_turn' : 'pending')} accent={CALL_ACCENTS.emotion.color} />
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
          <DetailList
            rows={[
              { label: 'before mood', value: before ? formatMetric(before.mood) : '无' },
              { label: 'before energy', value: before ? formatMetric(before.energy) : '无' },
              { label: 'before stress', value: before ? formatMetric(before.stress) : '无' },
              { label: 'after mood', value: after ? formatMetric(after.mood) : '无' },
              { label: 'after energy', value: after ? formatMetric(after.energy) : '无' },
              { label: 'after stress', value: after ? formatMetric(after.stress) : '无' },
              { label: 'delta mood', value: delta ? formatMetric(delta.mood) : '无' },
              { label: 'delta energy', value: delta ? formatMetric(delta.energy) : '无' },
              { label: 'delta stress', value: delta ? formatMetric(delta.stress) : '无' },
              { label: 'trigger', value: trigger ?? '无' },
            ]}
          />

          <CollapsibleSection title="原 prompt" accent={CALL_ACCENTS.emotion.color}>
            <CodeBlock value={call.systemPrompt || '(empty)'} maxHeight={260} />
          </CollapsibleSection>
          <CollapsibleSection title="原 response" accent={CALL_ACCENTS.emotion.color}>
            <CodeBlock value={formatJson(call.response ?? null)} maxHeight={260} />
          </CollapsibleSection>
        </div>
      </div>
    </article>
  )
}
