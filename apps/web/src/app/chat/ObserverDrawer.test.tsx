import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ObserverDrawer } from './ObserverDrawer'
import type { LiveCall } from './observer-types'

function renderDrawer(calls: LiveCall[], activeCallId: string | null) {
  return renderToStaticMarkup(
    React.createElement(ObserverDrawer, {
      calls,
      activeCallId,
      setActiveCallId: () => {},
    }),
  )
}

test('observer drawer only renders turn calls and keeps compaction inline hint', () => {
  const calls: LiveCall[] = [
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
    {
      callId: 'turn-1',
      turnIndex: 1,
      kind: 'turn',
      model: 'fake-model',
      systemPrompt: 'base prompt',
      tools: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      metadata: {
        fragments: [
          { source: 'personality', priority: 10, content: 'personality fragment' },
        ],
      },
      response: [{ type: 'text', text: 'ok' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
      finished: true,
    },
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
        hits: [{ id: 'm1', summary: 'should be hidden', tags: ['x'], importance: 0.9 }],
      },
      response: [{ type: 'text', text: '{}' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
      finished: true,
    },
    {
      callId: 'emotion-1',
      turnIndex: 3,
      kind: 'emotion',
      model: 'fake-model',
      systemPrompt: 'emotion prompt',
      tools: [],
      messages: [],
      metadata: {
        before: { mood: 0.1, energy: 0.2, stress: 0.3 },
        after: { mood: 0.2, energy: 0.3, stress: 0.2 },
        delta: { mood: 0.1, energy: 0.1, stress: -0.1 },
      },
      response: [{ type: 'text', text: '{}' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
      finished: true,
    },
  ]

  const html = renderDrawer(calls, 'turn-1')

  assert.equal((html.match(/主对话/g) ?? []).length, 1)
  assert.equal(html.includes('memory.retrieve'), false)
  assert.equal(html.includes('memory.summarize'), false)
  assert.equal(html.includes('memory.consolidate'), false)
  assert.equal(html.includes('emotion.delta'), false)
  assert.equal(html.includes('本轮压缩：25 条 → 1 条摘要'), true)
})

test('observer drawer dimension cards render only fragment content and skip absent systems', () => {
  const call: LiveCall = {
    callId: 'turn-1',
    turnIndex: 0,
    kind: 'turn',
    model: 'fake-model',
    systemPrompt: 'base prompt\n\npersonality fragment\n\nmemory fragment',
    tools: [],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    metadata: {
      fragments: [
        { source: 'personality', priority: 10, content: 'personality fragment' },
        { source: 'memory', priority: 30, content: 'memory fragment' },
      ],
      memory: {
        hitCount: 2,
      },
      hits: [
        {
          id: 'memory-1',
          summary: 'sqlite hit summary should stay hidden',
          tags: ['pet'],
          importance: 0.9,
          matchedTerms: ['cat'],
        },
      ],
      before: { mood: 0.1, energy: 0.2, stress: 0.3 },
      after: { mood: 0.2, energy: 0.2, stress: 0.1 },
      delta: { mood: 0.1, energy: 0, stress: -0.2 },
      trigger: 'trigger should stay hidden',
    },
    response: [{ type: 'text', text: 'ok' }],
    stopReason: 'end_turn',
    usage: { inputTokens: 10, outputTokens: 5 },
    finished: true,
  }

  const html = renderDrawer([call], 'turn-1')

  assert.equal(html.includes('personality fragment'), true)
  assert.equal(html.includes('memory fragment'), true)
  assert.equal(html.includes('sqlite hit summary should stay hidden'), false)
  assert.equal(html.includes('trigger should stay hidden'), false)
  assert.equal(html.includes('matched terms'), false)
  assert.equal(html.includes('importance'), false)
  assert.equal(html.includes('性格'), true)
  assert.equal(html.includes('记忆'), true)
  assert.equal(html.includes('价值观'), false)
  assert.equal(html.includes('情绪'), false)
})
