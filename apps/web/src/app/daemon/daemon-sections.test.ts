import assert from 'node:assert/strict'
import test from 'node:test'
import { getDaemonSections } from './daemon-sections'

test('daemon workbench sections define left navigation order and anchors', () => {
  assert.deepEqual(getDaemonSections(), [
    { id: 'overview', anchor: 'daemon-section-overview', label: '概览', description: '运行状态' },
    { id: 'turing', anchor: 'daemon-section-turing', label: '图灵测试', description: '最近 run' },
    { id: 'flush', anchor: 'daemon-section-flush', label: '记忆 Flush', description: 'context → STM' },
    { id: 'sleep', anchor: 'daemon-section-sleep', label: '睡眠', description: 'STM → LTM' },
    { id: 'events', anchor: 'daemon-section-events', label: '事件流', description: '后台日志' },
  ])
})
