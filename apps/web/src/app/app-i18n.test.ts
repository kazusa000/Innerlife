import assert from 'node:assert/strict'
import test from 'node:test'
import { getHomeCopy, getManagerTiles } from './app-i18n'

test('home copy renders English labels for en-US locale', () => {
  const copy = getHomeCopy('en-US')

  assert.equal(copy.title, 'Persona Hall')
  assert.equal(copy.newAgent, 'New Persona')
  assert.equal(copy.deleteConfirm, 'Delete this persona and all of its conversations?')
  assert.equal(copy.moduleTitles.personality, 'Persona')
  assert.equal(copy.moduleValues.configured, 'Configured')
})

test('manager tile labels are localized without changing their routes', () => {
  const zhTiles = getManagerTiles('zh-CN')
  const enTiles = getManagerTiles('en-US')

  assert.equal(zhTiles.find((tile) => tile.section === 'tools')?.title, '工具')
  assert.equal(enTiles.find((tile) => tile.section === 'tools')?.title, 'Tools')
  assert.deepEqual(
    enTiles.map((tile) => tile.section),
    zhTiles.map((tile) => tile.section),
  )
})
