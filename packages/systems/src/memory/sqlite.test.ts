import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getDb,
  getMemoryDb,
  getRawSqlite,
  episodicMemoryGraphRepo,
  memoryRepo,
  resetDb,
  resetMemoryDb,
} from '@mas/db'
import {
  buildContextToShortTermPrompt,
  buildContextToShortTermSourceText,
  buildSemanticAnalyzerPrompt,
  buildShortTermToLongTermSourceText,
  buildShortTermToLongTermPrompt,
  MemorySqliteSystem,
  parseMemoryBatchWriteResponse,
  parseShortTermToLongTermResponse,
  resolveMemoryPipelineSettings,
  resolveMemorySqliteConfig,
} from './sqlite'
import { analyzeMemoryTimeText } from './time-parser'
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
    CREATE TABLE relationship_counterparts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE session_relationship_bindings (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      counterpart_id TEXT NOT NULL REFERENCES relationship_counterparts(id),
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
      detail: '用户养了一只叫橘子的猫',
      retrievalText: '用户曾告诉我，他养了一只名叫橘子的猫',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      tags: ['猫', '橘子', '宠物'],
      importance: 0.95,
      observedStartAt: new Date('2026-04-17T09:55:00.000Z'),
      observedEndAt: new Date('2026-04-17T10:00:00.000Z'),
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: '用户说自己晚上更有空',
      detail: '用户喜欢晚上聊天',
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
      retrievePrompt: '你是记忆语义分析器，只输出 retrieval_query。',
      fragmentPrompt: '以下是你可直接依赖的记忆，请优先从中回答。',
      embedder: createEmbedder({
        我猫叫什么: [1, 0],
        用户告诉过我的猫叫什么名字: [1, 0],
      }),
    })
    const ctx = createContext('我猫叫什么')

    await system.beforeTurn?.(ctx)
    assert.equal(ctx.pendingMemoryQuery?.kind, 'sqlite')
    assert.equal(ctx.pendingMemoryQuery?.timeAnalyzer.kind, 'llm')
    const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
    assert.equal(semanticAnalyzer?.kind, 'llm')
    assert.match(semanticAnalyzer?.prompt ?? '', /记忆语义分析器/)

    const retrieved = await ctx.pendingMemoryQuery?.retrieve({
      retrievalQuery: '用户告诉过我的猫叫什么名字',
      timeRange: null,
    })

    ctx.state.shortTermMemories = retrieved?.shortTerm ?? []
    ctx.state.fixedMemories = retrieved?.fixed ?? []
    ctx.state.memories = [...(retrieved?.shortTerm ?? []), ...(retrieved?.fixed ?? [])]
    await system.beforeLLM?.(ctx)

    const loaded = ctx.state.memories as Array<{ id: string; detail: string }>
    assert.deepEqual(loaded.map((memory) => memory.id), [catMemory.id])
    assert.equal(ctx.promptFragments[0]?.priority, 30)
    assert.match(ctx.promptFragments[0]?.content ?? '', /以下是你可直接依赖的记忆/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /短期最相关记忆：/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /固化记忆检索结果：未搜索到相关记忆/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /\[短期记忆\]/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /\[发生于 \d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2} - \d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}\]/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /橘子的猫/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory sqlite system keeps no-hit short-term and fixed fragments non-empty', { concurrency: false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-system-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const system = new MemorySqliteSystem({
      retrieveTopK: 5,
      embeddingModel: 'qwen/qwen3-embedding-0.6b',
      shortTermFragmentPrompt: '这些是本轮短期记忆包装文案。',
      fixedFragmentPrompt: '这些是本轮固化记忆包装文案。',
      embedder: createEmbedder({}),
    })
    const ctx = createContext('你还记得吗')
    ctx.state.shortTermMemories = []
    ctx.state.fixedMemories = []
    ctx.state.memories = []

    await system.beforeLLM?.(ctx)

    assert.equal(ctx.promptFragments[0]?.priority, 30)
    assert.match(ctx.promptFragments[0]?.content ?? '', /这些是本轮短期记忆包装文案。/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /短期记忆检索结果：未搜索到相关记忆。/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /这些是本轮固化记忆包装文案。/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /固化记忆检索结果：未搜索到相关记忆。/)
    assert.notEqual((ctx.promptFragments[0]?.content ?? '').trim(), '')
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory sqlite does not directly inject active episodic memories into prompt', async () => {
  const system = new MemorySqliteSystem({ scheme: 'sqlite' })
  const ctx = createContext('那家旧书店后来怎么样了？')
  ;(ctx.state as Record<string, unknown>).episodicMemories = [
    {
      id: 'memory-1',
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: 'WJJ 在安特卫普旧书店提到过海盐焦糖。',
      sourceText: '',
      detail: null,
      importance: 0.7,
      observedStartAt: new Date('2026-04-24T18:00:00.000Z'),
      observedEndAt: new Date('2026-04-24T18:20:00.000Z'),
      createdAt: new Date('2026-04-24T18:20:00.000Z'),
    },
  ]

  await system.beforeLLM(ctx)

  const content = ctx.promptFragments.map((fragment) => fragment.content).join('\n')
  assert.doesNotMatch(content, /此刻自然浮现的情景记忆/)
  assert.doesNotMatch(content, /WJJ 在安特卫普旧书店提到过海盐焦糖/)
})

