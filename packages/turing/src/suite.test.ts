import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { FIXED_TURING_SUITE, getRulebookPaths, readRulebook } from './suite'

test('fixed turing suite exposes the six stable stages in order', () => {
  assert.deepEqual(
    FIXED_TURING_SUITE.map((stage) => stage.id),
    [
      'natural_opening',
      'daily_flow',
      'memory_recall',
      'emotional_plausibility',
      'relationship_boundaries',
      'uncertainty_and_leaks',
    ],
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
