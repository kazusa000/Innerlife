import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ObserverDrawer } from './ObserverDrawer'
import type { AgentModules, LiveCall, ObserverTab, ObserverTurnState } from './observer-types'

function renderDrawer({
  turn,
  activeTab,
  agentModules = null,
}: {
  turn: ObserverTurnState
  activeTab: ObserverTab
  agentModules?: AgentModules | null
}) {
  return renderToStaticMarkup(
    React.createElement(ObserverDrawer, {
      turn,
      activeTab,
      agentModules,
      setActiveTab: () => {},
    }),
  )
}

const baseTurnCall: LiveCall = {
  callId: 'turn-1',
  turnIndex: 1,
  kind: 'turn',
  model: 'fake-model',
  systemPrompt: 'base prompt',
  tools: [{ name: 'bash' }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  metadata: {
    fragments: [
      { source: 'personality', priority: 10, content: 'personality fragment' },
      { source: 'memory', priority: 30, content: 'memory fragment' },
    ],
    hits: [{ id: 'm1', summary: 'should stay out of main tab', tags: ['x'], importance: 0.9 }],
  },
  response: [{ type: 'text', text: 'ok' }],
  stopReason: 'end_turn',
  usage: { inputTokens: 10, outputTokens: 5 },
  finished: true,
}

test('main tab renders turn cards with fragment anchors and inline compaction only', () => {
  const turn: ObserverTurnState = {
    status: 'complete',
    calls: [
      {
        callId: 'compaction-1',
        turnIndex: 0,
        kind: 'compaction',
        model: 'fake-model',
        systemPrompt: 'compaction prompt',
        tools: [],
        messages: [],
        metadata: {
          beforeMessageCount: 45,
          afterMessageCount: 21,
          summary: 'summary text',
        },
        response: [{ type: 'text', text: 'summary text' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        finished: true,
      },
      baseTurnCall,
      {
        callId: 'memory-1',
        turnIndex: 2,
        kind: 'memory',
        model: 'fake-model',
        systemPrompt: 'memory prompt',
        tools: [],
        messages: [],
        metadata: {
          phase: 'retrieve',
          keywords: ['cat'],
          hits: [{ id: 'm2', summary: 'sqlite hit summary', tags: ['pet'], importance: 0.8 }],
        },
        response: [{ type: 'text', text: '{}' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        finished: true,
      },
    ],
  }

  const html = renderDrawer({
    turn,
    activeTab: 'main',
  })

  assert.equal(html.includes('主对话'), true)
  assert.equal(html.includes('记忆'), true)
  assert.equal(html.includes('情绪'), true)
  assert.equal(html.includes('personality fragment'), true)
  assert.equal(html.includes('memory fragment'), true)
  assert.equal(html.includes('should stay out of main tab'), false)
  assert.equal(html.includes('本轮压缩：25 条 → 1 条摘要'), true)
  assert.equal(html.includes('Messages'), true)
  assert.equal(html.includes('Tools'), true)
  assert.equal(html.includes('Final prompt'), true)
})

test('memory tab renders sqlite retrieve and summarize details', () => {
  const turn: ObserverTurnState = {
    status: 'complete',
    calls: [
      {
        callId: 'memory-retrieve',
        turnIndex: 0,
        kind: 'memory',
        model: 'fake-model',
        systemPrompt: 'memory retrieve prompt',
        tools: [],
        messages: [],
        metadata: {
          phase: 'retrieve',
          keywords: ['cat'],
          fallbackKeywords: ['pet'],
          timeRange: {
            start: '2026-04-20T13:55:00.000Z',
            end: '2026-04-20T14:00:00.000Z',
          },
          hits: [
            {
              id: 'memory-1',
              summary: 'cat memory',
              tags: ['pet'],
              importance: 0.9,
              matchedTerms: ['cat'],
            },
          ],
        },
        response: [{ type: 'text', text: '{}' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        finished: true,
      },
    ],
  }

  const html = renderDrawer({
    turn,
    activeTab: 'memory',
    agentModules: { memory: { scheme: 'sqlite' } },
  })

  assert.equal(html.includes('memory.retrieve'), true)
  assert.equal(html.includes('time range'), true)
  assert.equal(html.includes('2026-04-20T13:55:00.000Z'), true)
  assert.equal(html.includes('2026-04-20T14:00:00.000Z'), true)
  assert.equal(html.includes('原 prompt'), true)
  assert.equal(html.includes('retrieve'), true)
  assert.equal(html.includes('cat memory'), true)
})

test('emotion tab renders dimensional delta details and empty tabs remain visible', () => {
  const turn: ObserverTurnState = {
    status: 'complete',
    calls: [
      {
        callId: 'emotion-1',
        turnIndex: 0,
        kind: 'emotion',
        model: 'fake-model',
        systemPrompt: 'emotion prompt',
        tools: [],
        messages: [],
        metadata: {
          before: { mood: 0.1, energy: 0.2, stress: 0.3 },
          after: { mood: 0.2, energy: 0.4, stress: 0.1 },
          delta: { mood: 0.1, energy: 0.2, stress: -0.2 },
          trigger: 'user was relieved',
        },
        response: [{ type: 'text', text: '{}' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        finished: true,
      },
    ],
  }

  const html = renderDrawer({
    turn,
    activeTab: 'emotion',
    agentModules: { emotion: { scheme: 'dimensional' } },
  })

  assert.equal(html.includes('主对话'), true)
  assert.equal(html.includes('记忆'), true)
  assert.equal(html.includes('情绪'), true)
  assert.equal(html.includes('emotion.delta'), true)
  assert.equal(html.includes('user was relieved'), true)
  assert.equal(html.includes('Before'), true)
  assert.equal(html.includes('After'), true)
  assert.equal(html.includes('Delta'), true)
  assert.equal(html.includes('stress'), true)
})
