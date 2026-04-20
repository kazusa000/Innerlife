import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, memoryRepo, resetDb } from '@mas/db'
import { deleteSqliteMemory } from './[memoryId]/handler'
import { listSqliteMemories } from './handler'

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
    INSERT INTO agents (id, name, model, modules)
    VALUES ('agent-1', 'Agent One', 'claude-sonnet-4-6', '{"memory":{"scheme":"sqlite","summarizeModel":"memory-model"}}');
    INSERT INTO agents (id, name, model, modules)
    VALUES ('agent-2', 'Agent Two', 'claude-sonnet-4-6', '{"memory":{"scheme":"noop"}}');
    INSERT INTO sessions (id, agent_id) VALUES ('session-1', 'agent-1');
    INSERT INTO sessions (id, agent_id) VALUES ('session-2', 'agent-1');
    INSERT INTO sessions (id, agent_id) VALUES ('session-3', 'agent-2');
  `)
}

function addMemory(input: {
  agentId: string
  sessionId: string
  summary: string
  tags: string[]
  createdAt: string
}) {
  return memoryRepo.addMemory({
    agentId: input.agentId,
    sessionId: input.sessionId,
    content: input.summary,
    summary: input.summary,
    tags: input.tags,
    importance: 0.6,
    createdAt: new Date(input.createdAt),
  })
}

test('listSqliteMemories returns 404 when the agent does not exist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = listSqliteMemories('missing-agent')

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Not found' })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listSqliteMemories returns 400 when the agent memory scheme is not sqlite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = listSqliteMemories('agent-2')

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'Agent memory scheme must be sqlite' })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listSqliteMemories returns latest-first rows and filters by summary or tags', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const latest = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-2',
      summary: '用户偏好午夜后编码',
      tags: ['night', 'coding'],
      createdAt: '2026-04-18T02:00:00.000Z',
    })
    const older = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '用户希望被称为 WJJ',
      tags: ['name'],
      createdAt: '2026-04-17T09:00:00.000Z',
    })
    addMemory({
      agentId: 'agent-2',
      sessionId: 'session-3',
      summary: '别的 agent 的午夜习惯',
      tags: ['night'],
      createdAt: '2026-04-18T03:00:00.000Z',
    })

    const listResponse = listSqliteMemories('agent-1')
    const summaryResponse = listSqliteMemories('agent-1', 'WJJ')
    const tagResponse = listSqliteMemories('agent-1', 'night')

    assert.equal(listResponse.status, 200)
    assert.deepEqual((await listResponse.json()).memories.map((memory: { id: string }) => memory.id), [latest.id, older.id])
    assert.deepEqual((await summaryResponse.json()).memories.map((memory: { id: string }) => memory.id), [older.id])
    assert.deepEqual((await tagResponse.json()).memories.map((memory: { id: string }) => memory.id), [latest.id])
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleteSqliteMemory removes only memories owned by the given agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const ownMemory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '用户偏好 sqlite 记忆',
      tags: ['sqlite'],
      createdAt: '2026-04-17T10:00:00.000Z',
    })
    const foreignMemory = addMemory({
      agentId: 'agent-2',
      sessionId: 'session-3',
      summary: '别的 agent 的记忆',
      tags: ['foreign'],
      createdAt: '2026-04-17T11:00:00.000Z',
    })

    const deleted = deleteSqliteMemory('agent-1', ownMemory.id)
    const blocked = deleteSqliteMemory('agent-1', foreignMemory.id)

    assert.equal(deleted.status, 200)
    assert.deepEqual(await deleted.json(), { ok: true })
    assert.equal(blocked.status, 404)
    assert.deepEqual(await blocked.json(), { error: 'Memory not found' })
    assert.equal(memoryRepo.getMemory(ownMemory.id), undefined)
    assert.ok(memoryRepo.getMemory(foreignMemory.id))
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
