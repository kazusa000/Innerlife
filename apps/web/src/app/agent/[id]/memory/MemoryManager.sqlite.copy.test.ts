import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getEntityTypeLabel,
  getMemoryLayerLabel,
  getSqliteMemoryCopy,
} from './MemoryManager.sqlite.copy'

test('sqlite memory manager copy renders English labels for English locale', () => {
  const copy = getSqliteMemoryCopy('en-US')

  assert.equal(copy.hero.eyebrow, 'Memory Management')
  assert.equal(copy.actions.refresh, 'Refresh')
  assert.equal(copy.graph.nodesTitle, 'Entity Nodes')
  assert.equal(getMemoryLayerLabel('short_term', 'en-US'), 'Short-Term Memory')
  assert.equal(getMemoryLayerLabel('fixed', 'en-US'), 'Fixed Memory')
  assert.equal(getMemoryLayerLabel('episodic', 'en-US'), 'Episodic Memory')
  assert.equal(getEntityTypeLabel('person', 'en-US'), 'Person')
  assert.equal(getEntityTypeLabel('event', 'en-US'), 'Event')
})

test('sqlite memory manager copy keeps Chinese labels for Chinese locale', () => {
  const copy = getSqliteMemoryCopy('zh-CN')

  assert.equal(copy.hero.eyebrow, '记忆管理')
  assert.equal(copy.actions.refresh, '刷新')
  assert.equal(copy.graph.nodesTitle, '实体节点')
  assert.equal(getMemoryLayerLabel('short_term', 'zh-CN'), '短期记忆')
  assert.equal(getEntityTypeLabel('object', 'zh-CN'), '物品')
})
