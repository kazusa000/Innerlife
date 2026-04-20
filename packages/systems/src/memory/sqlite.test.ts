import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, memoryRepo, resetDb } from '@mas/db'
import { MemorySqliteSystem } from './sqlite'
import type { TurnContext } from '../types'

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

function createContext(text: string): TurnContext {
  return {
    agentId: 'agent-1',
    sessionId: 'session-2',
    userId: 'user-1',
    input: {
      raw: text,
      text,
      modality: 'text',
    },
    state: {},
    turnMetadata: {},
    promptFragments: [],
    messages: [],
  }
}

test('memory sqlite system prepares a pending retrieval query in beforeTurn and injects prompt fragments after retrieval', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-system-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const catMemory = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: '用户说自己的猫叫橘子',
      summary: '用户养了一只叫橘子的猫',
      tags: ['猫', '橘子', '宠物'],
      importance: 0.95,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: '用户说自己晚上更有空',
      summary: '用户喜欢晚上聊天',
      tags: ['晚上', '聊天'],
      importance: 0.3,
      createdAt: new Date('2026-04-17T11:00:00.000Z'),
    })
    memoryRepo.addMemory({
      agentId: 'agent-2',
      sessionId: 'session-3',
      content: '其他 agent 的记忆',
      summary: '另一个 agent 也有一只猫',
      tags: ['猫'],
      importance: 1,
      createdAt: new Date('2026-04-17T12:00:00.000Z'),
    })

    const system = new MemorySqliteSystem({
      retrieveTopK: 5,
      minTermLength: 2,
    })
    const ctx = createContext('我猫叫什么')

    await system.beforeTurn?.(ctx)
    assert.equal(ctx.pendingMemoryQuery?.kind, 'sqlite')
    assert.match(ctx.pendingMemoryQuery?.prompt ?? '', /JSON/i)
    assert.deepEqual(ctx.state.memories, undefined)

    const retrieved = await ctx.pendingMemoryQuery?.retrieve({
      keywords: ['猫'],
      timeRange: null,
    })
    ctx.state.memories = retrieved ?? []
    ctx.state.memoryRetrievalKeywords = ['猫']
    await system.beforeLLM?.(ctx)

    const loaded = ctx.state.memories as Array<{ id: string; summary: string }>
    assert.deepEqual(loaded.map((memory) => memory.id), [catMemory.id])
    assert.equal(ctx.promptFragments[0]?.priority, 30)
    assert.match(ctx.promptFragments[0]?.content ?? '', /Relevant memories/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /橘子的猫/)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory sqlite system prepares a pending write after turn', async () => {
  const system = new MemorySqliteSystem({
    summarizeModel: 'memory-model',
  })
  const ctx = createContext('我猫叫橘子')
  ctx.response = {
    content: [{ type: 'text', text: '记住了，你的猫叫橘子。' }],
    stopReason: 'end_turn',
    usage: { inputTokens: 12, outputTokens: 9 },
  }

  await system.afterTurn?.(ctx)

  assert.equal(ctx.pendingMemoryWrite?.kind, 'sqlite')
  assert.equal(ctx.pendingMemoryWrite?.model, 'memory-model')
  assert.match(ctx.pendingMemoryWrite?.prompt ?? '', /strict JSON/i)
  assert.match(ctx.pendingMemoryWrite?.prompt ?? '', /Use the main language of the conversation turn/i)
  assert.doesNotMatch(ctx.pendingMemoryWrite?.prompt ?? '', /Chinese and English/i)
  assert.equal(typeof ctx.pendingMemoryWrite?.persist, 'function')
})

test('memory sqlite system parses and persists mixed bilingual tags from summarize output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-system-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const system = new MemorySqliteSystem({
      summarizeModel: 'memory-model',
    })
    const ctx = createContext('我叫王家骏')
    ctx.response = {
      content: [{ type: 'text', text: '记住了，你叫王家骏。' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 12, outputTokens: 9 },
    }

    await system.afterTurn?.(ctx)

    const parsed = ctx.pendingMemoryWrite?.parse(JSON.stringify({
      summary: '用户叫王家骏',
      tags: ['名字', 'name', '称呼', 'introduction', '王家骏', 'identity'],
      importance: 0.9,
    }))

    assert.deepEqual(parsed, {
      summary: '用户叫王家骏',
      tags: ['名字', 'name', '称呼', 'introduction', '王家骏', 'identity'],
      importance: 0.9,
    })

    await ctx.pendingMemoryWrite?.persist(parsed!)

    const stored = memoryRepo.listMemoriesByAgent('agent-1')
    assert.equal(stored.length, 1)
    assert.deepEqual(stored[0]?.tags, ['名字', 'name', '称呼', 'introduction', '王家骏', 'identity'])
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory sqlite retrieval hits mixed bilingual tags for both Chinese and English inputs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-bilingual-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const memory = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      content: '用户告诉过我他的名字是王家骏',
      summary: '用户名字叫王家骏',
      tags: ['名字', 'name'],
      importance: 0.95,
      createdAt: new Date('2026-04-18T10:00:00.000Z'),
    })

    const system = new MemorySqliteSystem({
      retrieveTopK: 5,
      minTermLength: 2,
    })

    const chineseCtx = createContext('我叫什么名字')
    await system.beforeTurn?.(chineseCtx)
    const chineseHits = await chineseCtx.pendingMemoryQuery?.retrieve(
      {
        keywords: ['名字'],
        timeRange: null,
      },
    )
    assert.deepEqual(chineseHits?.map((item) => item.id), [memory.id])

    const englishCtx = createContext(`what's my name`)
    await system.beforeTurn?.(englishCtx)
    const englishHits = await englishCtx.pendingMemoryQuery?.retrieve(
      {
        keywords: ['name'],
        timeRange: null,
      },
    )
    assert.deepEqual(englishHits?.map((item) => item.id), [memory.id])
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory sqlite query parse returns optional time range for natural-language time intent', async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    minTermLength: 2,
  })
  const ctx = createContext('你刚刚在干嘛')

  await system.beforeTurn?.(ctx)

  const parsed = ctx.pendingMemoryQuery?.parse(JSON.stringify({
    keywords: [],
    time_range: {
      start: '2026-04-20T13:55:00+02:00',
      end: '2026-04-20T14:00:00+02:00',
    },
  }))

  assert.deepEqual(parsed, {
    keywords: [],
    timeRange: {
      start: new Date('2026-04-20T13:55:00+02:00'),
      end: new Date('2026-04-20T14:00:00+02:00'),
    },
  })
})
