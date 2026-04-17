import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite } from '../client'
import { createAgent, getAgent, updateAgent } from './agents'

test('createAgent and updateAgent round-trip nullable modules JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-agents-'))
  const dbPath = join(dir, 'test.db')

  try {
    getDb(dbPath)
    getRawSqlite().exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        personality TEXT,
        skills TEXT,
        modules TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        model TEXT NOT NULL,
        config TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
      );
    `)

    const created = createAgent({
      name: 'Modules Test',
      description: 'repo test',
      model: 'claude-sonnet-4-6',
    })

    assert.equal(created.modules, null)

    const modules = {
      personality: { type: 'big-five' },
      safety: { mode: 'confirm-dangerous' },
    }

    const updated = updateAgent(created.id, { modules })
    assert.deepEqual(updated?.modules, modules)

    const loaded = getAgent(created.id)
    assert.deepEqual(loaded?.modules, modules)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
