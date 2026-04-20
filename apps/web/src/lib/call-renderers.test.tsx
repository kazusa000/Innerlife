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
        retrievalQuery: '最近在修 sqlite memory 的 consolidate 按钮问题',
        focus: 'consolidate 按钮',
        timeRange: {
          start: '2026-04-20T13:55:00.000Z',
          end: '2026-04-20T14:00:00.000Z',
        },
        hits: [],
      },
    }),
  )

  assert.equal(html.includes('时间范围'), true)
  assert.equal(html.includes('2026-04-20T13:55:00.000Z'), true)
  assert.equal(html.includes('2026-04-20T14:00:00.000Z'), true)
  assert.equal(html.includes('最近在修 sqlite memory 的 consolidate 按钮问题'), true)
  assert.equal(html.includes('consolidate 按钮'), true)
})
