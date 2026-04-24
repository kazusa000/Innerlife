import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Sidebar } from './Sidebar'

test('Sidebar shows both clear actions for sqlite memory', () => {
  const html = renderToStaticMarkup(
    React.createElement(Sidebar, {
      agentName: 'Hazel',
      memoryScheme: 'sqlite',
      onResetContext: () => {},
    }),
  )

  assert.equal(html.includes('清除上下文并撰写短期记忆'), true)
  assert.equal(html.includes('清除上下文'), true)
})

test('Sidebar keeps only plain clear action for non-sqlite memory', () => {
  const html = renderToStaticMarkup(
    React.createElement(Sidebar, {
      agentName: 'Orion',
      memoryScheme: 'noop',
      onResetContext: () => {},
    }),
  )

  assert.equal(html.includes('清除上下文并撰写短期记忆'), false)
  assert.equal(html.includes('清除上下文'), true)
})
