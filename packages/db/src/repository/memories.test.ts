import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { getMemoryDb, getMemoryRawSqlite, resetMemoryDb } from '../memory-client'
import * as memoryRepo from './memories'
import {
  addMemory,
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
      layer TEXT NOT NULL DEFAULT 'short_term',
      source_text TEXT NOT NULL,
      display_summary TEXT NOT NULL,
      retrieval_text TEXT NOT NULL,
      retrieval_embedding TEXT NOT NULL,
      retrieval_model TEXT NOT NULL,
      tags TEXT NOT NULL,
      importance REAL NOT NULL,
      observed_start_at INTEGER,
      observed_end_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX idx_memories_agent_created_at ON memories(agent_id, created_at);
    CREATE INDEX idx_memories_agent_id ON memories(agent_id);
  `)
}

function vector(values: number[]) {
  return values
}

test('memory db bootstrap adds observed range columns to an existing memories table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    const sqlite = new Database(dbPath)
    sqlite.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        layer TEXT NOT NULL DEFAULT 'short_term',
        source_text TEXT NOT NULL,
        display_summary TEXT NOT NULL,
        retrieval_text TEXT NOT NULL,
        retrieval_embedding TEXT NOT NULL,
        retrieval_model TEXT NOT NULL,
        tags TEXT NOT NULL,
        importance REAL NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
      );
    `)
    sqlite.close()

    process.env.MAS_MEMORY_DB_PATH = dbPath
    resetMemoryDb()
    getMemoryDb(dbPath)

    const columns = getMemoryRawSqlite().prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>
    assert.ok(columns.some((column) => column.name === 'observed_start_at'))
    assert.ok(columns.some((column) => column.name === 'observed_end_at'))
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('addMemory persists nullable observed time ranges', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const memory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User talked about dinner yesterday.',
      displaySummary: '用户昨晚吃了番茄鸡蛋面',
      retrievalText: '用户昨晚吃了番茄鸡蛋面。',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['晚饭'],
      importance: 0.6,
      createdAt: new Date('2026-04-20T09:00:00.000Z'),
      observedStartAt: new Date('2026-04-19T18:00:00.000Z'),
      observedEndAt: new Date('2026-04-19T18:20:00.000Z'),
    })

    assert.equal(memory.observedStartAt?.toISOString(), '2026-04-19T18:00:00.000Z')
    assert.equal(memory.observedEndAt?.toISOString(), '2026-04-19T18:20:00.000Z')
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

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
    assert.equal(results[0]?.layer, 'short_term')
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findRelevantMemories supports weighted query embeddings for reranking', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const catMemory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User said they raised a cat named Pumpkin.',
      displaySummary: '用户养过一只叫南瓜的猫',
      retrievalText: '用户养过一只名叫南瓜的猫',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['猫'],
      importance: 0.7,
      createdAt: new Date('2026-04-18T10:00:00.000Z'),
    })
    const distractorMemory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User solved a login bug.',
      displaySummary: '用户修复过登录 bug',
      retrievalText: '用户修复过一个登录 bug',
      retrievalEmbedding: vector([0.6, 0.8]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['bug'],
      importance: 0.9,
      createdAt: new Date('2026-04-18T10:00:00.000Z'),
    })

    const results = findRelevantMemories({
      agentId: 'agent-1',
      queryEmbeddings: [vector([1, 0]), vector([0, 1])],
      queryWeights: [0.8, 0.2],
      topK: 5,
    })

    assert.deepEqual(results.map((memory) => memory.id), [catMemory.id, distractorMemory.id])
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
      observedStartAt: new Date('2026-04-20T13:58:00.000Z'),
      observedEndAt: new Date('2026-04-20T13:58:00.000Z'),
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

test('findRelevantMemories uses short-term observed range overlap for time filtering', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const observedInsideRange = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'User described yesterday dinner in a context flush.',
      displaySummary: '用户昨晚吃了番茄鸡蛋面',
      retrievalText: '用户昨晚晚饭吃了番茄鸡蛋面。',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['晚饭'],
      importance: 0.6,
      createdAt: new Date('2026-04-20T09:00:00.000Z'),
      observedStartAt: new Date('2026-04-19T18:00:00.000Z'),
      observedEndAt: new Date('2026-04-19T18:30:00.000Z'),
    })
    addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'Old short-term memory without observed range.',
      displaySummary: '用户昨天聊了工作',
      retrievalText: '用户昨天聊了工作。',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['工作'],
      importance: 0.9,
      createdAt: new Date('2026-04-19T18:10:00.000Z'),
    })

    const results = findRelevantMemories({
      agentId: 'agent-1',
      queryEmbeddings: [],
      topK: 5,
      layers: ['short_term'],
      timeRange: {
        start: new Date('2026-04-19T18:15:00.000Z'),
        end: new Date('2026-04-19T18:45:00.000Z'),
      },
    })

    assert.deepEqual(results.map((memory) => memory.id), [observedInsideRange.id])
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findRelevantMemories keeps fixed time filtering on createdAt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const fixedMemory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'fixed',
      sourceText: 'User prefers local databases.',
      displaySummary: '用户偏好本地数据库',
      retrievalText: '用户偏好使用本地 sqlite 数据库。',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['数据库'],
      importance: 0.9,
      createdAt: new Date('2026-04-19T18:10:00.000Z'),
      observedStartAt: new Date('2026-04-18T18:10:00.000Z'),
      observedEndAt: new Date('2026-04-18T18:20:00.000Z'),
    })

    const results = findRelevantMemories({
      agentId: 'agent-1',
      queryEmbeddings: [],
      topK: 5,
      layers: ['fixed'],
      timeRange: {
        start: new Date('2026-04-19T18:00:00.000Z'),
        end: new Date('2026-04-19T18:30:00.000Z'),
      },
    })

    assert.deepEqual(results.map((memory) => memory.id), [fixedMemory.id])
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
      observedStartAt: new Date('2026-04-19T18:30:00.000Z'),
      observedEndAt: new Date('2026-04-19T18:30:00.000Z'),
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

