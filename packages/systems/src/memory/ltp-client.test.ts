import assert from 'node:assert/strict'
import test from 'node:test'
import { createHttpLtpClient } from './ltp-client'

test('createHttpLtpClient returns trimmed candidates', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(
    JSON.stringify({ candidates: [' 海边灯塔画面 ', '', '画面'] }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )

  try {
    const client = createHttpLtpClient('http://127.0.0.1:7788/')
    const result = await client.analyze({ text: '海边灯塔画面' })
    assert.deepEqual(result.candidates, ['海边灯塔画面', '画面'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createHttpLtpClient keeps empty candidate list when service returns no anchors', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(
    JSON.stringify({ candidates: [] }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )

  try {
    const client = createHttpLtpClient('http://127.0.0.1:7788')
    const result = await client.analyze({ text: '之前我们聊过吗' })
    assert.deepEqual(result.candidates, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createHttpLtpClient throws when service is unavailable', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED')
  }

  try {
    const client = createHttpLtpClient('http://127.0.0.1:7788')
    await assert.rejects(
      () => client.analyze({ text: '海边灯塔画面' }),
      /ECONNREFUSED/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
