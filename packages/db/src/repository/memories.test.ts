import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb } from '../client'
import * as memoryRepo from './memories'
import {
  addMemory,
  applyConsolidationPlan,
  findRelevantMemories,
  listMemoriesByAgentOldestFirst,
} from './memories'

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

test('findRelevantMemories matches bilingual tags from both Chinese and English input terms', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const memory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: 'User introduced their name as 王家骏.',
      summary: '用户叫王家骏',
      tags: ['名字', 'name', '称呼', 'introduction'],
      importance: 0.95,
      createdAt: new Date('2026-04-18T10:00:00.000Z'),
    })

    const chineseResults = findRelevantMemories({
      agentId: 'agent-1',
      terms: ['名字'],
      topK: 5,
    })
    const englishResults = findRelevantMemories({
      agentId: 'agent-1',
      terms: ['name'],
      topK: 5,
    })

    assert.deepEqual(chineseResults.map((entry) => entry.id), [memory.id])
    assert.deepEqual(englishResults.map((entry) => entry.id), [memory.id])
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyConsolidationPlan keeps, rewrites, and merges memories in one transaction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const keepMemory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: 'User said their cat is named Orange.',
      summary: '用户养了一只叫橘子的猫',
      tags: ['猫', 'cat', '橘子', 'orange'],
      importance: 0.9,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    const rewriteMemory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: 'User said they prefer late-night chats.',
      summary: '用户喜欢晚上聊天',
      tags: ['晚上', 'night'],
      importance: 0.4,
      createdAt: new Date('2026-04-17T11:00:00.000Z'),
    })
    const mergeSourceA = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: 'User said they live in Brussels.',
      summary: '用户住在布鲁塞尔',
      tags: ['布鲁塞尔', 'brussels'],
      importance: 0.5,
      createdAt: new Date('2026-04-17T12:00:00.000Z'),
    })
    const mergeSourceB = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-2',
      content: 'User said they are based in Belgium.',
      summary: '用户住在比利时布鲁塞尔',
      tags: ['比利时', 'belgium', '布鲁塞尔', 'brussels'],
      importance: 0.6,
      createdAt: new Date('2026-04-17T13:00:00.000Z'),
    })

    const report = applyConsolidationPlan({
      agentId: 'agent-1',
      actions: [
        { op: 'keep', id: keepMemory.id },
        {
          op: 'rewrite',
          id: rewriteMemory.id,
          summary: '用户偏好夜间聊天',
          tags: ['夜间', 'night', '聊天', 'chat'],
          importance: 0.65,
        },
        {
          op: 'merge',
          sourceIds: [mergeSourceA.id, mergeSourceB.id],
          summary: '用户住在比利时布鲁塞尔',
          tags: ['布鲁塞尔', 'brussels', '比利时', 'belgium', '住处', 'location'],
          importance: 0.8,
        },
      ],
    })

    const rows = listMemoriesByAgentOldestFirst('agent-1')
    const rewritten = rows.find((memory) => memory.id === rewriteMemory.id)
    const merged = rows.find((memory) =>
      ![keepMemory.id, rewriteMemory.id, mergeSourceA.id, mergeSourceB.id].includes(memory.id),
    )

    assert.deepEqual(report, {
      before: 4,
      after: 3,
      kept: 1,
      rewritten: 1,
      merged: 1,
    })
    assert.equal(rows.length, 3)
    assert.equal(rewritten?.summary, '用户偏好夜间聊天')
    assert.deepEqual(rewritten?.tags, ['夜间', 'night', '聊天', 'chat'])
    assert.equal(rewritten?.importance, 0.65)
    assert.equal(rewritten?.createdAt.toISOString(), '2026-04-17T11:00:00.000Z')
    assert.ok(merged)
    assert.equal(merged?.sessionId, 'session-1')
    assert.equal(merged?.createdAt.toISOString(), '2026-04-17T12:00:00.000Z')
    assert.equal(merged?.summary, '用户住在比利时布鲁塞尔')
    assert.deepEqual(merged?.tags, ['布鲁塞尔', 'brussels', '比利时', 'belgium', '住处', 'location'])
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyConsolidationPlan rolls back earlier writes when a later action is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const first = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: 'User likes tea.',
      summary: '用户喜欢喝茶',
      tags: ['茶', 'tea'],
      importance: 0.3,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    const second = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: 'User likes coffee.',
      summary: '用户也喜欢咖啡',
      tags: ['咖啡', 'coffee'],
      importance: 0.4,
      createdAt: new Date('2026-04-17T11:00:00.000Z'),
    })

    assert.throws(() => {
      applyConsolidationPlan({
        agentId: 'agent-1',
        actions: [
          {
            op: 'rewrite',
            id: first.id,
            summary: '用户喜欢热茶',
            tags: ['热茶', 'tea'],
            importance: 0.7,
          },
          {
            op: 'merge',
            sourceIds: [second.id, 'missing-memory'],
            summary: '用户喜欢热饮',
            tags: ['热饮', 'drink'],
            importance: 0.8,
          },
        ],
      })
    }, /missing-memory/)

    const rows = listMemoriesByAgentOldestFirst('agent-1')
    assert.equal(rows.length, 2)
    assert.equal(rows[0]?.summary, '用户喜欢喝茶')
    assert.deepEqual(rows[0]?.tags, ['茶', 'tea'])
    assert.equal(rows[1]?.summary, '用户也喜欢咖啡')
    assert.deepEqual(rows[1]?.tags, ['咖啡', 'coffee'])
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sqlite management query lists latest first and filters by summary or tags', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const latest = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-2',
      content: 'User schedules deep work after midnight.',
      summary: '用户习惯午夜后进入深度工作',
      tags: ['night', 'midnight', 'coding'],
      importance: 0.8,
      createdAt: new Date('2026-04-18T01:00:00.000Z'),
    })
    const older = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: 'User asks to be called WJJ.',
      summary: '用户偏好被叫作 WJJ',
      tags: ['name', 'nickname'],
      importance: 0.4,
      createdAt: new Date('2026-04-17T09:00:00.000Z'),
    })
    addMemory({
      agentId: 'agent-2',
      sessionId: 'session-3',
      content: 'Other agent works late too.',
      summary: '另一个 agent 也会深夜工作',
      tags: ['night'],
      importance: 0.9,
      createdAt: new Date('2026-04-18T02:00:00.000Z'),
    })

    assert.equal(typeof memoryRepo.listSqliteMemoriesByAgent, 'function')

    const listed = memoryRepo.listSqliteMemoriesByAgent?.('agent-1') ?? []
    const summaryHits = memoryRepo.listSqliteMemoriesByAgent?.('agent-1', 'WJJ') ?? []
    const tagHits = memoryRepo.listSqliteMemoriesByAgent?.('agent-1', 'midnight') ?? []

    assert.deepEqual(listed.map((memory) => memory.id), [latest.id, older.id])
    assert.deepEqual(summaryHits.map((memory) => memory.id), [older.id])
    assert.deepEqual(tagHits.map((memory) => memory.id), [latest.id])
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleteSqliteMemory removes only memories owned by the given agent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const ownMemory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: 'User stores a local preference.',
      summary: '用户偏好使用本地数据库',
      tags: ['database', 'sqlite'],
      importance: 0.7,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    const foreignMemory = addMemory({
      agentId: 'agent-2',
      sessionId: 'session-3',
      content: 'Another agent memory.',
      summary: '另一个 agent 的记忆',
      tags: ['foreign'],
      importance: 0.5,
      createdAt: new Date('2026-04-17T11:00:00.000Z'),
    })

    assert.equal(typeof memoryRepo.deleteSqliteMemoryByAgent, 'function')

    const deleted = memoryRepo.deleteSqliteMemoryByAgent?.('agent-1', ownMemory.id)
    const blocked = memoryRepo.deleteSqliteMemoryByAgent?.('agent-1', foreignMemory.id)

    assert.equal(deleted, true)
    assert.equal(blocked, false)
    assert.equal(memoryRepo.getMemory(ownMemory.id), undefined)
    assert.ok(memoryRepo.getMemory(foreignMemory.id))
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
