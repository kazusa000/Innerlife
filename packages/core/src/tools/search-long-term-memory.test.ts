import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  agentRepo,
  bootstrapAppDatabases,
  episodicMemoryGraphRepo,
  memoryRepo,
  resetDb,
  resetMemoryDb,
  sessionRepo,
} from '@mas/db'
import { SearchLongTermMemoryTool } from './search-long-term-memory'

function bootstrap(dbPath: string, memoryDbPath: string) {
  process.env.MAS_MEMORY_DB_PATH = memoryDbPath
  resetDb()
  resetMemoryDb()
  bootstrapAppDatabases({ dbPath, memoryDbPath })
}

test('search_long_term_memory prefers semantic analyzer sentence and weighted matching over keyword bag query', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-search-ltm-tool-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.OPENROUTER_API_KEY

  try {
    process.env.OPENROUTER_API_KEY = 'test-key'
    bootstrap(dbPath, memoryDbPath)

    const agent = agentRepo.createAgent({
      name: 'Hazel',
      provider: 'openrouter',
      model: 'qwen/qwen3.5-flash-02-23',
      modules: {
        memory: {
          scheme: 'sqlite',
          embeddingModel: 'qwen/qwen3-embedding-8b',
        },
      },
    })
    const session = sessionRepo.createSession(agent.id, 'seed')

    memoryRepo.addMemory({
      agentId: agent.id,
      sessionId: session.id,
      layer: 'long_term',
      sourceText: '用户养过一只叫南瓜的猫。',
      displaySummary: '用户养过一只叫南瓜的猫。',
      retrievalText: '用户养过一只叫南瓜的猫。',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['猫'],
      importance: 0.7,
    })
    memoryRepo.addMemory({
      agentId: agent.id,
      sessionId: session.id,
      layer: 'long_term',
      sourceText: '用户修复过登录 bug。',
      displaySummary: '用户修复过登录 bug。',
      retrievalText: '用户修复过登录 bug。',
      retrievalEmbedding: [0, 1],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      tags: ['bug'],
      importance: 0.9,
    })

    globalThis.fetch = (async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { input?: string[] } : {}
      const embeddings = (body.input ?? []).map((text) => {
        if (text === '我们养的那只猫叫什么名字') {
          return { embedding: [1, 0] }
        }
        if (text === '猫 宠物 名字') {
          return { embedding: [0, 1] }
        }
        return { embedding: [0, 0] }
      })
      return Response.json({
        data: embeddings.map((item, index) => ({ ...item, index })),
      })
    }) as typeof fetch

    const result = await SearchLongTermMemoryTool.call(
      { query: '猫 宠物 名字' },
      {
        agentId: agent.id,
        sessionId: session.id,
        memoryRetrievalQuery: '我们养的那只猫叫什么名字',
      },
    )

    assert.equal(result.metadata?.noResults, false)
    assert.match(result.output, /南瓜/)
    assert.deepEqual(result.metadata?.effectiveQueries, [
      { source: 'semantic_analyzer', query: '我们养的那只猫叫什么名字', weight: 0.8 },
      { source: 'tool_input', query: '猫 宠物 名字', weight: 0.2 },
    ])
  } finally {
    globalThis.fetch = originalFetch
    process.env.OPENROUTER_API_KEY = originalApiKey
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('search_long_term_memory recalls episodic memories through entity activation when graph data exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-search-ltm-tool-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Hazel',
      provider: 'openrouter',
      model: 'qwen/qwen3.5-flash-02-23',
      modules: { memory: { scheme: 'sqlite' } },
    })
    const session = sessionRepo.createSession(agent.id, 'seed')
    const now = new Date('2026-04-30T09:00:00.000Z')
    const wjj = episodicMemoryGraphRepo.createEntity({
      agentId: agent.id,
      type: 'person',
      canonicalName: 'WJJ',
      confidence: 0.95,
      aliases: [],
      now,
    })
    const bookstore = episodicMemoryGraphRepo.createEntity({
      agentId: agent.id,
      type: 'place',
      canonicalName: '安特卫普旧书店',
      confidence: 0.9,
      aliases: [{ alias: '旧书店', confidence: 0.8 }],
      now,
    })
    const caramel = episodicMemoryGraphRepo.createEntity({
      agentId: agent.id,
      type: 'object',
      canonicalName: '海盐焦糖',
      confidence: 0.9,
      aliases: [],
      now,
    })
    episodicMemoryGraphRepo.createEpisodicMemory({
      agentId: agent.id,
      sessionId: session.id,
      summary: 'WJJ 在安特卫普旧书店提到过海盐焦糖。',
      sourceText: 'WJJ：旧书店那次我买了海盐焦糖。',
      sourceQuote: '旧书店那次我买了海盐焦糖',
      importance: 0.72,
      observedStartAt: now,
      observedEndAt: now,
      entityLinks: [
        { entityId: wjj.id, weight: 0.8 },
        { entityId: bookstore.id, weight: 1 },
        { entityId: caramel.id, weight: 0.7 },
      ],
      now,
    })

    const result = await SearchLongTermMemoryTool.call(
      { query: '旧书店' },
      { agentId: agent.id, sessionId: session.id },
    )

    assert.equal(result.isError, undefined)
    assert.match(result.output, /情景记忆/)
    assert.match(result.output, /WJJ 在安特卫普旧书店提到过海盐焦糖/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('search_long_term_memory uses persona default top_k when the tool input omits it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-search-ltm-tool-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.OPENROUTER_API_KEY

  try {
    process.env.OPENROUTER_API_KEY = 'test-key'
    bootstrap(dbPath, memoryDbPath)

    const agent = agentRepo.createAgent({
      name: 'Hazel',
      provider: 'openrouter',
      model: 'qwen/qwen3.5-flash-02-23',
      modules: {
        memory: {
          scheme: 'sqlite',
          embeddingModel: 'qwen/qwen3-embedding-8b',
          longTermSearchDefaultTopK: 5,
        },
      },
    })
    const session = sessionRepo.createSession(agent.id, 'seed')

    for (let index = 0; index < 5; index += 1) {
      memoryRepo.addMemory({
        agentId: agent.id,
        sessionId: session.id,
        layer: 'long_term',
        sourceText: `用户养过第 ${index + 1} 只猫。`,
        displaySummary: `用户养过第 ${index + 1} 只猫。`,
        retrievalText: `用户养过第 ${index + 1} 只猫。`,
        retrievalEmbedding: [1, 0],
        retrievalModel: 'qwen/qwen3-embedding-8b',
        tags: ['猫'],
        importance: 1 - index * 0.1,
      })
    }

    globalThis.fetch = (async () => Response.json({
      data: [{ embedding: [1, 0], index: 0 }],
    })) as typeof fetch

    const result = await SearchLongTermMemoryTool.call(
      { query: '那只猫叫什么名字' },
      {
        agentId: agent.id,
        sessionId: session.id,
        memoryRetrievalQuery: '那只猫叫什么名字',
      },
    )

    assert.equal(result.metadata?.noResults, false)
    assert.equal(Array.isArray(result.metadata?.hits), true)
    assert.equal((result.metadata?.hits as unknown[]).length, 5)
  } finally {
    globalThis.fetch = originalFetch
    process.env.OPENROUTER_API_KEY = originalApiKey
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
