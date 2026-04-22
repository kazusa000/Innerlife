import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { FIXED_TURING_SUITE, getRulebookPaths, readRulebook } from './suite'

test('fixed turing suite exposes the seven stable stages in order', () => {
  assert.deepEqual(
    FIXED_TURING_SUITE.map((stage) => stage.id),
    [
      'natural_opening',
      'daily_flow',
      'memory_recall',
      'memory_humanness',
      'emotional_plausibility',
      'relationship_boundaries',
      'uncertainty_and_leaks',
    ],
  )
})

test('memory_humanness stage covers layered memory behavior rather than only simple recall', () => {
  const stage = FIXED_TURING_SUITE.find((item) => item.id === 'memory_humanness')

  assert.ok(stage)
  assert.match(stage.title, /记忆拟人性/)
  assert.equal(stage.injections.some((item) => item.type === 'context'), true)
  assert.deepEqual(
    stage.injections.filter((item) => item.type === 'memory').map((item) => item.payload.layer),
    ['short_term', 'long_term', 'fixed'],
  )
  assert.deepEqual(
    stage.turns.map((turn) => turn.label),
    ['context 回忆', 'short_term 回忆', 'long_term 回忆', 'fixed 回忆', 'no-result 回忆'],
  )
})

test('rulebook markdown files resolve and can be read', () => {
  const paths = getRulebookPaths()
  for (const filePath of Object.values(paths)) {
    assert.equal(fs.existsSync(filePath), true)
    assert.match(readRulebook(
      Object.entries(paths).find(([, value]) => value === filePath)?.[0] as keyof typeof paths,
    ), /\S/)
  }
})
