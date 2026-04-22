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
  assert.equal(html.includes('聚焦点'), false)
})
