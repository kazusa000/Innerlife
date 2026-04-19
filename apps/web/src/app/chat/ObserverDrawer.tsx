'use client'

import React, { useEffect, useRef } from 'react'
import { ObserverCallCard } from './ObserverCallCard'
import type { LiveCall } from './observer-types'

interface Props {
  calls: LiveCall[]
  activeCallId: string | null
  setActiveCallId: (id: string | null) => void
}

export function ObserverDrawer({ calls, activeCallId, setActiveCallId }: Props) {
  const previousLastCallIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (calls.length === 0) {
      previousLastCallIdRef.current = null
      if (activeCallId) {
        setActiveCallId(null)
      }
      return
    }

    const latestCallId = calls[calls.length - 1]!.callId
    const activeStillExists = activeCallId
      ? calls.some((call) => call.callId === activeCallId)
      : false

    if (
      !activeCallId
      || !activeStillExists
      || activeCallId === previousLastCallIdRef.current
    ) {
      setActiveCallId(latestCallId)
    }

    previousLastCallIdRef.current = latestCallId
  }, [calls, activeCallId, setActiveCallId])

  return (
    <div
      style={{
        width: 460,
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: 'rgba(10, 10, 15, 0.88)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
      }}
    >
      <div
        style={{
          padding: '16px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <strong style={{ color: 'var(--fg)', fontSize: 14 }}>Observer</strong>
        <span style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
          {calls.length === 0 ? 'waiting for next turn…' : `${calls.length} LLM call(s)`}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {calls.length === 0 && (
          <div
            style={{
              padding: '18px',
              borderRadius: 'var(--radius-lg)',
              border: '1px dashed var(--border)',
              color: 'var(--fg-subtle)',
              fontSize: 13,
            }}
          >
            Observer is idle. Start a turn to see memory retrieval, compaction, emotion, and main dialogue calls appear here.
          </div>
        )}

        {calls.map((call, index) => (
          <ObserverCallCard
            key={call.callId}
            call={call}
            compactionCall={
              call.kind === 'turn' && index > 0 && calls[index - 1]?.kind === 'compaction'
                ? calls[index - 1]
                : undefined
            }
            open={call.callId === activeCallId}
            onToggle={() => setActiveCallId(call.callId === activeCallId ? null : call.callId)}
          />
        ))}
      </div>
    </div>
  )
}
