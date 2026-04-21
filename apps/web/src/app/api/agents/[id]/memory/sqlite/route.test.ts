import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { agentRepo, getDb, getMemoryDb, getRawSqlite, memoryRepo, resetDb, resetMemoryDb } from '@mas/db'
import { deleteSqliteMemory, updateSqliteMemory } from './[memoryId]/handler'
import { listSqliteMemories, updateSqliteMemorySettings } from './handler'

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
    INSERT INTO agents (id, name, model, modules)
    VALUES ('agent-1', 'Agent One', 'claude-sonnet-4-6', '{"memory":{"scheme":"sqlite","summarizeModel":"memory-model","embeddingModel":"memory-embed","retrievePrompt":"提炼检索查询","summarizePrompt":"生成记忆摘要","fragmentPrompt":"把这些记忆当作回忆来回答","consolidatePrompt":"整理记忆"}}');
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
  layer?: 'short_term' | 'long_term' | 'fixed'
}) {
  return memoryRepo.addMemory({
    agentId: input.agentId,
    sessionId: input.sessionId,
    layer: input.layer,
    sourceText: input.summary,
    displaySummary: input.summary,
    retrievalText: input.summary,
    retrievalEmbedding: [1, 0],
    retrievalModel: 'qwen/qwen3-embedding-0.6b',
    tags: input.tags,
    importance: 0.6,
    createdAt: new Date(input.createdAt),
  })
}