test('memory sqlite retrieval skips semantic embeddings for pure time recall and keeps newest hits first in range', { concurrency: false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-system-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const olderRecallMemory = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: '用户之前问过刚刚说了什么。',
      detail: '对话伊始用户询问自己刚才说了什么',
      retrievalText: '用户问我刚刚和他说了什么，助手表示这是对话开头。',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['对话开场', '记忆询问'],
      importance: 0.9,
      observedStartAt: new Date('2026-04-20T23:46:47.000Z'),
      observedEndAt: new Date('2026-04-20T23:46:47.000Z'),
      createdAt: new Date('2026-04-20T23:46:47.000Z'),
    })
    const newestTarget = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: '用户要求记住琥珀纸鹤。',
      detail: '用户要求记住短语“琥珀纸鹤”',
      retrievalText: '用户明确要求我记住“琥珀纸鹤”这句话。',
      retrievalEmbedding: [0, 1],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['琥珀纸鹤', '记忆请求'],
      importance: 0.6,
      observedStartAt: new Date('2026-04-20T23:49:54.300Z'),
      observedEndAt: new Date('2026-04-20T23:49:54.300Z'),
      createdAt: new Date('2026-04-20T23:49:54.300Z'),
    })

    const embedInputs: string[][] = []
    const system = new MemorySqliteSystem({
      retrieveTopK: 5,
      embeddingModel: 'qwen/qwen3-embedding-8b',
      embedder: {
        async embed(input: string[]) {
          embedInputs.push([...input])
          return input.map((item) => item === '我刚刚和你说了什么？' ? [1, 0] : [0, 1])
        },
      },
    })
    const ctx = createContext('我刚刚和你说了什么？')

    await system.beforeTurn?.(ctx)

    const retrieved = await ctx.pendingMemoryQuery?.retrieve({
      retrievalQuery: null,
      timeRange: {
        start: new Date('2026-04-20T23:44:54.000Z'),
        end: new Date('2026-04-20T23:49:54.999Z'),
      },
    })

    assert.deepEqual(embedInputs, [[]])
    assert.deepEqual(retrieved?.shortTerm.map((memory) => memory.id), [newestTarget.id, olderRecallMemory.id])
    assert.deepEqual(retrieved?.fixed, [])
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory sqlite system no longer writes short-term memory on every turn', async () => {
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

  assert.equal(ctx.pendingMemoryWrite, undefined)
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
  assert.equal(ctx.pendingMemoryQuery?.timeAnalyzer.kind, 'llm')
  assert.equal(ctx.pendingMemoryQuery?.semanticAnalyzer.kind, 'llm')
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /retrieval_query/i)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /语义分析器/)
})

test('memory sqlite time analyzer prompt asks llm for retrieval time range only', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    summarizeModel: 'memory-model',
    embedder: createEmbedder({}),
  })
  const ctx = createContext('我昨天晚饭吃了什么？')

  await system.beforeTurn?.(ctx)

  const timeAnalyzer = ctx.pendingMemoryQuery?.timeAnalyzer
  assert.equal(timeAnalyzer?.kind, 'llm')
  if (!timeAnalyzer || timeAnalyzer.kind !== 'llm') {
    throw new Error('expected llm time analyzer')
  }
  assert.match(timeAnalyzer.prompt, /记忆系统的时间解析器/)
  assert.match(timeAnalyzer.prompt, /"time_range": \{"start": string, "end": string\} \| null/)
  assert.match(timeAnalyzer.prompt, /生活事件组合能形成自然范围/)
  assert.match(timeAnalyzer.prompt, /不要默认扩大成整天/)
  assert.match(timeAnalyzer.prompt, /不要输出检索关键词/)
  assert.match(timeAnalyzer.inputText, /当前时间：/)
  assert.match(timeAnalyzer.inputText, /最近对话（仅供补全当前问题）：/)
  assert.match(timeAnalyzer.inputText, /当前用户消息：\n我昨天晚饭吃了什么？/)
})

