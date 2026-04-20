import assert from 'node:assert/strict'
import test from 'node:test'
import { getSqliteMemoryToolbarState } from './MemoryManager.sqlite.state'

test('idle toolbar enables consolidate when sqlite memories exist', () => {
  const state = getSqliteMemoryToolbarState({
    loading: false,
    pending: false,
    isConsolidating: false,
    memoryCount: 3,
  })

  assert.deepEqual(state, {
    refreshDisabled: false,
    consolidateDisabled: false,
    deleteDisabled: false,
    consolidateLabel: '整理 sqlite 记忆',
    status: null,
  })
})

test('empty or loading toolbar keeps consolidate unavailable', () => {
  const state = getSqliteMemoryToolbarState({
    loading: true,
    pending: false,
    isConsolidating: false,
    memoryCount: 0,
  })

  assert.equal(state.refreshDisabled, false)
  assert.equal(state.consolidateDisabled, true)
  assert.equal(state.deleteDisabled, false)
  assert.equal(state.consolidateLabel, '整理 sqlite 记忆')
  assert.equal(state.status, '加载中…')
})

test('consolidating toolbar shows progress and locks actions', () => {
  const state = getSqliteMemoryToolbarState({
    loading: false,
    pending: false,
    isConsolidating: true,
    memoryCount: 5,
  })

  assert.deepEqual(state, {
    refreshDisabled: true,
    consolidateDisabled: true,
    deleteDisabled: true,
    consolidateLabel: '正在整理 sqlite 记忆…',
    status: '整理中…',
  })
})
