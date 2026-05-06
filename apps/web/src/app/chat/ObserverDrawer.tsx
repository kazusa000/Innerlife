'use client'

import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAppLocale } from '../use-app-locale'
import { formatDurationLabel } from '../../lib/format-duration'
import { getObserverUiCopy, translateMemoryPhase, type UiLocale } from '../../lib/ui-copy'
import { EmotionCallCardDimensional } from './EmotionCallCard.dimensional'
import { MemoryCallCardSqlite } from './MemoryCallCard.sqlite'
import { RelationshipCallCardMultiDim } from './RelationshipCallCard.multi-dim'
import type { AgentModules, LiveCall, ObserverTab, ObserverTurnState } from './observer-types'
import { CALL_ACCENTS, CodeBlock, CollapsibleSection, EmptyState, MessagesTimeline, Pill } from './observer-ui'
import type { AccentTone } from './observer-ui'
import { getPromptFragment, getPromptFragments } from './observer-utils'

interface Props {
  turn: ObserverTurnState
  agentModules: AgentModules | null
  activeTab: ObserverTab
  setActiveTab: (tab: ObserverTab) => void
}

function callSubtabLabel(call: LiveCall, locale: UiLocale): string {
  const copy = getObserverUiCopy(locale)
  if (call.kind === 'turn') return `#${call.turnIndex}`
  if (call.kind === 'memory') {
    const phase = typeof call.metadata?.phase === 'string' ? call.metadata.phase : 'call'
    return translateMemoryPhase(phase, locale)
  }
  if (call.kind === 'emotion') return copy.delta
  if (call.kind === 'relationship') return copy.delta
  return call.callId
}