test('memory sqlite semantic analyzer prompt keeps retrieval query focused on topic anchors', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('你还记得我们聊的画面吗')

  await system.beforeTurn?.(ctx)

  const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
  assert.equal(semanticAnalyzer?.kind, 'llm')
  assert.match(semanticAnalyzer?.prompt ?? '', /retrieval_query/)
  assert.match(semanticAnalyzer?.prompt ?? '', /最短、最稳定、最能检索的主题锚点/)
  assert.match(semanticAnalyzer?.prompt ?? '', /最近对话只用于补全当前用户消息里的代词、省略、回指/)
  assert.match(semanticAnalyzer?.prompt ?? '', /最终只为当前用户消息生成 retrieval_query/)
  assert.match(semanticAnalyzer?.prompt ?? '', /如果当前用户消息本身已经自足，就忽略最近对话/)
  assert.match(semanticAnalyzer?.prompt ?? '', /如果历史里有多个可能指向、无法唯一补全，返回 "retrieval_query": null/)
  assert.match(semanticAnalyzer?.prompt ?? '', /一句短而完整的话/)
  assert.match(semanticAnalyzer?.prompt ?? '', /绝不能带时间信息|时间信息绝不进入 retrieval_query/)
  assert.match(semanticAnalyzer?.prompt ?? '', /不要把答案本身直接塞进 query/)
  assert.match(semanticAnalyzer?.prompt ?? '', /不要把历史里的额外主题顺手带进 query/)
  assert.match(semanticAnalyzer?.prompt ?? '', /画面、名字、餐食、食物、书、购买物、睡眠、bug、地点、关系或意象/)
  assert.match(semanticAnalyzer?.prompt ?? '', /那只猫叫什么名字.*我的生日是哪天.*登录 bug 是怎么修好的.*海边灯塔和红伞的画面是什么样的/)
  assert.match(semanticAnalyzer?.prompt ?? '', /对象、场景、画面、名字或事件类型/)
  assert.match(semanticAnalyzer?.prompt ?? '', /“画面”“场景”“名字”“地点”“餐食”“晚饭”“午饭”“早餐”“食物”“书”“买了什么”“睡眠”“bug”/)
  assert.match(semanticAnalyzer?.prompt ?? '', /“画面”“场景”“名字”“梦境”“氛围”/)
  assert.match(semanticAnalyzer?.prompt ?? '', /没有稳定主题锚点/)
  assert.match(semanticAnalyzer?.prompt ?? '', /它叫什么来着/)
  assert.match(semanticAnalyzer?.prompt ?? '', /我的生日是哪天/)
  assert.match(semanticAnalyzer?.prompt ?? '', /拿铁还是乌龙茶/)
  assert.match(semanticAnalyzer?.prompt ?? '', /“内容\/事情\/对话\/讨论”这类回顾外壳/)
  assert.doesNotMatch(semanticAnalyzer?.prompt ?? '', /通常就是一个名词或很短的名词短语/)
})

test('memory sqlite semantic analyzer input includes a short recent dialogue window and a separate current message section', async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('它叫什么来着')
  ctx.messages = [
    { role: 'system', content: '系统提示，不应该进入历史窗口。' },
    { role: 'user', content: '最早那条历史，也不应该保留。' },
    { role: 'assistant', content: '这条太早了，也不应该保留。' },
    { role: 'user', content: '我上周收养了一只猫。' },
    { role: 'assistant', content: '记住了，你上周收养了一只猫。' },
    { role: 'user', content: '它是橘白相间的。' },
    { role: 'assistant', content: [{ type: 'text', text: '收到，它是橘白相间的。' }] },
    { role: 'user', content: '我给它起名叫年糕。' },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'noop', input: {} },
        { type: 'text', text: '好的，我记住那只猫叫年糕。' },
      ],
    },
    { role: 'user', content: '它叫什么来着' },
  ]

  await system.beforeTurn?.(ctx)

  const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
  assert.equal(semanticAnalyzer?.kind, 'llm')
    assert.equal(
      semanticAnalyzer?.inputText,
      [
        '最近对话（仅供补全当前问题）：',
        '用户：我上周收养了一只猫。',
        '我：记住了，你上周收养了一只猫。',
        '用户：它是橘白相间的。',
        '我：收到，它是橘白相间的。',
        '用户：我给它起名叫年糕。',
        '我：好的，我记住那只猫叫年糕。',
        '',
        '当前用户消息：',
        '它叫什么来着',
    ].join('\n'),
  )
  assert.doesNotMatch(semanticAnalyzer?.inputText ?? '', /系统提示/)
  assert.doesNotMatch(semanticAnalyzer?.inputText ?? '', /最早那条历史/)
  assert.doesNotMatch(semanticAnalyzer?.inputText ?? '', /tool-1|noop/)
})

test('memory sqlite semantic analyzer history window length is configurable per persona', async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    semanticAnalyzerHistoryMessages: 2,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('它叫什么来着')
  ctx.messages = [
    { role: 'user', content: '我上周收养了一只猫。' },
    { role: 'assistant', content: '记住了，你上周收养了一只猫。' },
    { role: 'user', content: '它是橘白相间的。' },
    { role: 'assistant', content: '收到，它是橘白相间的。' },
    { role: 'user', content: '我给它起名叫年糕。' },
    { role: 'assistant', content: '好的，我记住那只猫叫年糕。' },
    { role: 'user', content: '它叫什么来着' },
  ]

  await system.beforeTurn?.(ctx)

  const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
  assert.equal(semanticAnalyzer?.kind, 'llm')
  if (!semanticAnalyzer || semanticAnalyzer.kind !== 'llm') {
    throw new Error('expected llm semantic analyzer')
  }
  assert.equal(
    semanticAnalyzer.inputText,
    [
      '最近对话（仅供补全当前问题）：',
      '用户：我给它起名叫年糕。',
      '我：好的，我记住那只猫叫年糕。',
      '',
      '当前用户消息：',
      '它叫什么来着',
    ].join('\n'),
  )
})

