import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDurationLabel, formatDurationMs } from './format-duration'

test('formatDurationMs renders short and long durations compactly', () => {
  assert.equal(formatDurationMs(923), '923ms')
  assert.equal(formatDurationMs(1200), '1.2s')
  assert.equal(formatDurationMs(12345), '12.3s')
})

test('formatDurationLabel returns running state or formatted duration', () => {
  assert.equal(formatDurationLabel(1000, null), 'running…')
  assert.equal(formatDurationLabel(1000, 2200), '1.2s')
  assert.equal(formatDurationLabel(null, null), null)
})
