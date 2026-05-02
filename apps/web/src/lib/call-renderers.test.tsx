import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryView } from './call-renderers'

test('MemoryView renders retrieve time range metadata', () => {
  const html = renderToStaticMarkup(
    React.createElement(MemoryView, {
      metadata: {
        phase: 'retrieve',
        timeAnalyzer: {
          timeRange: {
            start: '2026-04-20T13:55:00.000Z',
            end: '2026-04-20T14:00:00.000Z',
          },
          error: null,
        },
        semanticAnalyzer: {
          retrievalQuery: '最近在修 sqlite memory 的 consolidate 按钮问题',
          mode: 'llm',
          inputPreview: '最近对话（仅供补全当前问题）：\n用户：我们昨天在聊 sqlite memory。\n\n当前用户消息：\n最后是怎么修的来着',
          error: null,
        },
        mergedQuery: {
          retrievalQuery: '最近在修 sqlite memory 的 consolidate 按钮问题',
          timeRange: {
            start: '2026-04-20T13:55:00.000Z',
            end: '2026-04-20T14:00:00.000Z',
          },
        },
        retrievalQuery: '最近在修 sqlite memory 的 consolidate 按钮问题',
        timeRange: {
          start: '2026-04-20T13:55:00.000Z',
          end: '2026-04-20T14:00:00.000Z',
        },
        hits: [],
      },
    }),
  )

  assert.equal(html.includes('Time Analyzer'), true)
  assert.equal(html.includes('Merged Query'), true)
  assert.equal(html.includes('2026-04-20T13:55:00.000Z'), true)
  assert.equal(html.includes('2026-04-20T14:00:00.000Z'), true)
  assert.equal(html.includes('最近在修 sqlite memory 的 consolidate 按钮问题'), true)
  assert.equal(html.includes('最后是怎么修的来着'), true)
  assert.equal(html.includes('聚焦点'), false)
})

test('MemoryView renders episodic hybrid recall metadata as structured recall sources', () => {
  const html = renderToStaticMarkup(
    React.createElement(MemoryView, {
      metadata: {
        mode: 'episodic_hybrid',
        textQuery: '黄铜指南针 MAS Lab 白板',
        entityMentions: [
          { surface: '指南针', type: 'object' },
          { surface: 'MAS Lab', type: 'place' },
        ],
        hits: [
          {
            id: 'episodic-1',
            summary: '黄铜指南针被放在 MAS Lab 白板旁。',
            importance: 0.86,
            graphScore: 0.72,
            textScore: 0.64,
            score: 0.69,
            entities: [
              { id: 'entity-compass', canonicalName: '黄铜指南针', type: 'object', weight: 0.9 },
              { id: 'entity-lab', canonicalName: 'MAS Lab', type: 'place', weight: 0.7 },
            ],
          },
        ],
      },
    }),
  )

  assert.equal(html.includes('Hybrid Episodic Recall'), true)
  assert.equal(html.includes('黄铜指南针 MAS Lab 白板'), true)
  assert.equal(html.includes('指南针'), true)
  assert.equal(html.includes('MAS Lab'), true)
  assert.equal(html.includes('图分数'), true)
  assert.equal(html.includes('文本分数'), true)
  assert.equal(html.includes('最终分数'), true)
  assert.equal(html.includes('0.72'), true)
  assert.equal(html.includes('0.64'), true)
  assert.equal(html.includes('0.69'), true)
})