test('memory sqlite semantic analyzer uses named counterpart labels when the session is bound', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-system-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    getRawSqlite().exec(`
      UPDATE agents
      SET modules = '{"relationship":{"scheme":"named-multi-dim"}}'
      WHERE id = 'agent-1';
      INSERT INTO relationship_counterparts (id, agent_id, name) VALUES ('cp-zhangsan', 'agent-1', '张三');
      INSERT INTO session_relationship_bindings (session_id, counterpart_id) VALUES ('session-2', 'cp-zhangsan');
    `)

    const system = new MemorySqliteSystem({
      retrieveTopK: 5,
      semanticAnalyzerHistoryMessages: 4,
      embedder: createEmbedder({}),
    })
    const ctx = createContext('它叫什么来着')
    ctx.messages = [
      { role: 'user', content: '我上周收养了一只猫。' },
      { role: 'assistant', content: '记住了，你上周收养了一只猫。' },
      { role: 'user', content: '它是橘白相间的。' },
      { role: 'assistant', content: '收到，它是橘白相间的。' },
      { role: 'user', content: '它叫什么来着' },
    ]

    await system.beforeTurn?.(ctx)

    const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
    assert.equal(semanticAnalyzer?.kind, 'llm')
    if (!semanticAnalyzer || semanticAnalyzer.kind !== 'llm') {
      throw new Error('expected llm semantic analyzer')
    }
    assert.equal(
      semanticAnalyzer.inputText,
      [
        '最近对话（仅供补全当前问题）：',
        '张三：我上周收养了一只猫。',
        'Agent One：记住了，你上周收养了一只猫。',
        '张三：它是橘白相间的。',
        'Agent One：收到，它是橘白相间的。',
        '',
        '当前消息（来自张三）：',
        '它叫什么来着',
      ].join('\n'),
    )
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory sqlite retrieval uses per-layer topK and minSimilarity settings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-system-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)

    const shortTermTop1 = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: '短期记忆 1',
      detail: '短期记忆 1',
      retrievalText: '短期记忆 1',
      retrievalEmbedding: [0.95, Math.sqrt(1 - 0.95 ** 2)],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['短期'],
      importance: 0.9,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    const shortTermTop2 = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: '短期记忆 2',
      detail: '短期记忆 2',
      retrievalText: '短期记忆 2',
      retrievalEmbedding: [0.9, Math.sqrt(1 - 0.9 ** 2)],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['短期'],
      importance: 0.8,
      createdAt: new Date('2026-04-17T11:00:00.000Z'),
    })
    memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: '短期记忆 3',
      detail: '短期记忆 3',
      retrievalText: '短期记忆 3',
      retrievalEmbedding: [0.82, Math.sqrt(1 - 0.82 ** 2)],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['短期'],
      importance: 0.7,
      createdAt: new Date('2026-04-17T12:00:00.000Z'),
    })
    const fixedTop1 = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'fixed',
      sourceText: '固化记忆 1',
      detail: '固化记忆 1',
      retrievalText: '固化记忆 1',
      retrievalEmbedding: [0.96, Math.sqrt(1 - 0.96 ** 2)],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['固化'],
      importance: 0.9,
      createdAt: new Date('2026-04-17T10:00:00.000Z'),
    })
    const fixedTop2 = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'fixed',
      sourceText: '固化记忆 2',
      detail: '固化记忆 2',
      retrievalText: '固化记忆 2',
      retrievalEmbedding: [0.9, Math.sqrt(1 - 0.9 ** 2)],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['固化'],
      importance: 0.85,
      createdAt: new Date('2026-04-17T11:00:00.000Z'),
    })
    const fixedTop3 = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'fixed',
      sourceText: '固化记忆 3',
      detail: '固化记忆 3',
      retrievalText: '固化记忆 3',
      retrievalEmbedding: [0.84, Math.sqrt(1 - 0.84 ** 2)],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['固化'],
      importance: 0.8,
      createdAt: new Date('2026-04-17T12:00:00.000Z'),
    })
    memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'fixed',
      sourceText: '固化记忆 4',
      detail: '固化记忆 4',
      retrievalText: '固化记忆 4',
      retrievalEmbedding: [0.8, Math.sqrt(1 - 0.8 ** 2)],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['固化'],
      importance: 0.75,
      createdAt: new Date('2026-04-17T13:00:00.000Z'),
    })

    const system = new MemorySqliteSystem({
      retrieveTopK: 9,
      shortTermRetrieveTopK: 2,
      fixedRetrieveTopK: 4,
      shortTermMinSimilarity: 0.7,
      fixedMinSimilarity: 0.83,
      embedder: createEmbedder({
        你还记得吗: [1, 0],
        那只猫叫什么名字: [1, 0],
      }),
    })
    const ctx = createContext('你还记得吗')

    await system.beforeTurn?.(ctx)
    const retrieved = await ctx.pendingMemoryQuery?.retrieve({
      retrievalQuery: '那只猫叫什么名字',
      timeRange: null,
    })

    assert.deepEqual(retrieved?.shortTerm.map((memory) => memory.id), [shortTermTop1.id, shortTermTop2.id])
    assert.deepEqual(retrieved?.fixed.map((memory) => memory.id), [fixedTop1.id, fixedTop2.id, fixedTop3.id])
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory sqlite can suppress no-hit short-term and fixed fragments', async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    showNoHitMemoryFragments: false,
    shortTermFragmentPrompt: '这些是本轮短期记忆包装文案。',
    fixedFragmentPrompt: '这些是本轮固化记忆包装文案。',
    embedder: createEmbedder({}),
  })
  const ctx = createContext('你还记得吗')
  ctx.state.shortTermMemories = []
  ctx.state.fixedMemories = []
  ctx.state.memories = []

  await system.beforeLLM?.(ctx)

  assert.equal(ctx.promptFragments.length, 0)
})

