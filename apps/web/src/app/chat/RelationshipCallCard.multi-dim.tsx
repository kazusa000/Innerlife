'use client'

import React, { useState } from 'react'
import { useAppLocale } from '../use-app-locale'
import type { LiveCall } from './observer-types'
import { formatDurationLabel } from '../../lib/format-duration'
import { getObserverUiCopy } from '../../lib/ui-copy'
import { formatJson, formatMetric, getMetadata, getRelationshipVector, readString } from './observer-utils'
import { CALL_ACCENTS, CodeBlock, CollapsibleSection, DetailList, Pill } from './observer-ui'

export function RelationshipCallCardMultiDim({ call }: { call: LiveCall }) {
  const locale = useAppLocale()
  const copy = getObserverUiCopy(locale)
  const metadata = getMetadata(call)
  const duration = formatDurationLabel(call.startedAt, call.finishedAt)
  const before = getRelationshipVector(metadata?.before)
  const after = getRelationshipVector(metadata?.after)
  const delta = getRelationshipVector(metadata?.delta)
  const trigger = readString(metadata?.trigger)
  const counterpartName = readString(metadata?.counterpartName)
  const counterpartId = readString(metadata?.counterpartId)
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
          <strong style={{ color: 'var(--fg)', fontSize: 14 }}>{copy.relationshipDeltaTitle}</strong>
          <Pill label={copy.model} value={call.model} />
          {duration ? <Pill label={copy.duration} value={duration} /> : null}
          <Pill
            label={copy.stop}
            value={call.stopReason ?? (call.finished ? 'end_turn' : copy.pending)}
            accent={CALL_ACCENTS.relationship.color}
          />
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
          <CollapsibleSection title={copy.before} accent={CALL_ACCENTS.relationship.color} defaultOpen>
            <DetailList
              rows={[
                { label: 'trust', value: before ? formatMetric(before.trust) : copy.none },
                { label: 'affinity', value: before ? formatMetric(before.affinity) : copy.none },
                { label: 'familiarity', value: before ? formatMetric(before.familiarity) : copy.none },
                { label: 'respect', value: before ? formatMetric(before.respect) : copy.none },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title={copy.after} accent={CALL_ACCENTS.relationship.color} defaultOpen>
            <DetailList
              rows={[
                { label: 'trust', value: after ? formatMetric(after.trust) : copy.none },
                { label: 'affinity', value: after ? formatMetric(after.affinity) : copy.none },
                { label: 'familiarity', value: after ? formatMetric(after.familiarity) : copy.none },
                { label: 'respect', value: after ? formatMetric(after.respect) : copy.none },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title={copy.delta} accent={CALL_ACCENTS.relationship.color} defaultOpen>
            <DetailList
              rows={[
                { label: copy.counterpart, value: counterpartName ?? copy.none },
                { label: copy.counterpartId, value: counterpartId ?? copy.none },
                { label: 'trust', value: delta ? formatMetric(delta.trust) : copy.none },
                { label: 'affinity', value: delta ? formatMetric(delta.affinity) : copy.none },
                { label: 'familiarity', value: delta ? formatMetric(delta.familiarity) : copy.none },
                { label: 'respect', value: delta ? formatMetric(delta.respect) : copy.none },
                { label: copy.trigger, value: trigger ?? copy.none },
              ]}
            />
          </CollapsibleSection>

          <CollapsibleSection title={copy.originalPrompt} accent={CALL_ACCENTS.relationship.color}>
            <CodeBlock value={call.systemPrompt || copy.empty} />
          </CollapsibleSection>
          <CollapsibleSection title={copy.originalResponse} accent={CALL_ACCENTS.relationship.color}>
            <CodeBlock value={formatJson(call.response ?? null)} />
          </CollapsibleSection>
        </div>
      )}
    </article>
  )
}
