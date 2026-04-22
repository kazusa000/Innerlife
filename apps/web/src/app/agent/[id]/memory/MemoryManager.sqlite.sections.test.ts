import assert from 'node:assert/strict'
import test from 'node:test'
import { getMemoryManagerSections } from './MemoryManager.sqlite.sections'

test('memory manager sections define left navigation order and anchors', () => {
  assert.deepEqual(getMemoryManagerSections(), [
    { id: 'context', anchor: 'memory-section-context', label: 'Context', description: '缓存窗口' },
    { id: 'sleep', anchor: 'memory-section-sleep', label: '睡眠', description: '沉淀节奏' },
    { id: 'prompt', anchor: 'memory-section-prompt', label: 'Prompt Lab', description: '提示词' },
    { id: 'memory', anchor: 'memory-section-memory', label: '记忆', description: '检索与层级' },
  ])
})