test('memory sqlite retrieves active episodic memories as temporary short-term candidates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-system-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    const now = new Date()
    const entity = episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: 'Pippa长期记忆设计',
      confidence: 0.9,
      aliases: [],
      now,
    })
    const originalObservedAt = new Date(now.getTime() - 7 * 24 * 60 * 60_000)
    const memory = episodicMemoryGraphRepo.createEpisodicMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '王家骏和 Amadeus 讨论 Pippa 的长期记忆设计。',
      sourceText: 'source',
      detail: '王家骏和 Amadeus 讨论 Pippa 的长期记忆设计细节。',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'qwen/qwen3-embedding-0.6b',
      importance: 0.9,
      observedStartAt: originalObservedAt,
      observedEndAt: originalObservedAt,
      entityLinks: [{ entityId: entity.id, weight: 1 }],
      now,
    })
    episodicMemoryGraphRepo.activateEpisodicMemories({
      agentId: 'agent-1',
      memories: [{ memoryId: memory.id, score: 0.88 }],
      sourceToolName: 'search_long_term_memory',
      activatedAt: now,
      expiresAt: new Date(now.getTime() + 20 * 60_000),
    })

    const system = new MemorySqliteSystem({
      retrieveTopK: 5,
      embeddingModel: 'qwen/qwen3-embedding-0.6b',
      embedder: createEmbedder({
        继续说刚刚那个设计: [1, 0],
        Pippa长期记忆设计: [1, 0],
      }),
    })
    const ctx = createContext('继续说刚刚那个设计')

    await system.beforeTurn?.(ctx)
    const retrieved = await ctx.pendingMemoryQuery?.retrieve({
      retrievalQuery: 'Pippa长期记忆设计',
      timeRange: {
        start: new Date(now.getTime() - 60_000),
        end: new Date(now.getTime() + 60_000),
      },
    })

    assert.deepEqual(retrieved?.shortTerm.map((item) => item.id), [memory.id])
    assert.equal(retrieved?.shortTerm[0]?.layer, 'short_term')
    assert.equal(retrieved?.shortTerm[0]?.retrievalText, '王家骏和 Amadeus 讨论 Pippa 的长期记忆设计细节。')
    assert.deepEqual(retrieved?.fixed, [])

    ctx.state.shortTermMemories = retrieved?.shortTerm ?? []
    ctx.state.fixedMemories = retrieved?.fixed ?? []
    await system.beforeLLM?.(ctx)

    const content = ctx.promptFragments[0]?.content ?? ''
    assert.match(content, /短期最相关记忆：/)
    assert.match(content, /王家骏和 Amadeus 讨论 Pippa 的长期记忆设计细节。/)
    assert.doesNotMatch(content, /此刻自然浮现的情景记忆/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory sqlite renders short-term observed time and keeps fixed created time in prompt fragments', async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('昨天聊了什么')
  ctx.state.shortTermMemories = [
    {
      id: 'stm-observed',
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'source',
      detail: '用户昨晚吃了番茄鸡蛋面',
      retrievalText: '用户昨晚吃了番茄鸡蛋面。',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'model',
      tags: ['晚饭'],
      importance: 0.6,
      createdAt: new Date('2026-04-20T09:00:00.000Z'),
      observedStartAt: new Date('2026-04-19T18:00:00.000Z'),
      observedEndAt: new Date('2026-04-19T18:20:00.000Z'),
    },
    {
      id: 'stm-legacy',
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'source',
      detail: '旧短期记忆缺少 observed range',
      retrievalText: '旧短期记忆缺少 observed range。',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'model',
      tags: ['旧数据'],
      importance: 0.4,
      createdAt: new Date('2026-04-18T09:00:00.000Z'),
      observedStartAt: null,
      observedEndAt: null,
    },
  ]
  ctx.state.fixedMemories = [
    {
      id: 'fixed-created',
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'fixed',
      sourceText: 'source',
      detail: '用户偏好本地数据库',
      retrievalText: '用户偏好本地数据库。',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'model',
      tags: ['数据库'],
      importance: 0.9,
      createdAt: new Date('2026-04-17T09:00:00.000Z'),
      observedStartAt: null,
      observedEndAt: null,
    },
  ]

  await system.beforeLLM?.(ctx)

  const fragment = ctx.promptFragments[0]?.content ?? ''
  assert.match(fragment, /短期最相关记忆：\[短期记忆\]\[发生于 .+ - .+\] 用户昨晚吃了番茄鸡蛋面/)
  assert.match(fragment, /短期补充记忆：\[短期记忆\]\[时间未知\] 旧短期记忆缺少 observed range/)
  assert.match(fragment, /固化最相关记忆：\[固化记忆\]\[\d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}\] 用户偏好本地数据库/)
})

