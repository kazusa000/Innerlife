import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DetailList } from './observer-ui'

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
