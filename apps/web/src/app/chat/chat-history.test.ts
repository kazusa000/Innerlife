import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatMessageTime,
  getInitialVisibleDayKeys,
  getNextHiddenDayKey,
  getVisibleMessages,
  localDayKey,
} from './chat-history'

const today = new Date(2026, 3, 25, 12, 0, 0)
const messages = [
  { id: 'old', createdAt: new Date(2026, 3, 23, 9, 15, 0).toISOString() },
  { id: 'yesterday', createdAt: new Date(2026, 3, 24, 18, 30, 0).toISOString() },
  { id: 'today', createdAt: new Date(2026, 3, 25, 8, 5, 0).toISOString() },
]

test('localDayKey uses the browser-local calendar day', () => {
  assert.equal(localDayKey(new Date(2026, 3, 25, 1, 2, 3)), '2026-04-25')
})

test('formatMessageTime renders a compact local clock time', () => {
  assert.equal(formatMessageTime(new Date(2026, 3, 25, 8, 5, 0).toISOString()), '08:05')
})

test('initial visible days only include today', () => {
  assert.deepEqual(getInitialVisibleDayKeys(messages, today), ['2026-04-25'])
  assert.deepEqual(getVisibleMessages(messages, ['2026-04-25']).map((message) => message.id), ['today'])
})

test('next hidden day loads one earlier day at a time', () => {
  const first = getNextHiddenDayKey(messages, ['2026-04-25'], today)
  assert.equal(first, '2026-04-24')
  const second = getNextHiddenDayKey(messages, ['2026-04-25', first!], today)
  assert.equal(second, '2026-04-23')
  const none = getNextHiddenDayKey(messages, ['2026-04-25', first!, second!], today)
  assert.equal(none, null)
})
