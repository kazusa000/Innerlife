import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getMemoryDb, getMemoryRawSqlite, resetMemoryDb } from '../memory-client'
import * as memoryRepo from './memories'
import {
  addMemory,
  applyConsolidationPlan,
  findRelevantMemories,
  listMemoriesByAgentOldestFirst,
} from './memories'

function bootstrapMemoryDb(dbPath: string) {
  process.env.MAS_MEMORY_DB_PATH = dbPath
  resetMemoryDb()
  getMemoryDb(dbPath)
  getMemoryRawSqlite().exec(`
    DROP TABLE IF EXISTS memories;
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      source_text TEXT NOT NULL,
      display_summary TEXT NOT NULL,
      retrieval_text TEXT NOT NULL,
      retrieval_embedding TEXT NOT NULL,
      retrieval_model TEXT NOT NULL,
      tags TEXT NOT NULL,
      importance REAL NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX idx_memories_agent_created_at ON memories(agent_id, created_at);
    CREATE INDEX idx_memories_agent_id ON memories(agent_id);
  `)
}

function vector(values: number[]) {
  return values
}

test('findRelevantMemories scopes by agent and orders by similarity then importance then recency', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const strongest = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User said their cat is named Orange.',
      displaySummary: '用户养了一只叫橘子的猫',
      retrievalText: '用户的宠物猫名字叫橘子',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['猫', '宠物'],
      importance: 0.9,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    const second = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-2',
      sourceText: 'User prefers late-night chats.',
      displaySummary: '用户喜欢深夜聊天',
      retrievalText: '用户常在深夜找我聊天',
      retrievalEmbedding: vector([0.8, 0.2]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['聊天', '深夜'],
      importance: 0.5,
      createdAt: new Date('2026-04-18T10:00:00.000Z'),
    })
    addMemory({
      agentId: 'agent-2',
      sessionId: 'session-3',
      sourceText: 'Other agent memory.',
      displaySummary: '另一个 agent 也提到橘子',
      retrievalText: '另一个虚拟人的猫叫橘子',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['猫'],
      importance: 1,
      createdAt: new Date('2026-04-18T12:00:00.000Z'),
    })

    const results = findRelevantMemories({
      agentId: 'agent-1',
      queryEmbeddings: [vector([1, 0]), vector([0.9, 0.1])],
      topK: 5,
    })

    assert.deepEqual(results.map((memory) => memory.id), [strongest.id, second.id])
    assert.equal(results[0]?.displaySummary, '用户养了一只叫橘子的猫')
    assert.deepEqual(results[0]?.retrievalEmbedding, [1, 0])
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findRelevantMemories supports time range filtering on top of embedding similarity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const insideRange = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User asked what I was doing a moment ago.',
      displaySummary: '我刚才在修 consolidate 按钮反馈问题',
      retrievalText: '最近我在修 sqlite memory 的 consolidate 按钮反馈问题',
      retrievalEmbedding: vector([0.9, 0.1]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['修 bug', 'consolidate'],
      importance: 0.4,
      createdAt: new Date('2026-04-20T13:58:00.000Z'),
    })
    addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'Older unrelated memory.',
      displaySummary: '我上午在看 observer',
      retrievalText: '上午我在看 observer 面板',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['observer'],
      importance: 0.9,
      createdAt: new Date('2026-04-20T10:00:00.000Z'),
    })

    const results = findRelevantMemories({
      agentId: 'agent-1',
      queryEmbeddings: [vector([0.9, 0.1])],
      topK: 5,
      timeRange: {
        start: new Date('2026-04-20T13:55:00.000Z'),
        end: new Date('2026-04-20T14:00:00.000Z'),
      },
    })

    assert.deepEqual(results.map((memory) => memory.id), [insideRange.id])
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findRelevantMemories keeps time-range candidates even when semantic similarity is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const insideRange = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User had tomato egg noodles for dinner yesterday.',
      displaySummary: '用户昨晚吃了番茄鸡蛋面',
      retrievalText: '用户昨晚晚饭吃了番茄鸡蛋面，还放了很多胡椒。',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'openai/text-embedding-3-small',
      tags: ['晚饭', '番茄鸡蛋面'],
      importance: 0.6,
      createdAt: new Date('2026-04-19T18:30:00.000Z'),
    })
    addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User talked about work today.',
      displaySummary: '用户今天聊了工作上的烦心事',
      retrievalText: '用户今天提到被老板批评后有些烦躁。',
      retrievalEmbedding: vector([0, 1]),
      retrievalModel: 'openai/text-embedding-3-small',
      tags: ['工作', '情绪'],
      importance: 0.9,
      createdAt: new Date('2026-04-20T10:00:00.000Z'),
    })

    const results = findRelevantMemories({
      agentId: 'agent-1',
      queryEmbeddings: [vector([0, 1])],
      topK: 5,
      timeRange: {
        start: new Date('2026-04-19T00:00:00.000Z'),
        end: new Date('2026-04-19T23:59:59.000Z'),
      },
    })

    assert.deepEqual(results.map((memory) => memory.id), [insideRange.id])
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findRelevantMemories prefers newest memories for pure time-range recall without semantic query', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const olderButImportant = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User said they love tomato egg noodles.',
      displaySummary: '用户最喜欢番茄鸡蛋面',
      retrievalText: '用户说自己最喜欢吃番茄鸡蛋面。',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['番茄鸡蛋面', '喜好'],
      importance: 0.95,
      createdAt: new Date('2026-04-20T23:35:00.000Z'),
    })
    const newest = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User asked to remember the phrase blue balloon.',
      displaySummary: '用户要求记住“蓝色热气球”这一表述。',
      retrievalText: '用户明确要求记住“蓝色热气球”这句话。',
      retrievalEmbedding: vector([0.5, 0.5]),
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['蓝色热气球', '记忆请求'],
      importance: 0.6,
      createdAt: new Date('2026-04-20T23:42:18.000Z'),
    })

    const results = findRelevantMemories({
      agentId: 'agent-1',
      queryEmbeddings: [],
      topK: 5,
      timeRange: {
        start: new Date('2026-04-20T23:32:00.000Z'),
        end: new Date('2026-04-20T23:43:00.000Z'),
      },
    })

    assert.deepEqual(results.map((memory) => memory.id), [newest.id, olderButImportant.id])
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyConsolidationPlan keeps, rewrites, and merges memories in one transaction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const keepMemory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User said their cat is named Orange.',
      displaySummary: '用户养了一只叫橘子的猫',
      retrievalText: '用户的猫名字叫橘子',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['猫', '橘子'],
      importance: 0.9,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    const rewriteMemory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User said they prefer late-night chats.',
      displaySummary: '用户喜欢晚上聊天',
      retrievalText: '用户更喜欢在夜里找我聊天',
      retrievalEmbedding: vector([0.8, 0.2]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['晚上', '聊天'],
      importance: 0.4,
      createdAt: new Date('2026-04-17T11:00:00.000Z'),
    })
    const mergeSourceA = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User said they live in Brussels.',
      displaySummary: '用户住在布鲁塞尔',
      retrievalText: '用户居住在布鲁塞尔',
      retrievalEmbedding: vector([0.1, 1]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['布鲁塞尔'],
      importance: 0.5,
      createdAt: new Date('2026-04-17T12:00:00.000Z'),
    })
    const mergeSourceB = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-2',
      sourceText: 'User said they are based in Belgium.',
      displaySummary: '用户住在比利时布鲁塞尔',
      retrievalText: '用户常驻比利时布鲁塞尔',
      retrievalEmbedding: vector([0.1, 0.95]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['比利时', '布鲁塞尔'],
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
          displaySummary: '用户偏好夜间聊天',
          retrievalText: '用户通常在夜间找我聊天',
          tags: ['夜间', '聊天'],
          importance: 0.65,
        },
        {
          op: 'merge',
          sourceIds: [mergeSourceA.id, mergeSourceB.id],
          displaySummary: '用户住在比利时布鲁塞尔',
          retrievalText: '用户的长期居住地是比利时布鲁塞尔',
          tags: ['布鲁塞尔', '比利时', '住处'],
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
    assert.equal(rewritten?.displaySummary, '用户偏好夜间聊天')
    assert.equal(rewritten?.retrievalText, '用户通常在夜间找我聊天')
    assert.deepEqual(rewritten?.tags, ['夜间', '聊天'])
    assert.equal(rewritten?.importance, 0.65)
    assert.ok(merged)
    assert.equal(merged?.sessionId, 'session-1')
    assert.equal(merged?.displaySummary, '用户住在比利时布鲁塞尔')
    assert.equal(merged?.retrievalText, '用户的长期居住地是比利时布鲁塞尔')
    assert.deepEqual(merged?.tags, ['布鲁塞尔', '比利时', '住处'])
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyConsolidationPlan rolls back earlier writes when a later action is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const first = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User likes tea.',
      displaySummary: '用户喜欢喝茶',
      retrievalText: '用户平时喜欢喝热茶',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['茶'],
      importance: 0.3,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    const second = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User likes coffee.',
      displaySummary: '用户也喜欢咖啡',
      retrievalText: '用户也会喝咖啡',
      retrievalEmbedding: vector([0.9, 0.1]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['咖啡'],
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
            displaySummary: '用户喜欢热茶',
            retrievalText: '用户更偏好喝热茶',
            tags: ['热茶'],
            importance: 0.7,
          },
          {
            op: 'merge',
            sourceIds: [second.id, 'missing-memory'],
            displaySummary: '用户喜欢热饮',
            retrievalText: '用户偏好各种热饮',
            tags: ['热饮'],
            importance: 0.8,
          },
        ],
      })
    }, /missing-memory/)

    const rows = listMemoriesByAgentOldestFirst('agent-1')
    assert.equal(rows.length, 2)
    assert.equal(rows[0]?.displaySummary, '用户喜欢喝茶')
    assert.equal(rows[0]?.retrievalText, '用户平时喜欢喝热茶')
    assert.equal(rows[1]?.displaySummary, '用户也喜欢咖啡')
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sqlite management query lists latest first and filters by display summary or tags', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const latest = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-2',
      sourceText: 'User schedules deep work after midnight.',
      displaySummary: '用户习惯午夜后进入深度工作',
      retrievalText: '用户会在午夜后开始深度工作',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['midnight', 'coding'],
      importance: 0.8,
      createdAt: new Date('2026-04-18T01:00:00.000Z'),
    })
    const older = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User asks to be called WJJ.',
      displaySummary: '用户偏好被叫作 WJJ',
      retrievalText: '用户希望我叫他 WJJ',
      retrievalEmbedding: vector([0.9, 0.1]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['name', 'nickname'],
      importance: 0.4,
      createdAt: new Date('2026-04-17T09:00:00.000Z'),
    })

    const listed = memoryRepo.listSqliteMemoriesByAgent?.('agent-1') ?? []
    const summaryHits = memoryRepo.listSqliteMemoriesByAgent?.('agent-1', 'WJJ') ?? []
    const tagHits = memoryRepo.listSqliteMemoriesByAgent?.('agent-1', 'midnight') ?? []

    assert.deepEqual(listed.map((memory) => memory.id), [latest.id, older.id])
    assert.deepEqual(summaryHits.map((memory) => memory.id), [older.id])
    assert.deepEqual(tagHits.map((memory) => memory.id), [latest.id])
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleteSqliteMemory removes only memories owned by the given agent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const ownMemory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User stores a local preference.',
      displaySummary: '用户偏好使用本地数据库',
      retrievalText: '用户偏好本地 sqlite 数据库',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['database', 'sqlite'],
      importance: 0.7,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    const foreignMemory = addMemory({
      agentId: 'agent-2',
      sessionId: 'session-3',
      sourceText: 'Another agent memory.',
      displaySummary: '另一个 agent 的记忆',
      retrievalText: '另一个虚拟人的记忆',
      retrievalEmbedding: vector([0.8, 0.2]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['foreign'],
      importance: 0.5,
      createdAt: new Date('2026-04-17T11:00:00.000Z'),
    })

    const deleted = memoryRepo.deleteSqliteMemoryByAgent?.('agent-1', ownMemory.id)
    const blocked = memoryRepo.deleteSqliteMemoryByAgent?.('agent-1', foreignMemory.id)

    assert.equal(deleted, true)
    assert.equal(blocked, false)
    assert.equal(memoryRepo.getMemory(ownMemory.id), undefined)
    assert.ok(memoryRepo.getMemory(foreignMemory.id))
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
