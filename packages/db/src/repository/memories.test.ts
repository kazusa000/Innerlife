import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb } from '../client'
import { addMemory, findRelevantMemories } from './memories'

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
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      tags TEXT NOT NULL,
      importance REAL NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX idx_memories_agent_created_at ON memories(agent_id, created_at);
    CREATE INDEX idx_memories_agent_id ON memories(agent_id);
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model) VALUES ('agent-1', 'Agent One', 'claude-sonnet-4-6');
    INSERT INTO agents (id, name, model) VALUES ('agent-2', 'Agent Two', 'claude-sonnet-4-6');
    INSERT INTO sessions (id, agent_id) VALUES ('session-1', 'agent-1');
    INSERT INTO sessions (id, agent_id) VALUES ('session-2', 'agent-1');
    INSERT INTO sessions (id, agent_id) VALUES ('session-3', 'agent-2');
  `)
}

test('findRelevantMemories scopes by agent and orders by importance then recency', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const olderHigh = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: 'User said their cat is named Orange.',
      summary: '用户养了一只叫橘子的猫',
      tags: ['cat', 'orange', 'pet'],
      importance: 0.9,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    const newerMedium = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-2',
      content: 'User prefers late-night chats.',
      summary: '用户喜欢晚上聊天',
      tags: ['chat', 'night'],
      importance: 0.5,
      createdAt: new Date('2026-04-18T10:00:00.000Z'),
    })
    addMemory({
      agentId: 'agent-2',
      sessionId: 'session-3',
      content: 'Other agent memory.',
      summary: '另一个 agent 也提到橘子',
      tags: ['cat', 'orange'],
      importance: 1,
      createdAt: new Date('2026-04-18T12:00:00.000Z'),
    })

    const results = findRelevantMemories({
      agentId: 'agent-1',
      terms: ['orange', 'chat'],
      topK: 5,
    })

    assert.deepEqual(results.map((memory) => memory.id), [olderHigh.id, newerMedium.id])
    assert.deepEqual(results[0]?.tags, ['cat', 'orange', 'pet'])
    assert.equal(results[1]?.summary, '用户喜欢晚上聊天')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
