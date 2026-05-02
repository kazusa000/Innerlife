import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getMemoryDb, getRawSqlite, resetDb, resetMemoryDb } from '@mas/db'
import { sleepAgentMemory } from './handler'

function bootstrapDb(dbPath: string, memoryDbPath: string) {
  process.env.MAS_MEMORY_DB_PATH = memoryDbPath
  resetDb()
  resetMemoryDb()
  getDb(dbPath)
  getMemoryDb(memoryDbPath)
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
      provider TEXT NOT NULL DEFAULT 'anthropic',
      config TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model, provider, modules)
    VALUES ('agent-1', 'Agent One', 'claude-sonnet-4-6', 'openrouter', '{"memory":{"scheme":"sqlite"}}');
    INSERT INTO agents (id, name, model, provider, modules)
    VALUES ('agent-2', 'Agent Two', 'claude-sonnet-4-6', 'openrouter', '{"memory":{"scheme":"noop"}}');
  `)
}

test('sleepAgentMemory returns 404 when the agent does not exist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sleep-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    const response = await sleepAgentMemory('missing-agent')

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Not found' })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sleepAgentMemory returns 400 when memory is not sqlite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sleep-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    const response = await sleepAgentMemory('agent-2')

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'Agent memory scheme must be sqlite' })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sleepAgentMemory returns the episodic consolidation result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sleep-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    const response = await sleepAgentMemory('agent-1', {
      async runEpisodicConsolidationForAgent(input) {
        assert.deepEqual(input, {
          agentId: 'agent-1',
        })
        return {
          ok: true as const,
          createdEntityCount: 2,
          createdEpisodicCount: 1,
          deletedShortTermCount: 3,
        }
      },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      agentId: 'agent-1',
      result: {
        ok: true,
        createdEntityCount: 2,
        createdEpisodicCount: 1,
        deletedShortTermCount: 3,
      },
    })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
