import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb } from '@mas/db'
import {
  bindSessionRelationshipCounterpartHandler,
  getSessionRelationshipCounterpartHandler,
  unbindSessionRelationshipCounterpartHandler,
} from './[id]/relationship-counterpart/handler'

function bootstrapDb(dbPath: string) {
  resetDb()
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
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE relationship_counterparts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE session_relationship_bindings (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      counterpart_id TEXT NOT NULL REFERENCES relationship_counterparts(id),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model) VALUES ('agent-1', 'Hazel', 'deepseek-chat');
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-2',
      'Orion',
      'deepseek-chat',
      '{"relationship":{"scheme":"named-multi-dim"}}'
    );
    INSERT INTO sessions (id, agent_id, title) VALUES ('session-a', 'agent-1', 'A');
    INSERT INTO sessions (id, agent_id, title) VALUES ('session-b', 'agent-2', 'B');
    INSERT INTO relationship_counterparts (id, agent_id, name) VALUES ('cp-1', 'agent-2', '张三');
    INSERT INTO relationship_counterparts (id, agent_id, name) VALUES ('cp-2', 'agent-2', '李四');
  `)
}

test('session relationship counterpart handler binds, reads, and unbinds counterpart for a named-multi-dim session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-session-relationship-api-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const empty = getSessionRelationshipCounterpartHandler('session-b')
    assert.equal(empty.status, 200)
    assert.deepEqual(await empty.json(), {
      sessionId: 'session-b',
      counterpart: null,
    })

    const bound = bindSessionRelationshipCounterpartHandler('session-b', { counterpartId: 'cp-1' })
    assert.equal(bound.status, 200)
    assert.deepEqual(await bound.json(), {
      sessionId: 'session-b',
      counterpart: {
        id: 'cp-1',
        name: '张三',
      },
    })

    const read = getSessionRelationshipCounterpartHandler('session-b')
    assert.deepEqual(await read.json(), {
      sessionId: 'session-b',
      counterpart: {
        id: 'cp-1',
        name: '张三',
      },
    })

    const unbound = unbindSessionRelationshipCounterpartHandler('session-b')
    assert.equal(unbound.status, 200)
    assert.deepEqual(await unbound.json(), {
      ok: true,
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