test('listSqliteMemories returns 404 when the agent does not exist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const response = listSqliteMemories('missing-agent')

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Not found' })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listSqliteMemories returns 400 when the agent memory scheme is not sqlite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const response = listSqliteMemories('agent-2')

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'Agent memory scheme must be sqlite' })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listSqliteMemories returns paginated latest-first rows and filters by summary or tags', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const latest = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-2',
      summary: '用户偏好午夜后编码',
      tags: ['night', 'coding'],
      createdAt: '2026-04-18T02:00:00.000Z',
      layer: 'long_term',
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
    const oldest = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '用户提到旧画面',
      tags: ['画面'],
      createdAt: '2026-04-16T09:00:00.000Z',
    })

    const listResponse = listSqliteMemories('agent-1', undefined, { page: 1, pageSize: 2 })
    const secondPageResponse = listSqliteMemories('agent-1', undefined, { page: 2, pageSize: 2 })
    const summaryResponse = listSqliteMemories('agent-1', 'WJJ')
    const tagResponse = listSqliteMemories('agent-1', 'night')

    assert.equal(listResponse.status, 200)
    const listData = await listResponse.clone().json()
    assert.equal(listData.summarizeModel, 'memory-model')
    assert.equal(listData.embeddingModel, 'memory-embed')
    assert.equal(listData.timeAnalyzerPrompt, '提炼检索查询')
    assert.equal(listData.semanticAnalyzerPrompt, '提炼检索查询')
    assert.equal(listData.summarizePrompt, '生成记忆摘要')
    assert.equal(listData.fragmentPrompt, '把这些记忆当作回忆来回答')
    assert.equal(listData.consolidatePrompt, '整理记忆')
    assert.equal(typeof listData.timeAnalyzerPromptDefault, 'string')
    assert.equal(typeof listData.semanticAnalyzerPromptDefault, 'string')
    assert.equal(listData.timeAnalyzerPromptEffective, '提炼检索查询')
    assert.equal(listData.semanticAnalyzerPromptEffective, '提炼检索查询')
    assert.equal(listData.summarizePromptEffective, '生成记忆摘要')
    assert.equal(listData.fragmentPromptEffective, '把这些记忆当作回忆来回答')
    assert.equal(listData.consolidatePromptEffective, '整理记忆')
    assert.equal(listData.page, 1)
    assert.equal(listData.pageSize, 2)
    assert.equal(listData.total, 3)
    assert.deepEqual(listData.memories.map((memory: { id: string }) => memory.id), [latest.id, older.id])
    assert.equal(listData.memories[0]?.layer, 'long_term')
    assert.equal(listData.memories[1]?.layer, 'short_term')
    assert.deepEqual((await secondPageResponse.json()).memories.map((memory: { id: string }) => memory.id), [oldest.id])
    assert.deepEqual((await summaryResponse.json()).memories.map((memory: { id: string }) => memory.id), [older.id])
    assert.deepEqual((await tagResponse.json()).memories.map((memory: { id: string }) => memory.id), [latest.id])
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listSqliteMemories filters by layer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const shortTerm = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '用户提到短期事项',
      tags: ['短期'],
      createdAt: '2026-04-18T02:00:00.000Z',
    })
    addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '用户提到长期事项',
      tags: ['长期'],
      createdAt: '2026-04-18T03:00:00.000Z',
      layer: 'long_term',
    })

    const filteredResponse = listSqliteMemories('agent-1', undefined, {
      page: 1,
      pageSize: 20,
      layer: 'long_term',
    } as never)
    const filteredData = await filteredResponse.json()

    assert.equal(filteredData.total, 1)
    assert.deepEqual(filteredData.memories.map((memory: { layer: string }) => memory.layer), ['long_term'])

    assert.equal(filteredData.memories[0]?.summary, '用户提到长期事项')
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateSqliteMemorySettings trims and persists model and prompt overrides', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const response = updateSqliteMemorySettings('agent-1', {
      summarizeModel: '  qwen/qwen-2.5-7b-instruct  ',
      embeddingModel: '  qwen/qwen3-embedding-8b  ',
      timeAnalyzerPrompt: '  生成时间范围  ',
      semanticAnalyzerPrompt: '  生成检索锚点  ',
      summarizePrompt: '  生成展示摘要和检索文本  ',
      fragmentPrompt: '  把这些记忆当作回忆来回答  ',
      consolidatePrompt: '  重新整理相近记忆  ',
    })

    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.agentId, 'agent-1')
    assert.equal(data.scheme, 'sqlite')
    assert.equal(data.summarizeModel, 'qwen/qwen-2.5-7b-instruct')
    assert.equal(data.embeddingModel, 'qwen/qwen3-embedding-8b')
    assert.equal(data.timeAnalyzerPrompt, '生成时间范围')
    assert.equal(data.semanticAnalyzerPrompt, '生成检索锚点')
    assert.equal(data.summarizePrompt, '生成展示摘要和检索文本')
    assert.equal(data.fragmentPrompt, '把这些记忆当作回忆来回答')
    assert.equal(data.consolidatePrompt, '重新整理相近记忆')
    assert.equal(typeof data.timeAnalyzerPromptDefault, 'string')
    assert.equal(data.timeAnalyzerPromptEffective, '生成时间范围')
    assert.equal(typeof data.semanticAnalyzerPromptDefault, 'string')
    assert.equal(data.semanticAnalyzerPromptEffective, '生成检索锚点')
    assert.equal(typeof data.summarizePromptDefault, 'string')
    assert.equal(data.summarizePromptEffective, '生成展示摘要和检索文本')
    assert.equal(typeof data.fragmentPromptDefault, 'string')
    assert.equal(data.fragmentPromptEffective, '把这些记忆当作回忆来回答')
    assert.equal(typeof data.consolidatePromptDefault, 'string')
    assert.equal(data.consolidatePromptEffective, '重新整理相近记忆')
    assert.deepEqual(agentRepo.getAgent('agent-1')?.modules, {
      memory: {
        scheme: 'sqlite',
        summarizeModel: 'qwen/qwen-2.5-7b-instruct',
        embeddingModel: 'qwen/qwen3-embedding-8b',
        timeAnalyzerPrompt: '生成时间范围',
        semanticAnalyzerPrompt: '生成检索锚点',
        summarizePrompt: '生成展示摘要和检索文本',
        fragmentPrompt: '把这些记忆当作回忆来回答',
        consolidatePrompt: '重新整理相近记忆',
      },
    })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateSqliteMemorySettings clears overrides when passed empty text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const response = updateSqliteMemorySettings('agent-1', {
      summarizeModel: '   ',
      embeddingModel: '   ',
      timeAnalyzerPrompt: '   ',
      semanticAnalyzerPrompt: '   ',
      summarizePrompt: '   ',
      fragmentPrompt: '   ',
      consolidatePrompt: '   ',
    })

    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.agentId, 'agent-1')
    assert.equal(data.scheme, 'sqlite')
    assert.equal(data.summarizeModel, null)
    assert.equal(data.embeddingModel, null)
    assert.equal(data.timeAnalyzerPrompt, null)
    assert.equal(data.semanticAnalyzerPrompt, null)
    assert.equal(data.summarizePrompt, null)
    assert.equal(data.fragmentPrompt, null)
    assert.equal(data.consolidatePrompt, null)
    assert.equal(typeof data.timeAnalyzerPromptDefault, 'string')
    assert.equal(data.timeAnalyzerPromptEffective, data.timeAnalyzerPromptDefault)
    assert.equal(typeof data.semanticAnalyzerPromptDefault, 'string')
    assert.equal(data.semanticAnalyzerPromptEffective, data.semanticAnalyzerPromptDefault)
    assert.deepEqual(agentRepo.getAgent('agent-1')?.modules, {
      memory: {
        scheme: 'sqlite',
      },
    })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleteSqliteMemory removes only memories owned by the given agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

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
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateSqliteMemory updates a single memory layer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const memory = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '用户偏好使用本地数据库',
      tags: ['sqlite'],
      createdAt: '2026-04-17T10:00:00.000Z',
    })

    const response = updateSqliteMemory('agent-1', memory.id, { layer: 'fixed' })

    assert.equal(response.status, 200)
    assert.equal(memoryRepo.getMemory(memory.id)?.layer, 'fixed')
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