test('findRelevantMemories supports per-call semantic similarity thresholds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const aboveThreshold = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User likes late-night coding sessions.',
      displaySummary: '用户喜欢深夜写代码',
      retrievalText: '用户喜欢在深夜写代码',
      retrievalEmbedding: vector([0.61, Math.sqrt(1 - 0.61 ** 2)]),
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['代码', '深夜'],
      importance: 0.7,
      createdAt: new Date('2026-04-20T21:00:00.000Z'),
    })
    const belowThreshold = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User had soup for dinner.',
      displaySummary: '用户晚饭喝了汤',
      retrievalText: '用户晚饭喝了汤',
      retrievalEmbedding: vector([0.59, Math.sqrt(1 - 0.59 ** 2)]),
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['晚饭'],
      importance: 0.9,
      createdAt: new Date('2026-04-20T22:00:00.000Z'),
    })

    const strictResults = findRelevantMemories({
      agentId: 'agent-1',
      queryEmbeddings: [vector([1, 0])],
      topK: 5,
      minSimilarity: 0.65,
    })

    const mediumResults = findRelevantMemories({
      agentId: 'agent-1',
      queryEmbeddings: [vector([1, 0])],
      topK: 5,
      minSimilarity: 0.6,
    })

    const relaxedResults = findRelevantMemories({
      agentId: 'agent-1',
      queryEmbeddings: [vector([1, 0])],
      topK: 5,
      minSimilarity: 0.55,
    })

    assert.deepEqual(strictResults.map((memory) => memory.id), [])
    assert.deepEqual(mediumResults.map((memory) => memory.id), [aboveThreshold.id])
    assert.deepEqual(relaxedResults.map((memory) => memory.id), [aboveThreshold.id, belowThreshold.id])
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
      observedStartAt: new Date('2026-04-20T23:35:00.000Z'),
      observedEndAt: new Date('2026-04-20T23:35:00.000Z'),
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
      observedStartAt: new Date('2026-04-20T23:42:18.000Z'),
      observedEndAt: new Date('2026-04-20T23:42:18.000Z'),
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


test('sqlite management query lists latest first and filters by display summary or retrieval text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const latest = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-2',
      sourceText: 'User schedules deep work after midnight.',
      displaySummary: '用户习惯午夜后进入深度工作',
      retrievalText: '用户会在午夜后开始 deep work',
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
    const retrievalHits = memoryRepo.listSqliteMemoriesByAgent?.('agent-1', 'deep work') ?? []

    assert.deepEqual(listed.map((memory) => memory.id), [latest.id, older.id])
    assert.deepEqual(summaryHits.map((memory) => memory.id), [older.id])
    assert.deepEqual(retrievalHits.map((memory) => memory.id), [latest.id])
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

test('deleteMemoriesByAgent returns count and removes only the target agent memories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const first = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User prefers local databases.',
      displaySummary: '用户偏好本地数据库',
      retrievalText: '用户偏好本地 sqlite 数据库',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['database'],
      importance: 0.7,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    const second = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User prefers late work.',
      displaySummary: '用户偏好深夜工作',
      retrievalText: '用户偏好深夜工作',
      retrievalEmbedding: vector([0.8, 0.2]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['night'],
      importance: 0.6,
      createdAt: new Date('2026-04-17T11:00:00.000Z'),
    })
    const foreign = addMemory({
      agentId: 'agent-2',
      sessionId: 'session-3',
      sourceText: 'Another agent memory.',
      displaySummary: '另一个 agent 的记忆',
      retrievalText: '另一个虚拟人的记忆',
      retrievalEmbedding: vector([0.8, 0.2]),
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['foreign'],
      importance: 0.5,
      createdAt: new Date('2026-04-17T12:00:00.000Z'),
    })

    const deletedCount = memoryRepo.deleteMemoriesByAgent('agent-1')

    assert.equal(deletedCount, 2)
    assert.equal(memoryRepo.getMemory(first.id), undefined)
    assert.equal(memoryRepo.getMemory(second.id), undefined)
    assert.ok(memoryRepo.getMemory(foreign.id))
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateSqliteMemoryLayer changes only the targeted memory layer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memories-repo-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrapMemoryDb(dbPath)

    const target = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User stores a local preference.',
      displaySummary: '用户偏好使用本地数据库',
      retrievalText: '用户偏好本地 sqlite 数据库',
      retrievalEmbedding: vector([1, 0]),
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['database', 'sqlite'],
      importance: 0.7,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    const untouched = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: 'User stores another preference.',
      displaySummary: '用户偏好深夜工作',
      retrievalText: '用户经常深夜工作',
      retrievalEmbedding: vector([0.8, 0.2]),
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['night'],
      importance: 0.5,
      createdAt: new Date('2026-04-17T11:00:00.000Z'),
    })

    const updated = memoryRepo.updateSqliteMemoryLayerByAgent?.('agent-1', target.id, 'fixed')

    assert.equal(updated, true)
    assert.equal(memoryRepo.getMemory(target.id)?.layer, 'fixed')
    assert.equal(memoryRepo.getMemory(untouched.id)?.layer, 'short_term')
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
