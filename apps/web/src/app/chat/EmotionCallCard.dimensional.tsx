'use client'

import React, { useState } from 'react'
import { useAppLocale } from '../use-app-locale'
import type { LiveCall } from './observer-types'
import { formatDurationLabel } from '../../lib/format-duration'
import { getObserverUiCopy } from '../../lib/ui-copy'
import { formatJson, formatMetric, getMetadata, getEmotionVector, readString } from './observer-utils'
import { CALL_ACCENTS, CodeBlock, CollapsibleSection, DetailList, Pill } from './observer-ui'

export function EmotionCallCardDimensional({ call }: { call: LiveCall }) {
  const locale = useAppLocale()
  const copy = getObserverUiCopy(locale)
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
          <strong style={{ color: 'var(--fg)', fontSize: 14 }}>{copy.emotionDeltaTitle}</strong>
          <Pill label={copy.model} value={call.model} />
          {duration ? <Pill label={copy.duration} value={duration} /> : null}
          <Pill label={copy.stop} value={call.stopReason ?? (call.finished ? 'end_turn' : copy.pending)} accent={CALL_ACCENTS.emotion.color} />
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
          <CollapsibleSection title={copy.before} accent={CALL_ACCENTS.emotion.color} defaultOpen>
            <DetailList
              rows={[
                { label: 'mood', value: before ? formatMetric(before.mood) : copy.none },
                { label: 'energy', value: before ? formatMetric(before.energy) : copy.none },
                { label: 'stress', value: before ? formatMetric(before.stress) : copy.none },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title={copy.after} accent={CALL_ACCENTS.emotion.color} defaultOpen>
            <DetailList
              rows={[
                { label: 'mood', value: after ? formatMetric(after.mood) : copy.none },
                { label: 'energy', value: after ? formatMetric(after.energy) : copy.none },
                { label: 'stress', value: after ? formatMetric(after.stress) : copy.none },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title={copy.delta} accent={CALL_ACCENTS.emotion.color} defaultOpen>
            <DetailList
              rows={[
                { label: 'mood', value: delta ? formatMetric(delta.mood) : copy.none },
                { label: 'energy', value: delta ? formatMetric(delta.energy) : copy.none },
                { label: 'stress', value: delta ? formatMetric(delta.stress) : copy.none },
                { label: copy.trigger, value: trigger ?? copy.none },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title={copy.originalPrompt} accent={CALL_ACCENTS.emotion.color}>
            <CodeBlock value={call.systemPrompt || copy.empty} />
          </CollapsibleSection>
          <CollapsibleSection title={copy.originalResponse} accent={CALL_ACCENTS.emotion.color}>
            <CodeBlock value={formatJson(call.response ?? null)} />
          </CollapsibleSection>
        </div>
      )}
    </article>
  )
}
