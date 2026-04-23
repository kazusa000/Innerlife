import assert from 'node:assert/strict'
import test from 'node:test'
import { getSqliteMemoryToolbarState } from './MemoryManager.sqlite.state'

test('idle toolbar keeps refresh and delete available without consolidate controls', () => {
  const state = getSqliteMemoryToolbarState({
    loading: false,
    pending: false,
    memoryCount: 3,
  })

  assert.deepEqual(state, {
    refreshDisabled: false,
    deleteDisabled: false,
    status: null,
  })
})

test('loading toolbar only reports loading status', () => {
  const state = getSqliteMemoryToolbarState({
    loading: true,
    pending: false,
    memoryCount: 0,
  })

  assert.equal(state.refreshDisabled, false)
  assert.equal(state.deleteDisabled, false)
  assert.equal(state.status, '加载中…')
})
