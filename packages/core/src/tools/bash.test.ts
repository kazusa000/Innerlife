import assert from 'node:assert/strict'
import test from 'node:test'
import { BashTool } from './bash'

test('BashTool ends quickly when aborted', async () => {
  const abortController = new AbortController()
  const startedAt = Date.now()

  const promise = BashTool.call(
    { command: 'sleep 5', timeout: 10_000 },
    { signal: abortController.signal },
  )

  setTimeout(() => abortController.abort(), 100)

  const result = await promise
  const durationMs = Date.now() - startedAt

  assert.equal(result.isError, true)
  assert.equal(result.metadata?.aborted, true)
  assert.match(result.output, /aborted/i)
  assert.ok(durationMs < 2_000, `expected abort in < 2s, got ${durationMs}ms`)
})
