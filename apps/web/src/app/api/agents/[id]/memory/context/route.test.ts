import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getMemoryDb, getRawSqlite, resetDb, resetMemoryDb } from '@mas/db'
import { flushAgentContext } from './handler'

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
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model, provider, modules)
    VALUES ('agent-1', 'Agent One', 'claude-sonnet-4-6', 'openrouter', '{"memory":{"scheme":"sqlite"}}');
    INSERT INTO agents (id, name, model, provider, modules)
    VALUES ('agent-2', 'Agent Two', 'claude-sonnet-4-6', 'openrouter', '{"memory":{"scheme":"noop"}}');
    INSERT INTO sessions (id, agent_id, status) VALUES ('session-1', 'agent-1', 'active');
  `)
}

test('flushAgentContext returns 404 when the agent does not exist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-context-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    const response = await flushAgentContext('missing-agent')

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Not found' })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flushAgentContext returns 400 when memory is not sqlite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-context-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    const response = await flushAgentContext('agent-2')

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'Agent memory scheme must be sqlite' })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flushAgentContext returns the active session id and job result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-context-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    const response = await flushAgentContext('agent-1', {
      async runContextFlushForSession(input) {
        assert.deepEqual(input, {
          sessionId: 'session-1',
          mode: 'manual',
        })
        return {
          ok: true as const,
          mode: 'manual' as const,
          createdCount: 2,
          memoryIds: ['memory-1', 'memory-2'],
          nextActiveStartMessageId: 'message-9',
          flushedMessageCount: 8,
        }
      },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      agentId: 'agent-1',
      sessionId: 'session-1',
      result: {
        ok: true,
        mode: 'manual',
        createdCount: 2,
        memoryIds: ['memory-1', 'memory-2'],
        nextActiveStartMessageId: 'message-9',
        flushedMessageCount: 8,
      },
    })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
