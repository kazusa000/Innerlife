import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bootstrapAppDatabases } from './bootstrap'
import { getDb, getRawSqlite, resetDb } from './client'
import { resetMemoryDb } from './memory-client'

function tableExists(name: string) {
  const row = getRawSqlite()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { name: string } | undefined
  return Boolean(row)
}

test('bootstrap removes legacy evaluation tables from existing app databases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-bootstrap-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    resetDb()
    resetMemoryDb()
    getDb(dbPath)
    getRawSqlite().exec(`
      CREATE TABLE turing_test_runs (id TEXT PRIMARY KEY);
      CREATE TABLE turing_test_events (id TEXT PRIMARY KEY, run_id TEXT);
    `)

    assert.equal(tableExists('turing_test_runs'), true)
    assert.equal(tableExists('turing_test_events'), true)

    bootstrapAppDatabases({ dbPath, memoryDbPath })

    assert.equal(tableExists('turing_test_events'), false)
    assert.equal(tableExists('turing_test_runs'), false)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
