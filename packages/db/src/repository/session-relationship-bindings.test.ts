import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb } from '../client'
import {
  bindSessionRelationshipCounterpart,
  getSessionRelationshipBinding,
  unbindSessionRelationshipCounterpart,
} from './session-relationship-bindings'

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
    INSERT INTO sessions (id, agent_id, title) VALUES ('session-a', 'agent-1', 'A');
    INSERT INTO sessions (id, agent_id, title) VALUES ('session-b', 'agent-1', 'B');
    INSERT INTO relationship_counterparts (id, agent_id, name) VALUES ('cp-1', 'agent-1', '张三');
    INSERT INTO relationship_counterparts (id, agent_id, name) VALUES ('cp-2', 'agent-1', '李四');
  `)
}

test('session relationship binding repo binds, rebinds, and unbinds a counterpart per session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-session-relationship-binding-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    assert.equal(getSessionRelationshipBinding('session-a'), undefined)

    const bound = bindSessionRelationshipCounterpart({
      sessionId: 'session-a',
      counterpartId: 'cp-1',
    })
    assert.equal(bound?.counterpartId, 'cp-1')

    const rebound = bindSessionRelationshipCounterpart({
      sessionId: 'session-a',
      counterpartId: 'cp-2',
    })
    assert.equal(rebound?.counterpartId, 'cp-2')
    assert.equal(getSessionRelationshipBinding('session-a')?.counterpartId, 'cp-2')

    bindSessionRelationshipCounterpart({
      sessionId: 'session-b',
      counterpartId: 'cp-1',
    })
    assert.equal(getSessionRelationshipBinding('session-b')?.counterpartId, 'cp-1')

    unbindSessionRelationshipCounterpart('session-a')
    assert.equal(getSessionRelationshipBinding('session-a'), undefined)
    assert.equal(getSessionRelationshipBinding('session-b')?.counterpartId, 'cp-1')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
