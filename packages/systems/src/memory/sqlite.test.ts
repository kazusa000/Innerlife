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
import {
  buildContextToShortTermPrompt,
  buildMemoryConsolidationPrompt,
  buildSemanticAnalyzerPrompt,
  buildShortTermToLongTermPrompt,
  buildSummaryPrompt,
  buildTimeAnalyzerPrompt,
  MemorySqliteSystem,
  parseMemoryBatchWriteResponse,
  resolveMemoryPipelineSettings,
} from './sqlite'
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
      retrievePrompt: '你是记忆语义分析器，只输出 retrieval_query、time_range、focus。',
      fragmentPrompt: '以下是你可直接依赖的记忆，请优先从中回答。',
      embedder: createEmbedder({
        我猫叫什么: [1, 0],
        用户告诉过我的猫叫什么名字: [1, 0],
      }),
    })
    const ctx = createContext('我猫叫什么')

    await system.beforeTurn?.(ctx)
    assert.equal(ctx.pendingMemoryQuery?.kind, 'sqlite')
    assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /记忆语义分析器/)
    assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /记忆语义分析器/)

    const retrieved = await ctx.pendingMemoryQuery?.retrieve({
      retrievalQuery: '用户告诉过我的猫叫什么名字',
      timeRange: null,
      focus: '猫的名字',
    })

    ctx.state.shortTermMemories = retrieved?.shortTerm ?? []
    ctx.state.fixedMemories = retrieved?.fixed ?? []
    ctx.state.memories = [...(retrieved?.shortTerm ?? []), ...(retrieved?.fixed ?? [])]
    await system.beforeLLM?.(ctx)

    const loaded = ctx.state.memories as Array<{ id: string; displaySummary: string }>
    assert.deepEqual(loaded.map((memory) => memory.id), [catMemory.id])
    assert.equal(ctx.promptFragments[0]?.priority, 30)
    assert.match(ctx.promptFragments[0]?.content ?? '', /以下是你可直接依赖的记忆/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /短期最相关记忆：/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /固化记忆检索结果：未搜索到相关记忆/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /\[短期记忆\]/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}\]/)
    assert.match(ctx.promptFragments[0]?.content ?? '', /橘子的猫/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
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
      displaySummary: '对话伊始用户询问自己刚才说了什么',
      retrievalText: '用户问我刚刚和他说了什么，助手表示这是对话开头。',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['对话开场', '记忆询问'],
      importance: 0.9,
      createdAt: new Date('2026-04-20T23:46:47.000Z'),
    })
    const newestTarget = memoryRepo.addMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      sourceText: '用户要求记住琥珀纸鹤。',
      displaySummary: '用户要求记住短语“琥珀纸鹤”',
      retrievalText: '用户明确要求我记住“琥珀纸鹤”这句话。',
      retrievalEmbedding: [0, 1],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['琥珀纸鹤', '记忆请求'],
      importance: 0.6,
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
      focus: '用户刚刚说过的话',
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
    summarizePrompt: '请把这一轮对话整理成 display_summary、retrieval_text、tags、importance。',
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
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /time_range/i)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /时间分析器/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /retrieval_query/i)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /语义分析器/)
})

test('memory sqlite time analyzer prompt guides pure recent-utterance recall toward time-only retrieval', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    summarizeModel: 'memory-model',
    embedder: createEmbedder({}),
  })
  const ctx = createContext('我刚刚和你说了什么')

  await system.beforeTurn?.(ctx)

  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /time_range/)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /电脑当前的本地时间/)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /短时间窗口/)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /不要返回未来时间/)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /最近一个已经结束的过去时段/)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /“今天”表示当前本地自然日/)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /“昨天”表示前一个本地自然日/)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /上午=06:00-11:59/)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /如果用户没有表达时间意图/)
})

