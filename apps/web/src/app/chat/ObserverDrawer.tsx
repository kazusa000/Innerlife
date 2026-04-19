'use client'

import React, { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { EmotionCallCardDimensional } from './EmotionCallCard.dimensional'
import { MemoryCallCardSqlite } from './MemoryCallCard.sqlite'
import type { AgentModules, LiveCall, ObserverTab, ObserverTurnState } from './observer-types'
import { CALL_ACCENTS, CodeBlock, CollapsibleSection, EmptyState, MessagesTimeline, Pill } from './observer-ui'
import { getPromptFragment, getPromptFragments } from './observer-utils'

interface Props {
  turn: ObserverTurnState
  agentModules: AgentModules | null
  activeTab: ObserverTab
  setActiveTab: (tab: ObserverTab) => void
  expandedMainCallIds: string[]
  setExpandedMainCallIds: (ids: string[]) => void
}

function formatTurnStatus(status: ObserverTurnState['status']): string {
  if (status === 'loading') return '正在加载最近一轮…'
  if (status === 'running') return '当前 turn 进行中'
  if (status === 'error') return '当前 turn 结束于错误'
  if (status === 'complete') return '显示当前 turn'
  return '等待下一轮对话'
}

function DimensionPanel({
  title,
  accent,
  children,
}: {
  title: string
  accent: { color: string; soft: string }
  children: ReactNode
}) {
  return (
    <section
      style={{
        border: `1px solid ${accent.color}`,
        background: accent.soft,
        borderRadius: 18,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: accent.color,
            boxShadow: `0 0 18px ${accent.color}`,
          }}
        />
        <strong style={{ color: 'var(--fg)', fontSize: 14 }}>{title}</strong>
      </div>
      {children}
    </section>
  )
}

function MainTurnCallCard({
  call,
  expanded,
  onToggle,
  inlineCompactionCall,
}: {
  call: LiveCall
  expanded: boolean
  onToggle: () => void
  inlineCompactionCall: LiveCall | null
}) {
  const toolsCount = Array.isArray(call.tools) ? call.tools.length : 0
  const fragmentsCount = getPromptFragments(call).length
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const fragmentSections = [
    { key: 'personality', label: '性格', accent: CALL_ACCENTS.personality },
    { key: 'values', label: '价值观', accent: CALL_ACCENTS.values },
    { key: 'emotion', label: '情绪', accent: CALL_ACCENTS.emotion },
    { key: 'memory', label: '记忆', accent: CALL_ACCENTS.memory },
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
          <CodeBlock value={fragment.content} maxHeight={240} />
        </DimensionPanel>
      ),
    }]
  })

  const anchors = [
    ...fragmentSections.map((section) => ({ id: section.id, label: section.label, visible: true })),
    {
      id: 'messages',
      label: 'Messages',
      visible:
        Array.isArray(call.messages) && call.messages.length > 0
          || call.response !== undefined
          || !!call.error
          || inlineCompactionCall !== null,
    },
    { id: 'tools', label: 'Tools', visible: toolsCount > 0 },
    { id: 'final-prompt', label: 'Final prompt', visible: Boolean(call.systemPrompt) },
  ].filter((item) => item.visible)

  const scrollToSection = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <article
      style={{
        border: `1px solid ${expanded ? CALL_ACCENTS.turn.color : 'var(--border)'}`,
        borderRadius: 22,
        background: expanded ? CALL_ACCENTS.turn.soft : 'rgba(255, 255, 255, 0.03)',
        boxShadow: expanded ? 'var(--shadow-lift)' : 'none',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          padding: expanded ? '16px 16px 12px' : '16px',
          border: 'none',
          background: 'transparent',
          color: 'var(--fg)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
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
              主对话
            </span>
            <span style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>#{call.turnIndex}</span>
            <span style={{ color: call.finished ? 'var(--fg-muted)' : 'var(--orange)', fontSize: 12 }}>
              {call.finished ? 'finished' : 'running'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Pill label="model" value={call.model} />
            <Pill label="tools" value={String(toolsCount)} />
            <Pill label="fragments" value={String(fragmentsCount)} />
            <Pill label="stop" value={call.stopReason ?? (call.finished ? 'end_turn' : 'pending')} accent={CALL_ACCENTS.turn.color} />
            <Pill label="in" value={String(call.usage?.inputTokens ?? '?')} />
            <Pill label="out" value={String(call.usage?.outputTokens ?? '?')} />
          </div>
        </div>
        <span style={{ color: 'var(--fg-subtle)', fontSize: 12, flexShrink: 0 }}>{expanded ? '收起' : '展开'}</span>
      </button>

      {expanded && (
        <div style={{ padding: '0 16px 16px' }}>
          <div
            style={{
              maxHeight: 'min(58vh, 640px)',
              overflowY: 'auto',
              paddingRight: 4,
              scrollBehavior: 'smooth',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 3,
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                padding: '10px 0 12px',
                background: 'linear-gradient(180deg, rgba(9, 9, 14, 0.98), rgba(9, 9, 14, 0.88))',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
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
                style={{ scrollMarginTop: 56 }}
              >
                {section.node}
              </div>
            ))}

            <div
              ref={(node) => {
                sectionRefs.current.messages = node
              }}
              style={{ scrollMarginTop: 56 }}
            >
              <DimensionPanel title="Messages" accent={CALL_ACCENTS.turn}>
                <MessagesTimeline call={call} inlineCompactionCall={inlineCompactionCall} />
              </DimensionPanel>
            </div>

            {toolsCount > 0 && (
              <div
                ref={(node) => {
                  sectionRefs.current.tools = node
                }}
                style={{ scrollMarginTop: 56 }}
              >
                <CollapsibleSection title="Tools schema" accent={CALL_ACCENTS.turn.color} badge={String(toolsCount)}>
                  <CodeBlock value={JSON.stringify(call.tools ?? null, null, 2)} maxHeight={280} />
                </CollapsibleSection>
              </div>
            )}

            {call.systemPrompt && (
              <div
                ref={(node) => {
                  sectionRefs.current['final-prompt'] = node
                }}
                style={{ scrollMarginTop: 56 }}
              >
                <CollapsibleSection title="Final system prompt" accent={CALL_ACCENTS.turn.color}>
                  <CodeBlock value={call.systemPrompt} maxHeight={320} />
                </CollapsibleSection>
              </div>
            )}
          </div>
        </div>
      )}
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
  return (
    <EmptyState
      title={title}
      body={scheme ? `当前 scheme "${scheme}" 暂未实现该 tab 组件。` : '当前 agent 没有可识别的 scheme 配置。'}
    />
  )
}

export function ObserverDrawer({
  turn,
  agentModules,
  activeTab,
  setActiveTab,
  expandedMainCallIds,
  setExpandedMainCallIds,
}: Props) {
  const mainCalls = useMemo(() => turn.calls.filter((call) => call.kind === 'turn'), [turn.calls])
  const memoryCalls = useMemo(() => turn.calls.filter((call) => call.kind === 'memory'), [turn.calls])
  const emotionCalls = useMemo(() => turn.calls.filter((call) => call.kind === 'emotion'), [turn.calls])

  useEffect(() => {
    const validIds = expandedMainCallIds.filter((callId) => mainCalls.some((call) => call.callId === callId))
    if (validIds.length !== expandedMainCallIds.length) {
      setExpandedMainCallIds(validIds)
      return
    }

    if (mainCalls.length > 0 && validIds.length === 0) {
      setExpandedMainCallIds([mainCalls[mainCalls.length - 1].callId])
    }
  }, [expandedMainCallIds, mainCalls, setExpandedMainCallIds])

  const memoryScheme = typeof agentModules?.memory?.scheme === 'string' ? agentModules.memory.scheme : null
  const emotionScheme = typeof agentModules?.emotion?.scheme === 'string' ? agentModules.emotion.scheme : null

  const renderMainTab = () => {
    if (mainCalls.length === 0) {
      return (
        <EmptyState
          title="本轮未触发主对话调用"
          body={turn.status === 'running' ? '正在等待主对话 call 开始。' : '当前 turn 没有可展示的主对话 call。'}
        />
      )
    }

    return mainCalls.map((call) => {
      const callIndex = turn.calls.findIndex((candidate) => candidate.callId === call.callId)
      const previousCall = callIndex > 0 ? turn.calls[callIndex - 1] : null

      return (
        <MainTurnCallCard
          key={call.callId}
          call={call}
          expanded={expandedMainCallIds.includes(call.callId)}
          onToggle={() =>
            setExpandedMainCallIds(
              expandedMainCallIds.includes(call.callId)
                ? expandedMainCallIds.filter((id) => id !== call.callId)
                : [...expandedMainCallIds, call.callId],
            )
          }
          inlineCompactionCall={previousCall?.kind === 'compaction' ? previousCall : null}
        />
      )
    })
  }

  const renderMemoryTab = () => {
    if (memoryCalls.length === 0) {
      return <EmptyState title="本轮未触发记忆调用" body="当前 turn 没有 memory.retrieve / summarize / consolidate 调用。" />
    }

    if (memoryScheme !== 'sqlite') {
      return <UnknownSchemeCard title="记忆组件未命中" scheme={memoryScheme} />
    }

    return memoryCalls.map((call) => <MemoryCallCardSqlite key={call.callId} call={call} />)
  }

  const renderEmotionTab = () => {
    if (emotionCalls.length === 0) {
      return <EmptyState title="本轮未触发情绪调用" body="当前 turn 没有 emotion.delta 调用。" />
    }

    if (emotionScheme !== 'dimensional') {
      return <UnknownSchemeCard title="情绪组件未命中" scheme={emotionScheme} />
    }

    return emotionCalls.map((call) => <EmotionCallCardDimensional key={call.callId} call={call} />)
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
        <strong style={{ color: 'var(--fg)', fontSize: 14 }}>Observer</strong>
        <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{formatTurnStatus(turn.status)}</span>
      </div>

      <div
        style={{
          padding: 14,
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          gap: 10,
          flexShrink: 0,
          background: 'rgba(8, 8, 13, 0.92)',
          position: 'sticky',
          top: 0,
          zIndex: 5,
        }}
      >
        {[
          { id: 'main', label: '主对话', count: mainCalls.length },
          { id: 'memory', label: '记忆', count: memoryCalls.length },
          { id: 'emotion', label: '情绪', count: emotionCalls.length },
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
              padding: '7px 12px',
              fontSize: 12,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
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
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          minHeight: 0,
        }}
      >
        {activeTab === 'main' && renderMainTab()}
        {activeTab === 'memory' && renderMemoryTab()}
        {activeTab === 'emotion' && renderEmotionTab()}
      </div>
    </aside>
  )
}
