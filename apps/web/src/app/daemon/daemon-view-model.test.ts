import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDaemonEventLine, getDaemonHeadline } from './daemon-view-model'

test('getDaemonHeadline distinguishes online and offline daemon states', () => {
  assert.equal(getDaemonHeadline(null), 'Daemon 离线')
  assert.equal(getDaemonHeadline({
    id: 'local',
    pid: 4242,
    status: 'running',
    startedAt: '2026-04-22T09:00:00.000Z',
    lastHeartbeatAt: '2026-04-22T09:01:00.000Z',
    stoppedAt: null,
    lastError: null,
    updatedAt: '2026-04-22T09:01:00.000Z',
  }), 'Daemon 在线')
})

test('formatDaemonEventLine renders time-prefixed console output', () => {
  const line = formatDaemonEventLine({
    id: 'event-1',
    kind: 'flush_success',
    scope: 'memory_flush',
    message: 'context flush 完成',
    payload: null,
    createdAt: '2026-04-22T09:03:00.000Z',
  })

  assert.equal(line.includes('[memory_flush]'), true)
  assert.equal(line.includes('context flush 完成'), true)
})
