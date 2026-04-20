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
    consolidateLabel: 'Consolidate sqlite memory',
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
  assert.equal(state.consolidateLabel, 'Consolidate sqlite memory')
  assert.equal(state.status, 'Loading…')
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
    consolidateLabel: 'Consolidating sqlite memory…',
    status: 'Consolidating…',
  })
})