test('memory sqlite semantic analyzer prompt keeps retrieval query focused on topic anchors', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('你还记得我们聊的画面吗')

  await system.beforeTurn?.(ctx)

  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /retrieval_query/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /最短、最稳定、最能检索的主题锚点/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /时间信息绝不进入 retrieval_query/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /画面、名字、食物、bug、地点、关系或意象/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /猫名字.*bug 修复.*海边灯塔画面/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /对象、场景、画面、名字或事件类型/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /focus 只能补充说明，不能替代 retrieval_query/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /“画面”“场景”“名字”“地点”“食物”“bug”/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /“画面”“场景”“名字”“梦境”“氛围”/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /没有稳定主题锚点/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /中文提问就用中文/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /“内容\/事情\/对话\/讨论”这类回顾外壳/)
})

test('memory sqlite time analyzer prompt treats broad prior-interaction recall as time intent', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('之前我们聊过吗')

  await system.beforeTurn?.(ctx)

  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /泛指过去互动、先前对话、此前提到过的事/)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /非空 time_range，不要返回 null/)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /不要贴近当前时间到只剩几秒或几分钟/)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /不要仅因为“记得\/聊过\/提到过”就补一个 time_range/)
})

test('memory sqlite uses legacy retrievePrompt as effective prompt for both analyzers', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrievePrompt: '统一记忆分析器 prompt',
    embedder: createEmbedder({}),
  })
  const ctx = createContext('之前我们聊过吗')

  await system.beforeTurn?.(ctx)

  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /统一记忆分析器 prompt/)
  assert.match(ctx.pendingMemoryQuery?.timeAnalyzer.prompt ?? '', /请严格返回 json/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /统一记忆分析器 prompt/)
  assert.match(ctx.pendingMemoryQuery?.semanticAnalyzer.prompt ?? '', /请严格返回 json/)
})

test('memory sqlite structured prompt overrides keep required json contract', () => {
  const timePrompt = buildTimeAnalyzerPrompt('只提取时间范围')
  assert.match(timePrompt, /^只提取时间范围/)
  assert.match(timePrompt, /请严格返回 json/)
  assert.match(timePrompt, /"time_range"/)

  const semanticPrompt = buildSemanticAnalyzerPrompt('只提取主题锚点')
  assert.match(semanticPrompt, /^只提取主题锚点/)
  assert.match(semanticPrompt, /请严格返回 json/)
  assert.match(semanticPrompt, /"retrieval_query"/)
  assert.match(semanticPrompt, /"focus"/)

  const summaryPrompt = buildSummaryPrompt('整理成记忆')
  assert.match(summaryPrompt, /^整理成记忆/)
  assert.match(summaryPrompt, /请严格返回 json/)
  assert.match(summaryPrompt, /"display_summary"/)
  assert.match(summaryPrompt, /importance/)

  const contextPrompt = buildContextToShortTermPrompt('整理旧上下文', 2)
  assert.match(contextPrompt, /^整理旧上下文/)
  assert.match(contextPrompt, /请严格返回 json/)
  assert.match(contextPrompt, /最多 2 条短期记忆/)
  assert.match(contextPrompt, /"memories"/)

  const sleepPrompt = buildShortTermToLongTermPrompt('整理短期记忆', 2)
  assert.match(sleepPrompt, /^整理短期记忆/)
  assert.match(sleepPrompt, /请严格返回 json/)
  assert.match(sleepPrompt, /最多 2 条长期记忆/)
  assert.match(sleepPrompt, /"memories"/)

  const consolidatePrompt = buildMemoryConsolidationPrompt('整理重复记忆')
  assert.match(consolidatePrompt, /^整理重复记忆/)
  assert.match(consolidatePrompt, /请严格返回 json/)
  assert.match(consolidatePrompt, /"actions"/)
})

