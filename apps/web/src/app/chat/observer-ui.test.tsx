import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DetailList, MessagesTimeline } from './observer-ui'
import type { LiveCall } from './observer-types'

test('DetailList preserves line breaks for string values', () => {
  const html = renderToStaticMarkup(
    React.createElement(DetailList, {
      rows: [
        {
          label: '输入预览',
          value: '最近对话（仅供补全当前问题）：\n用户：我上周收养了一只猫。\n\n当前用户消息：\n它叫什么来着',
        },
      ],
    }),
  )

  assert.equal(html.includes('white-space:pre-wrap'), true)
  assert.equal(html.includes('最近对话（仅供补全当前问题）：'), true)
  assert.equal(html.includes('当前用户消息：'), true)
})

test('MessagesTimeline renders episodic tool result graph trace metadata', () => {
  const call = {
    callId: 'turn-1',
    turnIndex: 1,
    kind: 'turn',
    model: 'fake-model',
    systemPrompt: 'prompt',
    tools: [],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: '情景记忆召回结果：\n[情景记忆] 黄铜指南针被放在 MAS Lab 白板旁。',
            metadata: {
              mode: 'episodic_hybrid',
              textQuery: '黄铜指南针 MAS Lab 白板',
              entityMentions: [{ surface: '指南针', type: 'object' }],
              entityCandidates: [
                {
                  mention: { surface: '指南针', type: 'object' },
                  entity: { id: 'entity-compass', canonicalName: '黄铜指南针', type: 'object' },
                  matchKind: 'contains',
                },
              ],
              activatedEntities: [
                { id: 'entity-compass', canonicalName: '黄铜指南针', type: 'object', activation: 1 },
              ],
              hits: [
                {
                  id: 'episodic-1',
                  summary: '黄铜指南针被放在 MAS Lab 白板旁。',
                  entities: [{ id: 'entity-compass', canonicalName: '黄铜指南针', type: 'object', weight: 0.9 }],
                },
              ],
            },
          },
        ],
      },
    ],
    response: [],
    finished: true,
  } as LiveCall

  const html = renderToStaticMarkup(
    React.createElement(MessagesTimeline, {
      call,
      inlineCompactionCall: null,
    }),
  )

  assert.equal(html.includes('Graph Trace'), true)
  assert.equal(html.includes('Mention Candidates'), true)
  assert.equal(html.includes('Activated Entities'), true)
  assert.equal(html.includes('指南针'), true)
  assert.equal(html.includes('黄铜指南针'), true)
  assert.equal(html.includes('contains'), true)
})
