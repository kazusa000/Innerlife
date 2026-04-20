import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getDb,
  getMemoryDb,
  getRawSqlite,
  memoryRepo,
  resetDb,
  resetMemoryDb,
} from '@mas/db'
import { MemorySqliteSystem } from './sqlite'
import type { TurnContext } from '../types'

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

function createEmbedder(map: Record<string, number[]>) {
  return {
    async embed(input: string[]) {
      return input.map((item) => map[item] ?? [0, 0])
    },
  }
}

test('memory sqlite system prepares embedding retrieval and injects display summaries after retrieval', { concurrency: false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-system-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const catMemory = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: '用户说自己的猫叫橘子',
      displaySummary: '用户养了一只叫橘子的猫',
      retrievalText: '用户曾告诉我，他养了一只名叫橘子的猫',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['猫', '橘子', '宠物'],
      importance: 0.95,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: '用户说自己晚上更有空',
      displaySummary: '用户喜欢晚上聊天',
      retrievalText: '用户平时更喜欢在夜里找我聊天',
      retrievalEmbedding: [0, 1],
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['晚上', '聊天'],
      importance: 0.3,
      createdAt: new Date('2026-04-17T11:00:00.000Z'),
    })

    const system = new MemorySqliteSystem({
      retrieveTopK: 5,
      embeddingModel: 'qwen/qwen3-embedding-0.6b',
      embedder: createEmbedder({
        我猫叫什么: [1, 0],
        用户告诉过我的猫叫什么名字: [1, 0],
      }),
    })
    const ctx = createContext('我猫叫什么')

    await system.beforeTurn?.(ctx)
    assert.equal(ctx.pendingMemoryQuery?.kind, 'sqlite')
    assert.match(ctx.pendingMemoryQuery?.prompt ?? '', /retrieval_query/i)

    const retrieved = await ctx.pendingMemoryQuery?.retrieve({
      retrievalQuery: '用户告诉过我的猫叫什么名字',
      timeRange: null,
      focus: '猫的名字',
    })

    ctx.state.memories = retrieved ?? []
    await system.beforeLLM?.(ctx)

    const loaded = ctx.state.memories as Array<{ id: string; displaySummary: string }>
    assert.deepEqual(loaded.map((memory) => memory.id), [catMemory.id])
    assert.equal(ctx.promptFragments[0]?.priority, 30)
    assert.match(ctx.promptFragments[0]?.content ?? '', /以下是本轮回复可直接依赖的相关记忆/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /可用的回忆/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /不要再声称自己记不住/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /橘子的猫/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory sqlite system prepares a pending write with display_summary and retrieval_text', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    summarizeModel: 'memory-model',
    embedder: createEmbedder({}),
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
  assert.match(ctx.pendingMemoryWrite?.prompt ?? '', /display_summary/i)
  assert.match(ctx.pendingMemoryWrite?.prompt ?? '', /retrieval_text/i)
  assert.match(ctx.pendingMemoryWrite?.prompt ?? '', /自然语言完整描述可检索的事实/)
})

test('memory sqlite system uses memory model override for retrieval queries too', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    summarizeModel: 'memory-model',
    embedder: createEmbedder({}),
  })
  const ctx = createContext('昨天发生了什么')

  await system.beforeTurn?.(ctx)

  assert.equal(ctx.pendingMemoryQuery?.kind, 'sqlite')
  assert.equal(ctx.pendingMemoryQuery?.model, 'memory-model')
  assert.match(ctx.pendingMemoryQuery?.prompt ?? '', /retrieval_query/i)
  assert.match(ctx.pendingMemoryQuery?.prompt ?? '', /语义检索查询/)
})

test('memory sqlite system parses and persists display summary plus retrieval text', { concurrency: false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-system-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const system = new MemorySqliteSystem({
      summarizeModel: 'memory-model',
      embeddingModel: 'qwen/qwen3-embedding-0.6b',
      embedder: createEmbedder({
        用户告诉过我他的名字是王家骏: [0.2, 0.8],
      }),
    })
    const ctx = createContext('我叫王家骏')
    ctx.response = {
      content: [{ type: 'text', text: '记住了，你叫王家骏。' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 12, outputTokens: 9 },
    }

    await system.afterTurn?.(ctx)

    const parsed = ctx.pendingMemoryWrite?.parse(JSON.stringify({
      display_summary: '用户叫王家骏',
      retrieval_text: '用户告诉过我他的名字是王家骏',
      tags: ['名字', '称呼', '身份', '王家骏'],
      importance: 0.9,
    }))

    assert.deepEqual(parsed, {
      displaySummary: '用户叫王家骏',
      retrievalText: '用户告诉过我他的名字是王家骏',
      tags: ['名字', '称呼', '身份', '王家骏'],
      importance: 0.9,
    })

    await ctx.pendingMemoryWrite?.persist(parsed!)

    const stored = memoryRepo.listMemoriesByAgent('agent-1')
    assert.equal(stored.length, 1)
    assert.equal(stored[0]?.displaySummary, '用户叫王家骏')
    assert.equal(stored[0]?.retrievalText, '用户告诉过我他的名字是王家骏')
    assert.deepEqual(stored[0]?.retrievalEmbedding, [0.2, 0.8])
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory sqlite query parse returns retrieval query, optional time range, and optional focus', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('你刚刚在干嘛')

  await system.beforeTurn?.(ctx)

  const parsed = ctx.pendingMemoryQuery?.parse(JSON.stringify({
    retrieval_query: '刚才和用户之间发生的互动',
    time_range: {
      start: '2026-04-20T13:55:00+02:00',
      end: '2026-04-20T14:00:00+02:00',
    },
    focus: '刚才在做什么',
  }))

  assert.deepEqual(parsed, {
    retrievalQuery: '刚才和用户之间发生的互动',
    timeRange: {
      start: new Date('2026-04-20T13:55:00+02:00'),
      end: new Date('2026-04-20T14:00:00+02:00'),
    },
    focus: '刚才在做什么',
  })
})
