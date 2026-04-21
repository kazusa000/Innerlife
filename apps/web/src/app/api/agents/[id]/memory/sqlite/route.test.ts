import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { agentRepo, getDb, getMemoryDb, getRawSqlite, memoryRepo, resetDb, resetMemoryDb } from '@mas/db'
import { deleteSqliteMemory } from './[memoryId]/handler'
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
}) {
  return memoryRepo.addMemory({
    agentId: input.agentId,
    sessionId: input.sessionId,
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
    assert.equal(listData.retrievePrompt, '提炼检索查询')
    assert.equal(listData.summarizePrompt, '生成记忆摘要')
    assert.equal(listData.fragmentPrompt, '把这些记忆当作回忆来回答')
    assert.equal(listData.consolidatePrompt, '整理记忆')
    assert.equal(listData.retrievePromptDefault, [
      '你要为 sqlite 记忆系统准备一份语义检索查询。',
      '你会收到电脑当前的本地时间，以及用户最新一条消息。',
      '请严格返回如下 JSON 结构：',
      '{"retrieval_query": string | null, "time_range": {"start": string, "end": string} | null, "focus": string | null}',
      'retrieval_query 只保留最短、最稳定、最能检索的主题锚点，通常就是一个名词或很短的名词短语；不要写解释句。',
      '时间信息绝不进入 retrieval_query；时间只进入 time_range。',
      'retrieval_query 不要包含说话者、提问动作、讨论动作，也不要包含“内容/事情/对话/讨论”这类回顾外壳，也不要复述整个时间回顾问句。',
      '去掉时间和回顾外壳后，如果没有稳定主题锚点，就返回 "retrieval_query": null；纯回顾问法本身不是主题锚点。',
      'retrieval_query 和 focus 默认使用与用户消息相同的语言；中文提问就用中文，不要改成英文。',
      '如果用户没有表达时间意图，返回 "time_range": null。',
      '如果用户表达了时间意图，请基于当前本地时间返回尽量精确的绝对 time_range；time_range 负责“什么时候”，retrieval_query 只负责“是什么”。',
      '如果问题明显是在回顾已经发生过的内容，time_range 必须落在已经过去的时间窗口里，不要返回未来时间；优先选择最近一个已经结束的过去时段。',
      '如果用户是在泛指过去互动、先前对话、此前提到过的事，即使没有明确时间粒度，也视为时间意图；返回覆盖足够宽的过去区间并以当前本地时间为结束的非空 time_range，不要返回 null。',
      '如果用户只是在回顾某个时间段里聊过什么、说过什么、讨论过什么，retrieval_query 可以为 null，但 time_range 不应为 null。',
      '“今天”表示当前本地自然日，“昨天”表示前一个本地自然日，不是滚动的 24 小时窗口。',
      '上午=06:00-11:59，下午=12:00-17:59，晚上=18:00-23:59，凌晨=00:00-05:59，全部按本地时间理解。',
      '“刚刚/刚才/前面/上一句”要对应最近几分钟的短时间窗口，不是单一时间点。',
      '“今天上午/今天下午/今晚/昨晚/今早/昨天上午”要对应最窄、最贴近原话的局部时间窗口，不要扩大成整天，不要跨到其他时段，也不要跨到下一天；如果该时段尚未发生，就回指最近一个已经结束的同类过去时段。',
      'focus 只写简短关注点；没有明显 focus 就返回 null。',
      '"start" 和 "end" 必须是 ISO 8601 datetime 字符串。',
      '不要输出 markdown、代码块或任何额外说明。',
    ].join('\n'))
    assert.equal(listData.retrievePromptEffective, '提炼检索查询')
    assert.equal(listData.summarizePromptEffective, '生成记忆摘要')
    assert.equal(listData.fragmentPromptEffective, '把这些记忆当作回忆来回答')
    assert.equal(listData.consolidatePromptEffective, '整理记忆')
    assert.equal(listData.page, 1)
    assert.equal(listData.pageSize, 2)
    assert.equal(listData.total, 3)
    assert.deepEqual(listData.memories.map((memory: { id: string }) => memory.id), [latest.id, older.id])
    assert.deepEqual((await secondPageResponse.json()).memories.map((memory: { id: string }) => memory.id), [oldest.id])
    assert.deepEqual((await summaryResponse.json()).memories.map((memory: { id: string }) => memory.id), [older.id])
    assert.deepEqual((await tagResponse.json()).memories.map((memory: { id: string }) => memory.id), [latest.id])
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
      retrievePrompt: '  生成检索锚点  ',
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
    assert.equal(data.retrievePrompt, '生成检索锚点')
    assert.equal(data.summarizePrompt, '生成展示摘要和检索文本')
    assert.equal(data.fragmentPrompt, '把这些记忆当作回忆来回答')
    assert.equal(data.consolidatePrompt, '重新整理相近记忆')
    assert.equal(typeof data.retrievePromptDefault, 'string')
    assert.equal(data.retrievePromptEffective, '生成检索锚点')
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
        retrievePrompt: '生成检索锚点',
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
      retrievePrompt: '   ',
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
    assert.equal(data.retrievePrompt, null)
    assert.equal(data.summarizePrompt, null)
    assert.equal(data.fragmentPrompt, null)
    assert.equal(data.consolidatePrompt, null)
    assert.equal(typeof data.retrievePromptDefault, 'string')
    assert.equal(data.retrievePromptEffective, data.retrievePromptDefault)
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
