import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  agentRepo,
  bootstrapAppDatabases,
  episodicMemoryGraphRepo,
  getMemoryRawSqlite,
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
      detail: '用户养过一只叫南瓜的猫。',
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
      detail: '用户修复过登录 bug。',
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

test('search_long_term_memory does not graph recall without extracted entity mentions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-search-ltm-tool-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')
  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.OPENROUTER_API_KEY

  try {
    process.env.OPENROUTER_API_KEY = 'test-key'
    globalThis.fetch = (async () => Response.json({
      data: [{ embedding: [0, 0], index: 0 }],
    })) as typeof fetch
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Hazel',
      provider: 'openrouter',
      model: 'qwen/qwen3.5-flash-02-23',
      modules: { memory: { scheme: 'sqlite', entityMentionPrompt: '自定义实体 mention prompt' } },
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
      detail: '旧书店那次我买了海盐焦糖',
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

    assert.equal(result.isError, false)
    assert.equal(result.metadata?.noResults, true)
    assert.doesNotMatch(result.output, /情景记忆/)
    assert.doesNotMatch(result.output, /WJJ 在安特卫普旧书店提到过海盐焦糖/)
  } finally {
    globalThis.fetch = originalFetch
    process.env.OPENROUTER_API_KEY = originalApiKey
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('search_long_term_memory extracts entity mentions before graph recall', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-search-ltm-tool-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Hazel',
      provider: 'openrouter',
      model: 'qwen/qwen3.5-flash-02-23',
      modules: { memory: { scheme: 'sqlite', entityMentionPrompt: '自定义实体 mention prompt' } },
    })
    const session = sessionRepo.createSession(agent.id, 'seed')
    const now = new Date('2026-04-30T09:00:00.000Z')
    const bookstore = episodicMemoryGraphRepo.createEntity({
      agentId: agent.id,
      type: 'place',
      canonicalName: '安特卫普旧书店',
      confidence: 0.9,
      aliases: [],
      now,
    })
    const coffee = episodicMemoryGraphRepo.createEntity({
      agentId: agent.id,
      type: 'object',
      canonicalName: '焦糖咖啡',
      confidence: 0.9,
      aliases: [],
      now,
    })
    episodicMemoryGraphRepo.createEpisodicMemory({
      agentId: agent.id,
      sessionId: session.id,
      summary: 'WJJ 在安特卫普旧书店边喝焦糖咖啡边复盘 memory v2。',
      sourceText: '',
      detail: null,
      importance: 0.8,
      observedStartAt: now,
      observedEndAt: now,
      entityLinks: [
        { entityId: bookstore.id, weight: 1 },
        { entityId: coffee.id, weight: 0.8 },
      ],
      now,
    })

    let sawMentionPrompt = false
    const provider = {
      async sendMessage(input: { systemPrompt: string }) {
        sawMentionPrompt = input.systemPrompt === '自定义实体 mention prompt'
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            mentions: [
              { surface: '安特卫普旧书店', type: 'place', context_hint: '旧书店地点', confidence: 0.9 },
              { surface: '焦糖咖啡', type: 'object', context_hint: '饮品', confidence: 0.9 },
            ],
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const result = await SearchLongTermMemoryTool.call(
      { query: '那家店和焦糖饮料有什么关系？' },
      { agentId: agent.id, sessionId: session.id, provider },
    )

    assert.equal(sawMentionPrompt, true)
    assert.equal(result.metadata?.noResults, false)
    assert.equal(result.metadata?.mode, 'episodic_hybrid')
    assert.match(result.output, /WJJ 在安特卫普旧书店边喝焦糖咖啡边复盘 memory v2/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('search_long_term_memory fuses entity graph and episodic text embedding recall', async () => {
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
    const now = new Date('2026-04-30T09:00:00.000Z')
    const game = episodicMemoryGraphRepo.createEntity({
      agentId: agent.id,
      type: 'object',
      canonicalName: '游戏',
      confidence: 0.8,
      aliases: [],
      now,
    })
    const sc2 = episodicMemoryGraphRepo.createEntity({
      agentId: agent.id,
      type: 'object',
      canonicalName: '星际争霸2',
      confidence: 0.9,
      aliases: [{ alias: 'SC2', confidence: 0.9 }],
      now,
    })
    episodicMemoryGraphRepo.createEpisodicMemory({
      agentId: agent.id,
      sessionId: session.id,
      summary: 'WJJ 说游戏这个类别不能和喜欢的游戏混成一个实体。',
      sourceText: '',
      detail: '游戏和喜欢的游戏不是同一个实体',
      retrievalEmbedding: [0, 1],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      importance: 0.5,
      observedStartAt: now,
      observedEndAt: now,
      entityLinks: [{ entityId: game.id, weight: 1 }],
      now,
    })
    episodicMemoryGraphRepo.createEpisodicMemory({
      agentId: agent.id,
      sessionId: session.id,
      summary: 'WJJ 后来说现在最喜欢的游戏是星际争霸2。',
      sourceText: '',
      detail: '现在最喜欢的游戏是星际争霸2',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      importance: 0.9,
      observedStartAt: now,
      observedEndAt: now,
      entityLinks: [{ entityId: sc2.id, weight: 1 }],
      now,
    })

    globalThis.fetch = (async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { input?: string[] } : {}
      const data = (body.input ?? []).map((text, index) => ({
        index,
        embedding: text.includes('星际争霸2') ? [1, 0] : [0, 1],
      }))
      return Response.json({ data })
    }) as typeof fetch

    const provider = {
      async sendMessage(input: { systemPrompt: string }) {
        if (input.systemPrompt.includes('实体 mention')) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              mentions: [
                { surface: '游戏', type: 'object', context_hint: '泛化类别词', confidence: 0.85 },
              ],
            }) }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        }
        assert.match(input.systemPrompt, /retrieval_query/)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            retrieval_query: 'WJJ 现在最喜欢的游戏是星际争霸2',
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const result = await SearchLongTermMemoryTool.call(
      { query: '我现在最喜欢的游戏是什么？', top_k: 1 },
      { agentId: agent.id, sessionId: session.id, provider },
    )

    assert.equal(result.metadata?.noResults, false)
    assert.equal(result.metadata?.mode, 'episodic_hybrid')
    assert.equal(result.metadata?.textQuery, 'WJJ 现在最喜欢的游戏是星际争霸2')
    assert.match(result.output, /现在最喜欢的游戏是星际争霸2/)
    assert.doesNotMatch(result.output, /类别不能和喜欢的游戏/)
    assert.equal(
      getMemoryRawSqlite().prepare(`
        SELECT 1 AS value
        FROM sqlite_master
        WHERE type = 'table' AND name = 'memory_entity_activations'
      `).get(),
      undefined,
    )
  } finally {
    globalThis.fetch = originalFetch
    process.env.OPENROUTER_API_KEY = originalApiKey
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('search_long_term_memory backfills missing episodic embeddings from summaries before text recall', async () => {
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
      modules: { memory: { scheme: 'sqlite', embeddingModel: 'qwen/qwen3-embedding-8b' } },
    })
    const session = sessionRepo.createSession(agent.id, 'seed')
    episodicMemoryGraphRepo.createEpisodicMemory({
      agentId: agent.id,
      sessionId: session.id,
      summary: 'WJJ 现在最喜欢的游戏是星际2。',
      sourceText: '',
      detail: '完整情景：WJJ 说现在最喜欢的游戏是星际2，也就是星际争霸2。',
      retrievalEmbedding: [],
      retrievalModel: '',
      importance: 0.9,
      observedStartAt: null,
      observedEndAt: null,
      entityLinks: [],
      now: new Date('2026-04-30T09:00:00.000Z'),
    })

    const embeddingBatches: string[][] = []
    globalThis.fetch = (async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { input?: string[]; encoding_format?: string } : {}
      embeddingBatches.push(body.input ?? [])
      return Response.json({
        data: (body.input ?? []).map((_, index) => ({ index, embedding: [1, 0] })),
      })
    }) as typeof fetch

    const provider = {
      async sendMessage() {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            retrieval_query: 'WJJ 现在最喜欢的游戏是星际2',
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const result = await SearchLongTermMemoryTool.call(
      { query: '我现在最喜欢的游戏是什么？', top_k: 1 },
      { agentId: agent.id, sessionId: session.id, provider },
    )

    assert.deepEqual(embeddingBatches[0], ['WJJ 现在最喜欢的游戏是星际2。'])
    assert.equal(result.metadata?.noResults, false)
    assert.match(result.output, /完整情景：WJJ 说现在最喜欢的游戏是星际2/)
    assert.deepEqual(
      getMemoryRawSqlite().prepare(`
        SELECT retrieval_embedding, retrieval_model
        FROM episodic_memories
      `).get(),
      {
        retrieval_embedding: '[1,0]',
        retrieval_model: 'qwen/qwen3-embedding-8b',
      },
    )
  } finally {
    globalThis.fetch = originalFetch
    process.env.OPENROUTER_API_KEY = originalApiKey
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('search_long_term_memory gives recent context to entity mention extraction for pronoun resolution', async () => {
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
      modules: { memory: { scheme: 'sqlite', embeddingModel: 'qwen/qwen3-embedding-8b' } },
    })
    const session = sessionRepo.createSession(agent.id, 'seed')
    const now = new Date('2026-04-30T09:00:00.000Z')
    const sc2 = episodicMemoryGraphRepo.createEntity({
      agentId: agent.id,
      type: 'object',
      canonicalName: '星际争霸2',
      confidence: 0.9,
      aliases: [{ alias: '星际2', confidence: 0.9 }],
      now,
    })
    episodicMemoryGraphRepo.createEpisodicMemory({
      agentId: agent.id,
      sessionId: session.id,
      summary: 'WJJ 说星际2是自己喜欢的游戏。',
      sourceText: '',
      detail: '完整情景：WJJ 说星际2是自己喜欢的游戏，并说明星际2就是星际争霸2。',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'qwen/qwen3-embedding-8b',
      importance: 0.9,
      observedStartAt: now,
      observedEndAt: now,
      entityLinks: [{ entityId: sc2.id, weight: 1 }],
      now,
    })

    globalThis.fetch = (async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { input?: string[] } : {}
      return Response.json({
        data: (body.input ?? []).map((_, index) => ({ index, embedding: [1, 0] })),
      })
    }) as typeof fetch

    let mentionInput = ''
    const provider = {
      async sendMessage(input: any) {
        if (input.systemPrompt.includes('实体 mention')) {
          mentionInput = input.messages[0]?.content[0]?.text ?? ''
          assert.match(mentionInput, /最近对话/)
          assert.match(mentionInput, /我最近又开始玩星际2了/)
          assert.match(mentionInput, /当前检索问题/)
          assert.match(mentionInput, /那个游戏我之前怎么说的/)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              mentions: [
                {
                  surface: '星际2',
                  type: 'object',
                  context_hint: '当前问题里的“那个游戏”指最近对话中的星际2',
                  confidence: 0.92,
                },
              ],
            }) }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            retrieval_query: '星际2是喜欢的游戏',
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const result = await SearchLongTermMemoryTool.call(
      { query: '那个游戏我之前怎么说的？', top_k: 1 },
      {
        agentId: agent.id,
        sessionId: session.id,
        provider,
        recentMessages: [
          { role: 'user', content: [{ type: 'text', text: '我最近又开始玩星际2了。' }] },
          { role: 'assistant', content: [{ type: 'text', text: '你之前也提到过这个游戏。' }] },
          { role: 'user', content: [{ type: 'text', text: '那个游戏我之前怎么说的？' }] },
        ],
      },
    )

    assert.match(mentionInput, /星际2/)
    assert.equal(result.metadata?.noResults, false)
    assert.match(result.output, /完整情景：WJJ 说星际2是自己喜欢的游戏/)
    assert.doesNotMatch(result.output, /WJJ 喜欢 星际2 星际争霸2/)
  } finally {
    globalThis.fetch = originalFetch
    process.env.OPENROUTER_API_KEY = originalApiKey
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
        detail: `用户养过第 ${index + 1} 只猫。`,
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