test('context-to-short-term source text carries observed window and message local times', () => {
  const sourceText = buildContextToShortTermSourceText([
    {
      role: 'user',
      content: '我昨晚吃了番茄鸡蛋面。',
      createdAt: new Date('2026-04-23T10:00:00.000Z'),
    },
    {
      role: 'assistant',
      content: '记住了。',
      createdAt: new Date('2026-04-23T10:01:00.000Z'),
    },
  ])

  assert.match(sourceText, /^待整理的旧上下文：\n整理窗口时间范围：.+ - .+\n/)
  assert.match(sourceText, /用户：\[.+\] 我昨晚吃了番茄鸡蛋面。/)
  assert.match(sourceText, /我：\[.+\] 记住了。/)
})

test('short-term to long-term source text prefers observed range over creation time', () => {
  const sourceText = buildShortTermToLongTermSourceText([
    {
      id: 'memory-1',
      agentId: 'agent-1',
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'source',
      detail: '用户昨晚吃了番茄鸡蛋面',
      retrievalText: '用户昨晚吃了番茄鸡蛋面。',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'model',
      tags: ['晚饭'],
      importance: 0.6,
      createdAt: new Date('2026-04-20T09:00:00.000Z'),
      observedStartAt: new Date('2026-04-19T18:00:00.000Z'),
      observedEndAt: new Date('2026-04-19T18:20:00.000Z'),
    },
  ])

  assert.match(sourceText, /"observedStartAt": "2026-04-19T18:00:00.000Z"/)
  assert.match(sourceText, /"observedEndAt": "2026-04-19T18:20:00.000Z"/)
  assert.doesNotMatch(sourceText, /"createdAt"/)
})

test('memory sqlite time parser recognizes explicit Chinese time expressions', () => {
  const reference = new Date('2026-04-22T20:24:17+02:00')

  assert.deepEqual(analyzeMemoryTimeText('今天下午我们聊了什么', reference), {
    timeRange: {
      start: new Date('2026-04-22T12:00:00'),
      end: new Date('2026-04-22T16:00:00'),
    },
  })
  assert.deepEqual(analyzeMemoryTimeText('前天上午聊的画面', reference), {
    timeRange: {
      start: new Date('2026-04-20T08:00:00'),
      end: new Date('2026-04-20T12:00:00'),
    },
  })
  assert.deepEqual(analyzeMemoryTimeText('上周六发生了什么', reference), {
    timeRange: {
      start: new Date('2026-04-18T00:00:00'),
      end: new Date('2026-04-18T23:59:59.999'),
    },
  })
  assert.deepEqual(analyzeMemoryTimeText('我刚刚和你说了什么', reference), {
    timeRange: {
      start: new Date('2026-04-22T20:19:17'),
      end: new Date('2026-04-22T20:29:17'),
    },
  })
  assert.deepEqual(analyzeMemoryTimeText('昨晚我们聊过什么', reference), {
    timeRange: {
      start: new Date('2026-04-21T16:00:00'),
      end: new Date('2026-04-21T20:00:00'),
    },
  })
  assert.deepEqual(analyzeMemoryTimeText('之前我们聊过吗', reference), {
    timeRange: null,
  })
})

test('memory sqlite uses legacy retrievePrompt as effective prompt for semantic analyzer', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrievePrompt: '统一记忆分析器 prompt',
    embedder: createEmbedder({}),
  })
  const ctx = createContext('之前我们聊过吗')

  await system.beforeTurn?.(ctx)

  const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
  assert.equal(semanticAnalyzer?.kind, 'llm')
  assert.equal(semanticAnalyzer?.prompt, '统一记忆分析器 prompt')
})

test('memory sqlite structured prompt overrides replace the default prompt directly', () => {
  const semanticPrompt = buildSemanticAnalyzerPrompt('只提取主题锚点')
  assert.equal(semanticPrompt, '只提取主题锚点')

  const contextPrompt = buildContextToShortTermPrompt('整理旧上下文', 2)
  assert.equal(contextPrompt, '整理旧上下文')

  const sleepPrompt = buildShortTermToLongTermPrompt('整理短期记忆', 2)
  assert.equal(sleepPrompt, '整理短期记忆')
})