test('memory sqlite batch parser returns up to configured number of short-term memories', () => {
  const parsed = parseMemoryBatchWriteResponse(JSON.stringify({
    memories: [
      {
        display_summary: '用户叫王家骏',
        retrieval_text: '用户告诉过我他的名字是王家骏',
        tags: ['名字', '称呼', '身份', '王家骏'],
        importance: 0.9,
      },
      {
        display_summary: '用户喜欢番茄鸡蛋面',
        retrieval_text: '用户最喜欢的食物是番茄鸡蛋面',
        tags: ['食物', '偏好'],
        importance: 0.8,
      },
    ],
  }), 3)

  assert.deepEqual(parsed, [
    {
      displaySummary: '用户叫王家骏',
      retrievalText: '用户告诉过我他的名字是王家骏',
      tags: ['名字', '称呼', '身份', '王家骏'],
      importance: 0.9,
    },
    {
      displaySummary: '用户喜欢番茄鸡蛋面',
      retrievalText: '用户最喜欢的食物是番茄鸡蛋面',
      tags: ['食物', '偏好'],
      importance: 0.8,
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

  const time = ctx.pendingMemoryQuery?.timeAnalyzer.parse(JSON.stringify({
    time_range: {
      start: '2026-04-20T13:55:00+02:00',
      end: '2026-04-20T14:00:00+02:00',
    },
  }))
  const semantic = ctx.pendingMemoryQuery?.semanticAnalyzer.parse(JSON.stringify({
    retrieval_query: null,
    focus: '刚才在做什么',
  }))
  const parsed = ctx.pendingMemoryQuery?.merge({
    time: time!,
    semantic: semantic!,
  })

  assert.deepEqual(parsed, {
    retrievalQuery: null,
    timeRange: {
      start: new Date('2026-04-20T13:55:00+02:00'),
      end: new Date('2026-04-20T14:00:00.999+02:00'),
    },
    focus: '刚才在做什么',
  })
})

test('memory sqlite query parse expands second-precision end timestamps to include the full second', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('我刚刚和你说了什么')

  await system.beforeTurn?.(ctx)

  const time = ctx.pendingMemoryQuery?.timeAnalyzer.parse(JSON.stringify({
    time_range: {
      start: '2026-04-20T23:45:07+02:00',
      end: '2026-04-20T23:48:07+02:00',
    },
  }))
  const semantic = ctx.pendingMemoryQuery?.semanticAnalyzer.parse(JSON.stringify({
    retrieval_query: null,
    focus: '用户刚刚说过的话',
  }))
  const parsed = ctx.pendingMemoryQuery?.merge({
    time: time!,
    semantic: semantic!,
  })

  assert.deepEqual(parsed, {
    retrievalQuery: null,
    timeRange: {
      start: new Date('2026-04-20T23:45:07+02:00'),
      end: new Date('2026-04-20T23:48:07.999+02:00'),
    },
    focus: '用户刚刚说过的话',
  })
})

test('memory sqlite query parse keeps semantic retrieval query when time and topic both matter', { concurrency: false }, async () => {
  const system = new MemorySqliteSystem({
    retrieveTopK: 5,
    embedder: createEmbedder({}),
  })
  const ctx = createContext('你昨天在修什么 bug')

  await system.beforeTurn?.(ctx)

  const time = ctx.pendingMemoryQuery?.timeAnalyzer.parse(JSON.stringify({
    time_range: {
      start: '2026-04-19T00:00:00+02:00',
      end: '2026-04-19T23:59:59+02:00',
    },
  }))
  const semantic = ctx.pendingMemoryQuery?.semanticAnalyzer.parse(JSON.stringify({
    retrieval_query: '用户昨天提到的 bug 修复内容',
    focus: 'bug 修复',
  }))
  const parsed = ctx.pendingMemoryQuery?.merge({
    time: time!,
    semantic: semantic!,
  })

  assert.deepEqual(parsed, {
    retrievalQuery: '用户昨天提到的 bug 修复内容',
    timeRange: {
      start: new Date('2026-04-19T00:00:00+02:00'),
      end: new Date('2026-04-19T23:59:59.999+02:00'),
    },
    focus: 'bug 修复',
  })
})
