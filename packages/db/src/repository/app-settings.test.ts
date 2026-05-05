import test from 'node:test'
import assert from 'node:assert/strict'
import { resetDb } from '../client'
import { bootstrapAppDatabases } from '../bootstrap'
import {
  getAppLocale,
  setAppLocale,
} from './app-settings'

test.afterEach(() => {
  resetDb()
})

test('app locale defaults to zh-CN and persists en-US', () => {
  bootstrapAppDatabases({ dbPath: ':memory:', memoryDbPath: ':memory:' })

  assert.equal(getAppLocale(), 'zh-CN')
  setAppLocale('en-US')
  assert.equal(getAppLocale(), 'en-US')
})