test('context-to-short-term prompt writes detail for stage A and retrieval_text for display', () => {
  const prompt = buildContextToShortTermPrompt(null, 3)

  assert.match(prompt, /"detail": string/)
  assert.doesNotMatch(prompt, /"display_summary": string/)
  assert.match(prompt, /detail 字段不是展示摘要/)
  assert.match(prompt, /Stage A/)
  assert.match(prompt, /不参与 embedding/)
  assert.match(prompt, /原文 surface/)
  assert.match(prompt, /名字、简称、别称/)
  assert.match(prompt, /retrieval_text .*embedding/)
  assert.match(prompt, /retrieval_text .*UI 阅读/)
  assert.doesNotMatch(prompt, /display_summary 用简体中文，写成简洁、稳定、适合展示给模型看的记忆摘要。/)
})

test('memory sqlite config resolves per-layer retrieval settings and ignores legacy summarize/consolidate prompts', () => {
  const resolved = resolveMemorySqliteConfig({
    retrieveTopK: 7,
    embeddingProvider: 'openrouter',
    embeddingModel: 'memory-embed',
    summarizePrompt: '旧的 summarize prompt',
    consolidatePrompt: '旧的 consolidate prompt',
    semanticAnalyzerHistoryMessages: 9,
    longTermSearchDefaultTopK: 4,
    showNoHitMemoryFragments: false,
  })

  assert.equal(resolved.shortTermRetrieveTopK, 7)
  assert.equal(resolved.fixedRetrieveTopK, 7)
  assert.equal(resolved.embeddingProvider, 'openrouter')
  assert.equal(resolved.embeddingModel, 'memory-embed')
  assert.equal(resolved.shortTermMinSimilarity, 0.6)
  assert.equal(resolved.fixedMinSimilarity, 0.6)
  assert.equal(resolved.semanticAnalyzerHistoryMessages, 9)
  assert.equal(resolved.longTermSearchDefaultTopK, 4)
  assert.equal(resolved.showNoHitMemoryFragments, false)
  assert.equal('summarizePrompt' in resolved, false)
  assert.equal('consolidatePrompt' in resolved, false)
})

test('memory sqlite batch parser no longer requires tags', () => {
  const parsed = parseMemoryBatchWriteResponse(JSON.stringify({
    memories: [
      {
        detail: '原文说明用户叫王家骏，Stage A 应保留 surface“王家骏”。',
        retrieval_text: '用户告诉过我他的名字是王家骏',
        importance: 0.9,
      },
      {
        detail: '原文说明用户喜欢番茄鸡蛋面。',
        retrieval_text: '用户最喜欢的食物是番茄鸡蛋面',
        importance: 0.8,
      },
    ],
  }), 3)

  assert.deepEqual(parsed, [
    {
      detail: '原文说明用户叫王家骏，Stage A 应保留 surface“王家骏”。',
      retrievalText: '用户告诉过我他的名字是王家骏',
      importance: 0.9,
    },
    {
      detail: '原文说明用户喜欢番茄鸡蛋面。',
      retrievalText: '用户最喜欢的食物是番茄鸡蛋面',
      importance: 0.8,
    },
  ])
})

test('short-term to long-term parser keeps only candidates with valid source stm ids', () => {
  const parsed = parseShortTermToLongTermResponse(JSON.stringify({
    memories: [
      {
        detail: '原文说明用户小时候养过一只橘猫。',
        retrieval_text: '用户告诉过我他小时候养过一只橘猫。',
        importance: 0.8,
        source_stm_ids: ['stm-cat', 'stm-cat', 'missing'],
      },
      {
        detail: '缺少来源',
        retrieval_text: '这条没有合法来源。',
        importance: 0.5,
        source_stm_ids: ['missing'],
      },
    ],
  }), 5, new Set(['stm-cat']))

  assert.deepEqual(parsed, [
    {
      detail: '原文说明用户小时候养过一只橘猫。',
      retrievalText: '用户告诉过我他小时候养过一只橘猫。',
      importance: 0.8,
      sourceStmIds: ['stm-cat'],
    },
  ])
})

test('memory sqlite exposes default pipeline settings', () => {
  assert.deepEqual(resolveMemoryPipelineSettings({}), {
    contextWindowMessages: 50,
    contextOverflowBatchSize: 25,
    contextIdleFlushMinutes: 30,
    maxShortTermMemoriesPerFlush: 3,
    sleepEnabled: true,
    sleepTimeLocal: '03:00',
    sleepIntervalDays: 1,
  })
})

test('memory sqlite query parse allows pure time recall without retrieval query', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('你刚刚在干嘛')

  await system.beforeTurn?.(ctx)

  const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
  assert.equal(semanticAnalyzer?.kind, 'llm')
  const time = { timeRange: {
    start: new Date('2026-04-20T13:55:00+02:00'),
    end: new Date('2026-04-20T14:00:00+02:00'),
  } }
  const semantic = semanticAnalyzer?.parse(JSON.stringify({
    retrieval_query: null,
  }))
  const parsed = ctx.pendingMemoryQuery?.merge({
    time: time!,
    semantic: semantic!,
  })

  assert.deepEqual(parsed, {
    retrievalQuery: null,
    timeRange: {
      start: new Date('2026-04-20T13:55:00+02:00'),
      end: new Date('2026-04-20T14:00:00+02:00'),
    },
  })
})