function CallSubtabs({
  calls,
  activeId,
  onSelect,
  accent,
}: {
  calls: LiveCall[]
  activeId: string | null
  onSelect: (id: string) => void
  accent: string
}) {
  const locale = useAppLocale()
  if (calls.length <= 1) return null

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        padding: '10px 18px',
        scrollbarWidth: 'thin',
        borderBottom: '1px solid var(--border-subtle)',
        marginLeft: -16,
        marginRight: -16,
        marginTop: -16,
        marginBottom: 4,
        position: 'sticky',
        top: 0,
        zIndex: 3,
        background: 'rgba(8, 8, 13, 0.92)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      }}
    >
      {calls.map((call) => {
        const active = call.callId === activeId
        return (
          <button
            key={call.callId}
            type="button"
            onClick={() => onSelect(call.callId)}
            style={{
              border: `1px solid ${active ? accent : 'var(--border-subtle)'}`,
              borderRadius: 999,
              background: active ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)',
              color: active ? 'var(--fg)' : 'var(--fg-muted)',
              padding: '6px 12px',
              fontSize: 11,
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{callSubtabLabel(call, locale)}</span>
            <span
              style={{
                color: call.finished ? 'var(--fg-subtle)' : 'var(--orange)',
                fontSize: 10,
              }}
            >
              {call.finished ? '✓' : '…'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function formatTurnStatus(status: ObserverTurnState['status'], locale: UiLocale): string {
  if (locale === 'en-US') {
    if (status === 'loading') return 'Loading the latest turn...'
    if (status === 'running') return 'Current turn is running'
    if (status === 'error') return 'Current turn ended with an error'
    if (status === 'complete') return 'Showing current turn'
    return 'Waiting for the next turn'
  }
  if (status === 'loading') return '正在加载最近一轮…'
  if (status === 'running') return '当前轮对话进行中'
  if (status === 'error') return '当前轮对话结束于错误'
  if (status === 'complete') return '显示当前轮对话'
  return '等待下一轮对话'
}

function DimensionPanel({
  title,
  accent,
  defaultOpen = true,
  children,
}: {
  title: string
  accent: AccentTone
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <CollapsibleSection title={title} accent={accent.color} defaultOpen={defaultOpen}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </CollapsibleSection>
  )
}

function MainTurnCallCard({
  call,
  inlineCompactionCall,
}: {
  call: LiveCall
  inlineCompactionCall: LiveCall | null
}) {
  const locale = useAppLocale()
  const copy = getObserverUiCopy(locale)
  const toolsCount = Array.isArray(call.tools) ? call.tools.length : 0
  const fragmentsCount = getPromptFragments(call).length
  const duration = formatDurationLabel(call.startedAt, call.finishedAt)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const thinkingText = typeof call.metadata?.thinking === 'object'
    && call.metadata.thinking !== null
    && 'text' in call.metadata.thinking
    && typeof call.metadata.thinking.text === 'string'
      ? call.metadata.thinking.text
      : ''

  const fragmentSections = [
    { key: 'personality', label: copy.personality, accent: CALL_ACCENTS.personality },
    { key: 'emotion', label: copy.emotion, accent: CALL_ACCENTS.emotion },
    { key: 'memory', label: copy.memory, accent: CALL_ACCENTS.memory },
    { key: 'relationship', label: locale === 'en-US' ? 'Relationship' : '关系', accent: CALL_ACCENTS.relationship },
  ].flatMap(({ key, label, accent }) => {
    const fragment = getPromptFragment(call, key)
    if (!fragment) {
      return []
    }

    return [{
      id: key,
      label,
      node: (
        <DimensionPanel key={key} title={label} accent={accent}>
          <CodeBlock value={fragment.content} />
        </DimensionPanel>
      ),
    }]
  })

  const anchors = [
    ...fragmentSections.map((section) => ({ id: section.id, label: section.label, visible: true })),
    { id: 'thinking', label: copy.thinking, visible: thinkingText.length > 0 },
    {
      id: 'messages',
      label: copy.messages,
      visible:
        Array.isArray(call.messages) && call.messages.length > 0
          || call.response !== undefined
          || !!call.error
          || inlineCompactionCall !== null,
    },
    { id: 'tools', label: copy.toolsSchema, visible: toolsCount > 0 },
    { id: 'final-prompt', label: copy.finalSystemPrompt, visible: Boolean(call.systemPrompt) },
  ].filter((item) => item.visible)

  const scrollToSection = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <article
      style={{
        border: `1px solid ${CALL_ACCENTS.turn.color}`,
        borderRadius: 22,
        background: CALL_ACCENTS.turn.soft,
        boxShadow: 'var(--shadow-lift)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '16px 16px 12px',
          color: 'var(--fg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 10px',
              borderRadius: 999,
              background: 'rgba(0, 0, 0, 0.22)',
              color: CALL_ACCENTS.turn.color,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.06 * 16,
              textTransform: 'uppercase',
            }}
          >
            {copy.mainTurn}
          </span>
          <span style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>#{call.turnIndex}</span>
          <span style={{ color: call.finished ? 'var(--fg-muted)' : 'var(--orange)', fontSize: 12 }}>
            {call.finished ? copy.finished : copy.running}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill label={copy.model} value={call.model} />
          {duration ? <Pill label={copy.duration} value={duration} /> : null}
          <Pill label={copy.tools} value={String(toolsCount)} />
          <Pill label={copy.fragments} value={String(fragmentsCount)} />
          <Pill label={copy.stop} value={call.stopReason ?? (call.finished ? 'end_turn' : copy.pending)} accent={CALL_ACCENTS.turn.color} />
          <Pill label={copy.inputTokens} value={String(call.usage?.inputTokens ?? '?')} />
          <Pill label={copy.outputTokens} value={String(call.usage?.outputTokens ?? '?')} />
        </div>
      </div>

      <div
        style={{
          padding: '0 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
          <div
            style={{
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              padding: '4px 0 8px',
              scrollbarWidth: 'thin',
            }}
          >
            {anchors.map((anchor) => (
              <button
                key={anchor.id}
                type="button"
                onClick={() => scrollToSection(anchor.id)}
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 999,
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--fg)',
                  padding: '6px 10px',
                  fontSize: 11,
                  cursor: 'pointer',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                {anchor.label}
              </button>
            ))}
          </div>

          {fragmentSections.map((section) => (
            <div
              key={section.id}
              ref={(node) => {
                sectionRefs.current[section.id] = node
              }}
              style={{ scrollMarginTop: 12 }}
            >
              {section.node}
            </div>
          ))}

          {thinkingText && (
            <div
              ref={(node) => {
                sectionRefs.current.thinking = node
              }}
              style={{ scrollMarginTop: 12 }}
            >
              <DimensionPanel title={locale === 'en-US' ? 'Thinking Content' : '思考内容'} accent={CALL_ACCENTS.turn} defaultOpen>
                <CodeBlock value={thinkingText} />
              </DimensionPanel>
            </div>
          )}

          <div
            ref={(node) => {
              sectionRefs.current.messages = node
            }}
            style={{ scrollMarginTop: 12 }}
          >
            <DimensionPanel title={copy.messages} accent={CALL_ACCENTS.turn} defaultOpen>
              <MessagesTimeline call={call} inlineCompactionCall={inlineCompactionCall} />
            </DimensionPanel>
          </div>

          {toolsCount > 0 && (
            <div
              ref={(node) => {
                sectionRefs.current.tools = node
              }}
              style={{ scrollMarginTop: 12 }}
            >
              <CollapsibleSection title={copy.toolsSchema} accent={CALL_ACCENTS.turn.color} badge={String(toolsCount)}>
                <CodeBlock value={JSON.stringify(call.tools ?? null, null, 2)} />
              </CollapsibleSection>
            </div>
          )}

          {call.systemPrompt && (
            <div
              ref={(node) => {
                sectionRefs.current['final-prompt'] = node
              }}
              style={{ scrollMarginTop: 12 }}
            >
              <CollapsibleSection title={copy.finalSystemPrompt} accent={CALL_ACCENTS.turn.color}>
                <CodeBlock value={call.systemPrompt} />
              </CollapsibleSection>
            </div>
          )}
      </div>
    </article>
  )
}

function UnknownSchemeCard({
  title,
  scheme,
}: {
  title: string
  scheme: string | null
}) {
  const locale = useAppLocale()
  return (
    <EmptyState
      title={title}
      body={scheme
        ? (locale === 'en-US' ? `Current scheme "${scheme}" does not have an implemented tab component yet.` : `当前方案 "${scheme}" 暂未实现该标签页组件。`)
        : (locale === 'en-US' ? 'This persona does not have a recognizable scheme configuration.' : '当前虚拟人没有可识别的方案配置。')}
    />
  )
}

function pickActiveCallId(calls: LiveCall[], previousId: string | null): string | null {
  if (calls.length === 0) return null
  if (previousId && calls.some((call) => call.callId === previousId)) return previousId
  return calls[calls.length - 1].callId
}

export function ObserverDrawer({
  turn,
  agentModules,
  activeTab,
  setActiveTab,
}: Props) {
  const locale = useAppLocale()
  const copy = getObserverUiCopy(locale)
  const mainCalls = useMemo(() => turn.calls.filter((call) => call.kind === 'turn'), [turn.calls])
  const memoryCalls = useMemo(() => turn.calls.filter((call) => call.kind === 'memory'), [turn.calls])
  const emotionCalls = useMemo(() => turn.calls.filter((call) => call.kind === 'emotion'), [turn.calls])
  const relationshipCalls = useMemo(() => turn.calls.filter((call) => call.kind === 'relationship'), [turn.calls])

  const [activeMainCallId, setActiveMainCallId] = useState<string | null>(null)
  const [activeMemoryCallId, setActiveMemoryCallId] = useState<string | null>(null)
  const [activeEmotionCallId, setActiveEmotionCallId] = useState<string | null>(null)
  const [activeRelationshipCallId, setActiveRelationshipCallId] = useState<string | null>(null)

  useEffect(() => {
    setActiveMainCallId((prev) => pickActiveCallId(mainCalls, prev))
  }, [mainCalls])

  useEffect(() => {
    setActiveMemoryCallId((prev) => pickActiveCallId(memoryCalls, prev))
  }, [memoryCalls])

  useEffect(() => {
    setActiveEmotionCallId((prev) => pickActiveCallId(emotionCalls, prev))
  }, [emotionCalls])

  useEffect(() => {
    setActiveRelationshipCallId((prev) => pickActiveCallId(relationshipCalls, prev))
  }, [relationshipCalls])

  const memoryScheme = typeof agentModules?.memory?.scheme === 'string' ? agentModules.memory.scheme : null
  const emotionScheme = typeof agentModules?.emotion?.scheme === 'string' ? agentModules.emotion.scheme : null
  const relationshipScheme = typeof agentModules?.relationship?.scheme === 'string'
    ? agentModules.relationship.scheme
    : null

  const renderMainTab = () => {
    if (mainCalls.length === 0) {
      return (
        <EmptyState
          title={locale === 'en-US' ? 'No Main-Turn Call This Turn' : '本轮未触发主对话调用'}
          body={turn.status === 'running'
            ? (locale === 'en-US' ? 'Waiting for the main-turn call to start.' : '正在等待主对话调用开始。')
            : (locale === 'en-US' ? 'This turn has no main-turn call to display.' : '当前轮对话没有可展示的主对话调用。')}
        />
      )
    }

    const activeCall = mainCalls.find((call) => call.callId === activeMainCallId) ?? mainCalls[mainCalls.length - 1]
    const callIndex = turn.calls.findIndex((candidate) => candidate.callId === activeCall.callId)
    const previousCall = callIndex > 0 ? turn.calls[callIndex - 1] : null

    return (
      <>
        <CallSubtabs calls={mainCalls} activeId={activeCall.callId} onSelect={setActiveMainCallId} accent={CALL_ACCENTS.turn.color} />
        <MainTurnCallCard
          key={activeCall.callId}
          call={activeCall}
          inlineCompactionCall={previousCall?.kind === 'compaction' ? previousCall : null}
        />
      </>
    )
  }

  const renderMemoryTab = () => {
    if (memoryCalls.length === 0) {
      return <EmptyState title={locale === 'en-US' ? 'No Memory Call This Turn' : '本轮未触发记忆调用'} body={locale === 'en-US' ? 'This turn has no memory retrieval, summary, or consolidation call.' : '当前轮对话没有记忆检索、总结或整理调用。'} />
    }

    if (memoryScheme !== 'sqlite') {
      return <UnknownSchemeCard title={locale === 'en-US' ? 'Memory Component Not Matched' : '记忆组件未命中'} scheme={memoryScheme} />
    }

    const activeCall = memoryCalls.find((call) => call.callId === activeMemoryCallId) ?? memoryCalls[memoryCalls.length - 1]

    return (
      <>
        <CallSubtabs calls={memoryCalls} activeId={activeCall.callId} onSelect={setActiveMemoryCallId} accent={CALL_ACCENTS.memory.color} />
        <MemoryCallCardSqlite key={activeCall.callId} call={activeCall} />
      </>
    )
  }

  const renderEmotionTab = () => {
    if (emotionCalls.length === 0) {
      return <EmptyState title={locale === 'en-US' ? 'No Emotion Call This Turn' : '本轮未触发情绪调用'} body={locale === 'en-US' ? 'This turn has no emotion delta analysis call.' : '当前轮对话没有情绪变化分析调用。'} />
    }

    if (emotionScheme !== 'dimensional') {
      return <UnknownSchemeCard title={locale === 'en-US' ? 'Emotion Component Not Matched' : '情绪组件未命中'} scheme={emotionScheme} />
    }

    const activeCall = emotionCalls.find((call) => call.callId === activeEmotionCallId) ?? emotionCalls[emotionCalls.length - 1]

    return (
      <>
        <CallSubtabs calls={emotionCalls} activeId={activeCall.callId} onSelect={setActiveEmotionCallId} accent={CALL_ACCENTS.emotion.color} />
        <EmotionCallCardDimensional key={activeCall.callId} call={activeCall} />
      </>
    )
  }

  const renderRelationshipTab = () => {
    if (relationshipCalls.length === 0) {
      return <EmptyState title={locale === 'en-US' ? 'No Relationship Call This Turn' : '本轮未触发关系调用'} body={locale === 'en-US' ? 'This turn has no relationship delta analysis call.' : '当前轮对话没有关系变化分析调用。'} />
    }

    if (relationshipScheme !== 'multi-dim' && relationshipScheme !== 'named-multi-dim') {
      return <UnknownSchemeCard title={locale === 'en-US' ? 'Relationship Component Not Matched' : '关系组件未命中'} scheme={relationshipScheme} />
    }

    const activeCall = relationshipCalls.find((call) => call.callId === activeRelationshipCallId)
      ?? relationshipCalls[relationshipCalls.length - 1]

    return (
      <>
        <CallSubtabs
          calls={relationshipCalls}
          activeId={activeCall.callId}
          onSelect={setActiveRelationshipCallId}
          accent={CALL_ACCENTS.relationship.color}
        />
        <RelationshipCallCardMultiDim key={activeCall.callId} call={activeCall} />
      </>
    )
  }

  return (
    <aside
      style={{
        width: 520,
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: 'rgba(8, 8, 13, 0.82)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
        minWidth: 0,
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '16px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <strong style={{ color: 'var(--fg)', fontSize: 14 }}>{copy.title}</strong>
        <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{formatTurnStatus(turn.status, locale)}</span>
      </div>

      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          gap: 10,
          flexShrink: 0,
          background: 'rgba(8, 8, 13, 0.92)',
          overflowX: 'auto',
          scrollbarWidth: 'thin',
        }}
      >
        {[
          { id: 'main', label: copy.mainTurn, count: mainCalls.length },
          { id: 'memory', label: copy.memory, count: memoryCalls.length },
          { id: 'emotion', label: copy.emotion, count: emotionCalls.length },
          { id: 'relationship', label: locale === 'en-US' ? 'Relationship' : '关系', count: relationshipCalls.length },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as ObserverTab)}
            style={{
              border: `1px solid ${activeTab === tab.id ? 'var(--indigo)' : 'var(--border-subtle)'}`,
              borderRadius: 999,
              background: activeTab === tab.id ? 'rgba(129, 140, 248, 0.16)' : 'rgba(255, 255, 255, 0.04)',
              color: activeTab === tab.id ? 'var(--fg)' : 'var(--fg-muted)',
              padding: '8px 14px',
              fontSize: 12,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            <span>{tab.label}</span>
            <span
              style={{
                padding: '2px 7px',
                borderRadius: 999,
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'inherit',
                fontSize: 11,
              }}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        <div
          style={{
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {activeTab === 'main' && renderMainTab()}
          {activeTab === 'memory' && renderMemoryTab()}
          {activeTab === 'emotion' && renderEmotionTab()}
          {activeTab === 'relationship' && renderRelationshipTab()}
        </div>
      </div>
    </aside>
  )
}
