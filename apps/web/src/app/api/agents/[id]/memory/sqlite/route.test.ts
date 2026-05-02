import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  agentRepo,
  episodicMemoryGraphRepo,
  getDb,
  getMemoryDb,
  getRawSqlite,
  memoryRepo,
  resetDb,
  resetMemoryDb,
} from '@mas/db'
import { deleteSqliteMemory, updateSqliteMemory } from './[memoryId]/handler'
import { clearSqliteMemories, listSqliteMemories, updateSqliteMemorySettings } from './handler'

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
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE session_context_state (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      active_start_message_id TEXT,
      pending_flush_until_message_id TEXT,
      last_user_message_at INTEGER,
      last_context_flush_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE agent_memory_sleep_state (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id),
      last_sleep_at INTEGER,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model, modules)
    VALUES ('agent-1', 'Agent One', 'claude-sonnet-4-6', '{"memory":{"scheme":"sqlite","summarizeModel":"memory-model","embeddingModel":"memory-embed","retrievePrompt":"提炼检索查询","summarizePrompt":"生成记忆摘要","fragmentPrompt":"把这些记忆当作回忆来回答","consolidatePrompt":"整理记忆","retrieveTopK":7}}');
    INSERT INTO agents (id, name, model, modules)
    VALUES ('agent-2', 'Agent Two', 'claude-sonnet-4-6', '{"memory":{"scheme":"noop"}}');
    INSERT INTO sessions (id, agent_id, created_at, updated_at) VALUES ('session-1', 'agent-1', 1, 1);
    INSERT INTO sessions (id, agent_id, created_at, updated_at) VALUES ('session-2', 'agent-1', 2, 2);
    INSERT INTO sessions (id, agent_id, created_at, updated_at) VALUES ('session-3', 'agent-2', 3, 3);
  `)
}

function addMemory(input: {
  agentId: string
  sessionId: string
  summary: string
  retrievalText?: string
  tags: string[]
  createdAt: string
  observedStartAt?: string | null
  observedEndAt?: string | null
  layer?: 'short_term' | 'long_term' | 'fixed'
}) {
  return memoryRepo.addMemory({
    agentId: input.agentId,
    sessionId: input.sessionId,
    layer: input.layer,
    sourceText: input.summary,
    detail: input.summary,
    retrievalText: input.retrievalText ?? input.summary,
    retrievalEmbedding: [1, 0],
    retrievalModel: 'qwen/qwen3-embedding-0.6b',
    tags: input.tags,
    importance: 0.6,
    createdAt: new Date(input.createdAt),
    observedStartAt: input.observedStartAt ? new Date(input.observedStartAt) : null,
    observedEndAt: input.observedEndAt ? new Date(input.observedEndAt) : null,
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

test('listSqliteMemories returns paginated latest-first rows and filters by summary or retrieval text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const legacyLongTerm = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-2',
      summary: '用户偏好午夜后编码',
      retrievalText: '用户喜欢在 night coding 时段写代码',
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
      observedStartAt: '2026-04-17T08:55:00.000Z',
      observedEndAt: '2026-04-17T09:05:00.000Z',
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
    const legacyRetrievalResponse = listSqliteMemories('agent-1', 'night coding')
    const explicitLegacyResponse = listSqliteMemories('agent-1', 'night coding', {
      layer: 'long_term',
    } as never)

    assert.equal(listResponse.status, 200)
    const listData = await listResponse.clone().json()
    assert.equal(listData.summarizeModel, 'memory-model')
    assert.equal(listData.embeddingModel, 'memory-embed')
    assert.equal(listData.semanticAnalyzerPrompt, '提炼检索查询')
    assert.equal(listData.fragmentPrompt, '把这些记忆当作回忆来回答')
    assert.equal(listData.entityMentionPrompt, null)
    assert.equal(listData.episodicExtractionPrompt, null)
    assert.equal(listData.entityResolutionPrompt, null)
    assert.equal(typeof listData.entityMentionPromptDefault, 'string')
    assert.equal(typeof listData.episodicExtractionPromptDefault, 'string')
    assert.equal(typeof listData.entityResolutionPromptDefault, 'string')
    assert.equal(listData.entityMentionPromptEffective, listData.entityMentionPromptDefault)
    assert.equal(listData.episodicExtractionPromptEffective, listData.episodicExtractionPromptDefault)
    assert.equal(listData.entityResolutionPromptEffective, listData.entityResolutionPromptDefault)
    assert.equal('shortTermToLongTermPrompt' in listData, false)
    assert.equal('shortTermToLongTermPromptDefault' in listData, false)
    assert.equal('shortTermToLongTermPromptEffective' in listData, false)
    assert.equal(typeof listData.semanticAnalyzerPromptDefault, 'string')
    assert.equal(listData.semanticAnalyzerPromptEffective, '提炼检索查询')
    assert.equal(listData.fragmentPromptEffective, '把这些记忆当作回忆来回答')
    assert.equal(listData.contextWindowMessages, 50)
    assert.equal(listData.contextOverflowBatchSize, 25)
    assert.equal(listData.contextIdleFlushMinutes, 30)
    assert.equal(listData.maxShortTermMemoriesPerFlush, 3)
    assert.equal(listData.shortTermRetrieveTopK, 7)
    assert.equal(listData.fixedRetrieveTopK, 7)
    assert.equal(listData.shortTermMinSimilarity, 0.6)
    assert.equal(listData.fixedMinSimilarity, 0.6)
    assert.equal(listData.semanticAnalyzerHistoryMessages, 6)
    assert.equal(listData.longTermSearchDefaultTopK, 3)
    assert.equal(listData.showNoHitMemoryFragments, true)
    assert.equal(listData.sleepEnabled, true)
    assert.equal(listData.sleepTimeLocal, '03:00')
    assert.equal(listData.sleepIntervalDays, 1)
    assert.equal('summarizePrompt' in listData, false)
    assert.equal('summarizePromptDefault' in listData, false)
    assert.equal('summarizePromptEffective' in listData, false)
    assert.equal('consolidatePrompt' in listData, false)
    assert.equal('consolidatePromptDefault' in listData, false)
    assert.equal('consolidatePromptEffective' in listData, false)
    assert.equal(listData.context.activeSessionId, 'session-2')
    assert.equal(listData.context.activeMessageCount, 0)
    assert.equal(listData.context.totalSessionMessages, 0)
    assert.equal(listData.sleep.lastSleepAt, null)
    assert.equal(listData.page, 1)
    assert.equal(listData.pageSize, 2)
    assert.deepEqual(listData.legacyLayers, ['short_term', 'fixed'])
    assert.equal(listData.total, 2)
    assert.deepEqual(listData.memories.map((memory: { id: string }) => memory.id), [older.id, oldest.id])
    assert.equal('summary' in listData.memories[0], false)
    assert.equal(listData.memories[0]?.detail, '用户希望被称为 WJJ')
    assert.equal(listData.memories[0]?.retrievalText, '用户希望被称为 WJJ')
    assert.equal(listData.memories[0]?.layer, 'short_term')
    assert.equal(listData.memories[0]?.observedStartAt, '2026-04-17T08:55:00.000Z')
    assert.equal(listData.memories[0]?.observedEndAt, '2026-04-17T09:05:00.000Z')
    assert.deepEqual((await secondPageResponse.json()).memories.map((memory: { id: string }) => memory.id), [])
    assert.deepEqual((await summaryResponse.json()).memories.map((memory: { id: string }) => memory.id), [older.id])
    assert.deepEqual((await legacyRetrievalResponse.json()).memories.map((memory: { id: string }) => memory.id), [])
    assert.deepEqual((await explicitLegacyResponse.json()).memories.map((memory: { id: string }) => memory.id), [legacyLongTerm.id])
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listSqliteMemories returns read-only episodic memories and entity graph data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const compass = episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '黄铜指南针',
      description: '放在 MAS Lab 白板旁的道具',
      confidence: 0.92,
      aliases: [{ alias: '指南针', confidence: 0.88 }],
      now: new Date('2026-04-24T10:00:00.000Z'),
    })
    const lab = episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-1',
      type: 'place',
      canonicalName: 'MAS Lab',
      description: null,
      confidence: 0.81,
      aliases: [],
      now: new Date('2026-04-24T10:02:00.000Z'),
    })
    episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-2',
      type: 'object',
      canonicalName: '其他 agent 的指南针',
      description: null,
      confidence: 0.9,
      aliases: [],
      now: new Date('2026-04-24T10:04:00.000Z'),
    })
    episodicMemoryGraphRepo.upsertEntityEdge({
      agentId: 'agent-1',
      sourceEntityId: compass.id,
      targetEntityId: lab.id,
      delta: 0.42,
      now: new Date('2026-04-24T10:05:00.000Z'),
    })
    const episodic = episodicMemoryGraphRepo.createEpisodicMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '黄铜指南针被放在 MAS Lab 白板旁。',
      sourceText: '用户说黄铜指南针在 MAS Lab 白板旁。',
      sourceQuote: '黄铜指南针在 MAS Lab 白板旁',
      retrievalText: '黄铜指南针 MAS Lab 白板旁',
      retrievalEmbedding: [1, 0, 0],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      importance: 0.86,
      observedStartAt: new Date('2026-04-24T09:55:00.000Z'),
      observedEndAt: new Date('2026-04-24T10:00:00.000Z'),
      entityLinks: [
        { entityId: compass.id, weight: 0.9 },
        { entityId: lab.id, weight: 0.7 },
      ],
      now: new Date('2026-04-24T10:06:00.000Z'),
    })

    const response = listSqliteMemories('agent-1')
    const data = await response.json()

    assert.equal(response.status, 200)
    assert.deepEqual(data.legacyLayers, ['short_term', 'fixed'])
    assert.equal('activations' in data, false)
    assert.equal('memory_entity_activations' in data, false)
    assert.equal(data.episodic.total, 1)
    assert.equal(data.episodic.memories[0].id, episodic.id)
    assert.equal(data.episodic.memories[0].summary, '黄铜指南针被放在 MAS Lab 白板旁。')
    assert.equal(data.episodic.memories[0].retrievalModel, 'qwen/qwen3-embedding-8b')
    assert.equal(data.episodic.memories[0].hasEmbedding, true)
    assert.equal(data.episodic.memories[0].embeddingDimensions, 3)
    assert.deepEqual(
      data.episodic.memories[0].entities.map((entity: { canonicalName: string; weight: number }) => [entity.canonicalName, entity.weight]),
      [['黄铜指南针', 0.9], ['MAS Lab', 0.7]],
    )
    assert.equal(data.entities.total, 2)
    assert.deepEqual(
      data.entities.nodes.items.map((entity: { canonicalName: string }) => entity.canonicalName).sort(),
      ['MAS Lab', '黄铜指南针'],
    )
    assert.deepEqual(data.entities.nodes.items.find((entity: { id: string }) => entity.id === compass.id).aliases, ['指南针'])
    assert.equal(data.entities.nodes.items.find((entity: { id: string }) => entity.id === compass.id).episodicMemoryCount, 1)
    assert.equal(data.entities.edges.items.length, 1)
    assert.equal(data.entities.edges.items[0].sourceEntityId, compass.id < lab.id ? compass.id : lab.id)
    assert.equal(data.entities.edges.items[0].targetEntityId, compass.id < lab.id ? lab.id : compass.id)
    assert.equal(data.entities.edges.items[0].weight, 0.42)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listSqliteMemories returns unified memory rows and paginated graph query results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const shortTerm = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: 'WJJ 提到短期蓝色雨伞',
      retrievalText: '短期 蓝色雨伞',
      tags: ['雨伞'],
      createdAt: '2026-04-24T10:00:00.000Z',
      layer: 'short_term',
    })
    const fixed = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: 'WJJ 固化偏好旧书店',
      retrievalText: '固化 旧书店',
      tags: ['旧书店'],
      createdAt: '2026-04-24T10:01:00.000Z',
      layer: 'fixed',
    })
    const bookstore = episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-1',
      type: 'place',
      canonicalName: '安特卫普旧书店',
      description: '和蓝色雨伞相关的旧书店',
      confidence: 0.9,
      aliases: [{ alias: '旧书店', confidence: 0.8 }],
      now: new Date('2026-04-24T10:02:00.000Z'),
    })
    const umbrella = episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '蓝色雨伞',
      description: null,
      confidence: 0.85,
      aliases: [],
      now: new Date('2026-04-24T10:03:00.000Z'),
    })
    const lab = episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-1',
      type: 'place',
      canonicalName: 'MAS Lab',
      description: null,
      confidence: 0.8,
      aliases: [],
      now: new Date('2026-04-24T10:04:00.000Z'),
    })
    episodicMemoryGraphRepo.upsertEntityEdge({
      agentId: 'agent-1',
      sourceEntityId: bookstore.id,
      targetEntityId: umbrella.id,
      delta: 0.5,
      now: new Date('2026-04-24T10:05:00.000Z'),
    })
    episodicMemoryGraphRepo.upsertEntityEdge({
      agentId: 'agent-1',
      sourceEntityId: bookstore.id,
      targetEntityId: lab.id,
      delta: 0.2,
      now: new Date('2026-04-24T10:06:00.000Z'),
    })
    const episodic = episodicMemoryGraphRepo.createEpisodicMemory({
      agentId: 'agent-1',
      sessionId: 'session-2',
      summary: 'WJJ 在安特卫普旧书店带着蓝色雨伞。',
      sourceText: 'WJJ 在安特卫普旧书店带着蓝色雨伞。',
      sourceQuote: '带着蓝色雨伞',
      retrievalText: '安特卫普旧书店 蓝色雨伞',
      retrievalEmbedding: [1, 0, 0],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      importance: 0.88,
      observedStartAt: new Date('2026-04-24T10:05:00.000Z'),
      observedEndAt: new Date('2026-04-24T10:10:00.000Z'),
      entityLinks: [
        { entityId: bookstore.id, weight: 0.9 },
        { entityId: umbrella.id, weight: 0.8 },
      ],
      now: new Date('2026-04-24T10:07:00.000Z'),
    })

    const firstPageResponse = listSqliteMemories('agent-1', undefined, {
      page: 1,
      pageSize: 2,
      graphQuery: '旧书店',
      nodePage: 1,
      edgePage: 1,
      graphPageSize: 1,
    } as never)
    const firstPage = await firstPageResponse.json()
    const episodicOnlyResponse = listSqliteMemories('agent-1', '雨伞', {
      page: 1,
      pageSize: 5,
      layer: 'episodic',
    } as never)
    const episodicOnly = await episodicOnlyResponse.json()

    assert.equal(firstPageResponse.status, 200)
    assert.equal(firstPage.total, 3)
    assert.deepEqual(
      firstPage.rows.map((row: { id: string; layer: string; kind: string }) => [row.id, row.layer, row.kind]),
      [
        [episodic.id, 'episodic', 'episodic'],
        [fixed.id, 'fixed', 'sqlite'],
      ],
    )
    assert.equal(firstPage.rows[0].sourceQuote, '带着蓝色雨伞')
    assert.equal(firstPage.rows[0].hasEmbedding, true)
    assert.equal(firstPage.rows[0].embeddingDimensions, 3)
    assert.deepEqual(
      firstPage.rows[0].entities.map((entity: { canonicalName: string; weight: number }) => [entity.canonicalName, entity.weight]),
      [['安特卫普旧书店', 0.9], ['蓝色雨伞', 0.8]],
    )
    assert.equal(firstPage.graphQuery, '旧书店')
    assert.equal(firstPage.entities.total, 1)
    assert.equal(firstPage.entities.nodes.total, 1)
    assert.equal(firstPage.entities.nodes.page, 1)
    assert.equal(firstPage.entities.nodes.pageSize, 1)
    assert.deepEqual(firstPage.entities.nodes.items.map((entity: { canonicalName: string }) => entity.canonicalName), ['安特卫普旧书店'])
    assert.equal(firstPage.entities.edges.total, 2)
    assert.equal(firstPage.entities.edges.items.length, 1)
    assert.match(firstPage.entities.edges.items[0].sourceCanonicalName + firstPage.entities.edges.items[0].targetCanonicalName, /旧书店/)
    assert.deepEqual(episodicOnly.rows.map((row: { id: string }) => row.id), [episodic.id])
    assert.equal(episodicOnly.total, 1)
    assert.equal(shortTerm.id.length > 0, true)
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

    assert.equal(filteredData.memories[0]?.detail, '用户提到长期事项')
    assert.equal('summary' in filteredData.memories[0], false)
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
      semanticAnalyzerPrompt: '  生成检索锚点  ',
      contextWindowMessages: 60,
      contextOverflowBatchSize: 18,
      contextIdleFlushMinutes: 45,
      maxShortTermMemoriesPerFlush: 2,
      shortTermRetrieveTopK: 4,
      fixedRetrieveTopK: 6,
      shortTermMinSimilarity: 0.72,
      fixedMinSimilarity: 0.81,
      semanticAnalyzerHistoryMessages: 8,
      longTermSearchDefaultTopK: 5,
      showNoHitMemoryFragments: false,
      sleepEnabled: false,
      sleepTimeLocal: '  04:30  ',
      sleepIntervalDays: 2,
      fragmentPrompt: '  把这些记忆当作回忆来回答  ',
      contextToShortTermPrompt: '  整理旧上下文为短期记忆  ',
      shortTermToLongTermPrompt: '  旧字段应该被清掉  ',
      entityMentionPrompt: '  抽取实体 mention  ',
      episodicExtractionPrompt: '  抽取实体和情景记忆  ',
      entityResolutionPrompt: '  合并实体或创建新实体  ',
      shortTermFragmentPrompt: '  这些是近期记忆  ',
      fixedFragmentPrompt: '  这些是稳定事实  ',
    })

    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.agentId, 'agent-1')
    assert.equal(data.scheme, 'sqlite')
    assert.equal(data.summarizeModel, 'qwen/qwen-2.5-7b-instruct')
    assert.equal(data.embeddingModel, 'qwen/qwen3-embedding-8b')
    assert.equal(data.contextWindowMessages, 60)
    assert.equal(data.contextOverflowBatchSize, 18)
    assert.equal(data.contextIdleFlushMinutes, 45)
    assert.equal(data.maxShortTermMemoriesPerFlush, 2)
    assert.equal(data.shortTermRetrieveTopK, 4)
    assert.equal(data.fixedRetrieveTopK, 6)
    assert.equal(data.shortTermMinSimilarity, 0.72)
    assert.equal(data.fixedMinSimilarity, 0.81)
    assert.equal(data.semanticAnalyzerHistoryMessages, 8)
    assert.equal(data.longTermSearchDefaultTopK, 5)
    assert.equal(data.showNoHitMemoryFragments, false)
    assert.equal(data.sleepEnabled, false)
    assert.equal(data.sleepTimeLocal, '04:30')
    assert.equal(data.sleepIntervalDays, 2)
    assert.equal(data.semanticAnalyzerPrompt, '生成检索锚点')
    assert.equal(data.fragmentPrompt, '把这些记忆当作回忆来回答')
    assert.equal(data.contextToShortTermPrompt, '整理旧上下文为短期记忆')
    assert.equal(data.entityMentionPrompt, '抽取实体 mention')
    assert.equal(data.episodicExtractionPrompt, '抽取实体和情景记忆')
    assert.equal(data.entityResolutionPrompt, '合并实体或创建新实体')
    assert.equal(data.shortTermFragmentPrompt, '这些是近期记忆')
    assert.equal(data.fixedFragmentPrompt, '这些是稳定事实')
    assert.equal(typeof data.semanticAnalyzerPromptDefault, 'string')
    assert.equal(data.semanticAnalyzerPromptEffective, '生成检索锚点')
    assert.equal(typeof data.contextToShortTermPromptDefault, 'string')
    assert.equal(data.contextToShortTermPromptEffective, '整理旧上下文为短期记忆')
    assert.equal(typeof data.entityMentionPromptDefault, 'string')
    assert.equal(data.entityMentionPromptEffective, '抽取实体 mention')
    assert.equal(typeof data.episodicExtractionPromptDefault, 'string')
    assert.equal(data.episodicExtractionPromptEffective, '抽取实体和情景记忆')
    assert.equal(typeof data.entityResolutionPromptDefault, 'string')
    assert.equal(data.entityResolutionPromptEffective, '合并实体或创建新实体')
    assert.equal(typeof data.fragmentPromptDefault, 'string')
    assert.equal(data.fragmentPromptEffective, '把这些记忆当作回忆来回答')
    assert.equal(typeof data.shortTermFragmentPromptDefault, 'string')
    assert.equal(data.shortTermFragmentPromptEffective, '这些是近期记忆')
    assert.equal(typeof data.fixedFragmentPromptDefault, 'string')
    assert.equal(data.fixedFragmentPromptEffective, '这些是稳定事实')
    assert.equal('summarizePrompt' in data, false)
    assert.equal('summarizePromptDefault' in data, false)
    assert.equal('summarizePromptEffective' in data, false)
    assert.equal('consolidatePrompt' in data, false)
    assert.equal('consolidatePromptDefault' in data, false)
    assert.equal('consolidatePromptEffective' in data, false)
    assert.equal('shortTermToLongTermPrompt' in data, false)
    assert.equal('shortTermToLongTermPromptDefault' in data, false)
    assert.equal('shortTermToLongTermPromptEffective' in data, false)
    assert.deepEqual(agentRepo.getAgent('agent-1')?.modules, {
      memory: {
        scheme: 'sqlite',
        summarizeModel: 'qwen/qwen-2.5-7b-instruct',
        embeddingModel: 'qwen/qwen3-embedding-8b',
        retrieveTopK: 7,
        contextWindowMessages: 60,
        contextOverflowBatchSize: 18,
        contextIdleFlushMinutes: 45,
        maxShortTermMemoriesPerFlush: 2,
        shortTermRetrieveTopK: 4,
        fixedRetrieveTopK: 6,
        shortTermMinSimilarity: 0.72,
        fixedMinSimilarity: 0.81,
        semanticAnalyzerHistoryMessages: 8,
        longTermSearchDefaultTopK: 5,
        showNoHitMemoryFragments: false,
        sleepEnabled: false,
        sleepTimeLocal: '04:30',
        sleepIntervalDays: 2,
        semanticAnalyzerPrompt: '生成检索锚点',
        fragmentPrompt: '把这些记忆当作回忆来回答',
        contextToShortTermPrompt: '整理旧上下文为短期记忆',
        entityMentionPrompt: '抽取实体 mention',
        episodicExtractionPrompt: '抽取实体和情景记忆',
        entityResolutionPrompt: '合并实体或创建新实体',
        shortTermFragmentPrompt: '这些是近期记忆',
        fixedFragmentPrompt: '这些是稳定事实',
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
      contextWindowMessages: null,
      contextOverflowBatchSize: null,
      contextIdleFlushMinutes: null,
      maxShortTermMemoriesPerFlush: null,
      shortTermRetrieveTopK: null,
      fixedRetrieveTopK: null,
      shortTermMinSimilarity: null,
      fixedMinSimilarity: null,
      semanticAnalyzerHistoryMessages: null,
      longTermSearchDefaultTopK: null,
      showNoHitMemoryFragments: null,
      sleepEnabled: null,
      sleepTimeLocal: '   ',
      sleepIntervalDays: null,
      semanticAnalyzerPrompt: '   ',
      fragmentPrompt: '   ',
      contextToShortTermPrompt: '   ',
      entityMentionPrompt: '   ',
      episodicExtractionPrompt: '   ',
      entityResolutionPrompt: '   ',
      shortTermFragmentPrompt: '   ',
      fixedFragmentPrompt: '   ',
    })

    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.agentId, 'agent-1')
    assert.equal(data.scheme, 'sqlite')
    assert.equal(data.summarizeModel, null)
    assert.equal(data.embeddingModel, 'qwen/qwen3-embedding-8b')
    assert.equal(data.contextWindowMessages, 50)
    assert.equal(data.contextOverflowBatchSize, 25)
    assert.equal(data.contextIdleFlushMinutes, 30)
    assert.equal(data.maxShortTermMemoriesPerFlush, 3)
    assert.equal(data.shortTermRetrieveTopK, 7)
    assert.equal(data.fixedRetrieveTopK, 7)
    assert.equal(data.shortTermMinSimilarity, 0.6)
    assert.equal(data.fixedMinSimilarity, 0.6)
    assert.equal(data.semanticAnalyzerHistoryMessages, 6)
    assert.equal(data.longTermSearchDefaultTopK, 3)
    assert.equal(data.showNoHitMemoryFragments, true)
    assert.equal(data.sleepEnabled, true)
    assert.equal(data.sleepTimeLocal, '03:00')
    assert.equal(data.sleepIntervalDays, 1)
    assert.equal(data.semanticAnalyzerPrompt, null)
    assert.equal(data.fragmentPrompt, null)
    assert.equal(data.contextToShortTermPrompt, null)
    assert.equal(data.entityMentionPrompt, null)
    assert.equal(data.episodicExtractionPrompt, null)
    assert.equal(data.entityResolutionPrompt, null)
    assert.equal(data.shortTermFragmentPrompt, null)
    assert.equal(data.fixedFragmentPrompt, null)
    assert.equal(typeof data.semanticAnalyzerPromptDefault, 'string')
    assert.equal(data.semanticAnalyzerPromptEffective, data.semanticAnalyzerPromptDefault)
    assert.equal(typeof data.contextToShortTermPromptDefault, 'string')
    assert.equal(data.contextToShortTermPromptEffective, data.contextToShortTermPromptDefault)
    assert.equal(typeof data.entityMentionPromptDefault, 'string')
    assert.equal(data.entityMentionPromptEffective, data.entityMentionPromptDefault)
    assert.equal(typeof data.episodicExtractionPromptDefault, 'string')
    assert.equal(data.episodicExtractionPromptEffective, data.episodicExtractionPromptDefault)
    assert.equal(typeof data.entityResolutionPromptDefault, 'string')
    assert.equal(data.entityResolutionPromptEffective, data.entityResolutionPromptDefault)
    assert.equal(typeof data.shortTermFragmentPromptDefault, 'string')
    assert.equal(data.shortTermFragmentPromptEffective, data.shortTermFragmentPromptDefault)
    assert.equal(typeof data.fixedFragmentPromptDefault, 'string')
    assert.equal(data.fixedFragmentPromptEffective, data.fixedFragmentPromptDefault)
    assert.equal('summarizePrompt' in data, false)
    assert.equal('summarizePromptDefault' in data, false)
    assert.equal('summarizePromptEffective' in data, false)
    assert.equal('consolidatePrompt' in data, false)
    assert.equal('consolidatePromptDefault' in data, false)
    assert.equal('consolidatePromptEffective' in data, false)
    assert.deepEqual(agentRepo.getAgent('agent-1')?.modules, {
      memory: {
        scheme: 'sqlite',
        retrieveTopK: 7,
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

test('clearSqliteMemories removes all memories for the sqlite agent and returns the deleted count', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const shortTerm = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '用户提到短期事项',
      tags: ['short'],
      createdAt: '2026-04-17T10:00:00.000Z',
      layer: 'short_term',
    })
    const longTerm = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '用户提到长期事项',
      tags: ['long'],
      createdAt: '2026-04-17T11:00:00.000Z',
      layer: 'long_term',
    })
    const fixed = addMemory({
      agentId: 'agent-1',
      sessionId: 'session-2',
      summary: '用户提到固化事项',
      tags: ['fixed'],
      createdAt: '2026-04-17T12:00:00.000Z',
      layer: 'fixed',
    })
    const foreign = addMemory({
      agentId: 'agent-2',
      sessionId: 'session-3',
      summary: '别的 agent 的记忆',
      tags: ['foreign'],
      createdAt: '2026-04-17T13:00:00.000Z',
      layer: 'long_term',
    })
    getRawSqlite().exec(`
      INSERT INTO messages (id, session_id, role, content, created_at)
      VALUES ('message-1', 'session-1', 'user', '不要删除聊天消息', 1);
    `)

    const response = clearSqliteMemories('agent-1')

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, deletedCount: 3 })
    assert.equal(memoryRepo.getMemory(shortTerm.id), undefined)
    assert.equal(memoryRepo.getMemory(longTerm.id), undefined)
    assert.equal(memoryRepo.getMemory(fixed.id), undefined)
    assert.ok(memoryRepo.getMemory(foreign.id))
    assert.equal((getRawSqlite().prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count, 3)
    assert.equal((getRawSqlite().prepare('SELECT COUNT(*) AS count FROM messages').get() as { count: number }).count, 1)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('clearSqliteMemories returns 404 when the agent does not exist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const response = clearSqliteMemories('missing-agent')

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Not found' })
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('clearSqliteMemories returns 400 when the agent memory scheme is not sqlite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-memory-sqlite-'))
  const dbPath = join(dir, 'test.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    addMemory({
      agentId: 'agent-2',
      sessionId: 'session-3',
      summary: '非 sqlite agent 的记忆',
      tags: ['noop'],
      createdAt: '2026-04-17T10:00:00.000Z',
    })

    const response = clearSqliteMemories('agent-2')

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'Agent memory scheme must be sqlite' })
    assert.equal(memoryRepo.listMemoriesByAgent('agent-2').length, 1)
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
      observedStartAt: '2026-04-17T09:45:00.000Z',
      observedEndAt: '2026-04-17T10:00:00.000Z',
    })

    const response = updateSqliteMemory('agent-1', memory.id, { layer: 'fixed' })
    const data = await response.json()

    assert.equal(response.status, 200)
    assert.equal(memoryRepo.getMemory(memory.id)?.layer, 'fixed')
    assert.equal(data.memory.observedStartAt, '2026-04-17T09:45:00.000Z')
    assert.equal(data.memory.observedEndAt, '2026-04-17T10:00:00.000Z')
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