test('memory sqlite query merge keeps parser-provided point windows unchanged', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('我刚刚和你说了什么')

  await system.beforeTurn?.(ctx)

  const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
  assert.equal(semanticAnalyzer?.kind, 'llm')
  const time = { timeRange: {
    start: new Date('2026-04-20T23:45:07+02:00'),
    end: new Date('2026-04-20T23:48:07+02:00'),
  } }
  const semantic = semanticAnalyzer?.parse(JSON.stringify({
    retrieval_query: null,
  }))
  const parsed = ctx.pendingMemoryQuery?.merge({
    time: time!,
    semantic: semantic!,
  })

  assert.deepEqual(parsed, {
    retrievalQuery: null,
    timeRange: {
      start: new Date('2026-04-20T23:45:07+02:00'),
      end: new Date('2026-04-20T23:48:07+02:00'),
    },
  })
})

test('memory sqlite query parse keeps semantic retrieval query when time and topic both matter', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('你昨天在修什么 bug')

  await system.beforeTurn?.(ctx)

  const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
  assert.equal(semanticAnalyzer?.kind, 'llm')
  const time = { timeRange: {
    start: new Date('2026-04-19T00:00:00+02:00'),
    end: new Date('2026-04-19T23:59:59+02:00'),
  } }
  const semantic = semanticAnalyzer?.parse(JSON.stringify({
    retrieval_query: '用户昨天提到的 bug 修复内容',
  }))
  const parsed = ctx.pendingMemoryQuery?.merge({
    time: time!,
    semantic: semantic!,
  })

  assert.deepEqual(parsed, {
    retrievalQuery: '用户昨天提到的 bug 修复内容',
    timeRange: {
      start: new Date('2026-04-19T00:00:00+02:00'),
      end: new Date('2026-04-19T23:59:59+02:00'),
    },
  })
})

test('memory sqlite semantic analyzer parse keeps cat-name completion for pronoun recall', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('它叫什么来着')
  ctx.messages = [
    { role: 'user', content: '我上周收养了一只猫。' },
    { role: 'assistant', content: '记住了。' },
    { role: 'user', content: '我给它起名叫年糕。' },
    { role: 'assistant', content: '好的。' },
    { role: 'user', content: '它叫什么来着' },
  ]

  await system.beforeTurn?.(ctx)

  const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
  assert.equal(semanticAnalyzer?.kind, 'llm')
  assert.deepEqual(semanticAnalyzer?.parse(JSON.stringify({
    retrieval_query: '那只猫叫什么名字',
  })), {
    retrievalQuery: '那只猫叫什么名字',
  })
})

test('memory sqlite semantic analyzer parse keeps birthday completion for omitted subject recall', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('我的是哪天来着')
  ctx.messages = [
    { role: 'user', content: '记一下，我生日是 9 月 17 日。' },
    { role: 'assistant', content: '记住了。' },
    { role: 'user', content: '明年我想办个海边生日聚会。' },
    { role: 'assistant', content: '好。' },
    { role: 'user', content: '我的是哪天来着' },
  ]

  await system.beforeTurn?.(ctx)

  const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
  assert.equal(semanticAnalyzer?.kind, 'llm')
  assert.deepEqual(semanticAnalyzer?.parse(JSON.stringify({
    retrieval_query: '我的生日是哪天',
  })), {
    retrievalQuery: '我的生日是哪天',
  })
})

test('memory sqlite semantic analyzer parse keeps event-object completion for omitted topic recall', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('最后是怎么修的来着')
  ctx.messages = [
    { role: 'user', content: '昨天那个登录 bug 终于修好了。' },
    { role: 'assistant', content: '太好了。' },
    { role: 'user', content: '最后是怎么修的来着' },
  ]

  await system.beforeTurn?.(ctx)

  const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
  assert.equal(semanticAnalyzer?.kind, 'llm')
  assert.deepEqual(semanticAnalyzer?.parse(JSON.stringify({
    retrieval_query: '登录 bug 是怎么修好的',
  })), {
    retrievalQuery: '登录 bug 是怎么修好的',
  })
})

test('memory sqlite semantic analyzer parse returns null for ambiguous preference alternatives', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('你还记得我喜欢那个吗')
  ctx.messages = [
    { role: 'user', content: '记一下，我喜欢拿铁。' },
    { role: 'assistant', content: '记住了。' },
    { role: 'user', content: '也记一下，我喜欢乌龙茶。' },
    { role: 'assistant', content: '也记住了。' },
    { role: 'user', content: '你还记得我喜欢那个吗' },
  ]

  await system.beforeTurn?.(ctx)

  const semanticAnalyzer = ctx.pendingMemoryQuery?.semanticAnalyzer
  assert.equal(semanticAnalyzer?.kind, 'llm')
  assert.deepEqual(semanticAnalyzer?.parse(JSON.stringify({
    retrieval_query: '用户喜欢拿铁还是乌龙茶',
  })), {
    retrievalQuery: null,
  })
})
