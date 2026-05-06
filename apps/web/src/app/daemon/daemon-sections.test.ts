import assert from 'node:assert/strict'
import test from 'node:test'
import { getDaemonNavGroups, getDaemonSections } from './daemon-sections'

test('daemon workbench sections define left navigation order and anchors', () => {
  assert.deepEqual(getDaemonSections(), [
    { id: 'overview', anchor: 'daemon-section-overview', label: '概览', description: '运行状态' },
    { id: 'flush', anchor: 'daemon-section-flush', label: '记忆 Flush', description: 'context → STM' },
    { id: 'sleep', anchor: 'daemon-section-sleep', label: '睡眠', description: 'STM → LTM' },
    { id: 'events', anchor: 'daemon-section-events', label: '事件流', description: '后台日志' },
  ])
})

test('daemon workbench nav groups collapse function-related sections under 功能', () => {
  assert.deepEqual(getDaemonNavGroups(), [
    {
      id: 'overview',
      label: '概览',
      description: '运行状态',
      anchor: 'daemon-section-overview',
    },
    {
      id: 'events',
      label: '事件流',
      description: '后台日志',
      anchor: 'daemon-section-events',
    },
    {
      id: 'features',
      label: '功能',
      description: 'Flush / 睡眠',
      children: [
        { id: 'flush', label: '记忆 Flush', anchor: 'daemon-section-flush', description: 'context → STM' },
        { id: 'sleep', label: '睡眠', anchor: 'daemon-section-sleep', description: 'STM → LTM' },
      ],
    },
  ])
})
