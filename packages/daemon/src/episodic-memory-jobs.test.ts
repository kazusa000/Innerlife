import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { LLMRequest } from '@mas/core'
import {
  agentRepo,
  bootstrapAppDatabases,
  episodicMemoryGraphRepo,
  getMemoryDb,
  getMemoryRawSqlite,
  memoryRepo,
  resetDb,
  resetMemoryDb,
} from '@mas/db'
import { runEpisodicConsolidationForAgent } from './memory-jobs'

function bootstrap(dbPath: string, memoryDbPath: string) {
  process.env.MAS_DB_PATH = dbPath
  process.env.MAS_MEMORY_DB_PATH = memoryDbPath
  resetDb()
  resetMemoryDb()
  bootstrapAppDatabases({ dbPath, memoryDbPath })
  getMemoryDb(memoryDbPath)
}

test('runEpisodicConsolidationForAgent turns short term memory into entities and episodic memory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-episodic-job-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Amadeus',
      description: '',
      model: 'claude-sonnet-4-6',
      provider: 'openrouter',
      modules: { memory: { scheme: 'sqlite' } },
    })
    const stm = memoryRepo.addMemory({
      agentId: agent.id,
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'WJJ：旧书店那次我买了海盐焦糖。',
      detail: 'WJJ 提到旧书店和海盐焦糖。',
      retrievalText: 'WJJ 在旧书店买过海盐焦糖。',
      retrievalEmbedding: [],
      retrievalModel: 'none',
      tags: [],
      importance: 0.7,
      observedStartAt: new Date('2026-04-30T08:00:00.000Z'),
      observedEndAt: new Date('2026-04-30T08:05:00.000Z'),
    })

    const provider = {
      async sendMessage(input: { systemPrompt: string }) {
        if (input.systemPrompt.includes('episodic_memories')) {
          assert.match(input.systemPrompt, /local_entity_id/)
          assert.match(input.systemPrompt, /surface/)
          assert.match(input.systemPrompt, /"detail":string/)
          assert.match(input.systemPrompt, /entity_links/)
          assert.doesNotMatch(input.systemPrompt, /"aliases":string\[\]/)
          assert.match(input.systemPrompt, /surface 必须保留原文/)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              entities: [
                { local_entity_id: 'e1', surface: 'WJJ', type: 'person', context_hint: '当前对话对象', aliases: [] },
                { local_entity_id: 'e2', surface: '旧书店', type: 'place', context_hint: '旧书店地点', aliases: ['那家旧书店'] },
                { local_entity_id: 'e3', surface: '海盐焦糖', type: 'object', context_hint: '被提到的物品', aliases: [] },
              ],
              episodic_memories: [
                {
                  summary: 'WJJ 在旧书店提到过海盐焦糖。',
                  detail: '旧书店那次我买了海盐焦糖',
                  importance: 0.72,
                  entity_links: [
                    { local_entity_id: 'e1', weight: 0.8 },
                    { local_entity_id: 'e2', weight: 1 },
                    { local_entity_id: 'e3', weight: 0.7 },
                  ],
                },
              ],
            }) }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        }
        assert.match(input.systemPrompt, /"resolutions"/)
        assert.match(input.systemPrompt, /canonical_name/)
        assert.match(input.systemPrompt, /confidence/)
        assert.match(input.systemPrompt, /不要返回数组/)
        assert.match(input.systemPrompt, /merge 且 local surface/)
        assert.match(input.systemPrompt, /如果 context_hint 明确说明 local entity 和某个候选是同一个实体/)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            resolutions: [
              { local_entity_id: 'e1', action: 'create_new', canonical_name: 'WJJ', type: 'person', confidence: 0.95 },
              { local_entity_id: 'e2', action: 'create_new', canonical_name: '旧书店', type: 'place', confidence: 0.8 },
              { local_entity_id: 'e3', action: 'create_new', canonical_name: '海盐焦糖', type: 'object', confidence: 0.86 },
            ],
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const result = await runEpisodicConsolidationForAgent({
      agentId: agent.id,
      provider,
      embedder: {
        async embed(input, options) {
          if (options?.model === 'BAAI/bge-m3') {
            assert.equal(options.inputType, 'search_document')
            assert.equal(input.length, 1)
            assert.match(input[0] ?? '', /canonical_name:/)
            return [[0, 1, 0]]
          }
          assert.deepEqual(options, {
            model: 'qwen/qwen3-embedding-8b',
            inputType: 'search_document',
          })
          assert.deepEqual(input, ['WJJ 在旧书店提到过海盐焦糖。'])
          return [[1, 0, 0]]
        },
      },
      now: new Date('2026-04-30T09:00:00.000Z'),
    })

    assert.equal(result.ok, true)
    assert.equal(result.createdEpisodicCount, 1)
    assert.equal(result.createdEntityCount, 3)
    assert.deepEqual(
      getMemoryRawSqlite().prepare(`
        SELECT summary, detail, retrieval_embedding, retrieval_model
        FROM episodic_memories
      `).all(),
      [{
        summary: 'WJJ 在旧书店提到过海盐焦糖。',
        detail: '旧书店那次我买了海盐焦糖',
        retrieval_embedding: '[1,0,0]',
        retrieval_model: 'qwen/qwen3-embedding-8b',
      }],
    )
    assert.deepEqual(
      getMemoryRawSqlite().prepare(`
        SELECT alias
        FROM memory_entity_aliases
        ORDER BY alias
      `).all(),
      [],
    )
    assert.deepEqual(
      getMemoryRawSqlite().prepare(`
        SELECT COUNT(*) AS count
        FROM memory_entities
        WHERE embedding_model = 'BAAI/bge-m3'
          AND embedding != '[]'
      `).get(),
      { count: 3 },
    )
    assert.equal(memoryRepo.getMemory(stm.id), undefined)
    assert.equal(episodicMemoryGraphRepo.recallEpisodicMemories({
      agentId: agent.id,
      topK: 5,
    }).length, 0)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runEpisodicConsolidationForAgent resolves local entities in batches of five with five candidates each', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-episodic-job-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Amadeus',
      description: '',
      model: 'claude-sonnet-4-6',
      provider: 'openrouter',
      modules: { memory: { scheme: 'sqlite' } },
    })
    memoryRepo.addMemory({
      agentId: agent.id,
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'WJJ：最近整理了一批游戏、地点和工具记忆。',
      detail: 'WJJ 提到一批需要沉淀的实体。',
      retrievalText: 'WJJ 提到一批需要沉淀的实体。',
      retrievalEmbedding: [],
      retrievalModel: 'none',
      tags: [],
      importance: 0.7,
      observedStartAt: new Date('2026-04-30T08:00:00.000Z'),
      observedEndAt: new Date('2026-04-30T08:05:00.000Z'),
    })

    for (let index = 1; index <= 7; index += 1) {
      episodicMemoryGraphRepo.createEntity({
        agentId: agent.id,
        type: 'object',
        canonicalName: `候选游戏${index}`,
        description: `候选游戏 ${index}`,
        confidence: 0.8,
        aliases: [{ alias: '共享游戏', confidence: 0.8 }],
        now: new Date('2026-04-30T07:00:00.000Z'),
      })
    }

    const stageBPayloadSizes: number[] = []
    const stageBCandidateSizes: number[] = []
    const stageBLocalIds: string[][] = []
    const provider = {
      async sendMessage(input: LLMRequest) {
        if (input.systemPrompt.includes('episodic_memories')) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              entities: Array.from({ length: 12 }, (_, index) => ({
                local_entity_id: `e${index + 1}`,
                surface: index === 0 ? '共享游戏' : `局部实体${index + 1}`,
                type: 'object',
                context_hint: `第 ${index + 1} 个局部实体`,
              })),
              episodic_memories: [
                {
                  summary: '第一批局部实体需要沉淀。',
                  detail: '第一批',
                  importance: 0.8,
                  entity_links: Array.from({ length: 5 }, (_, index) => ({
                    local_entity_id: `e${index + 1}`,
                    weight: 0.9,
                  })),
                },
                {
                  summary: '第二批局部实体需要沉淀。',
                  detail: '第二批',
                  importance: 0.8,
                  entity_links: Array.from({ length: 5 }, (_, index) => ({
                    local_entity_id: `e${index + 6}`,
                    weight: 0.9,
                  })),
                },
                {
                  summary: '第三批局部实体需要沉淀。',
                  detail: '第三批',
                  importance: 0.8,
                  entity_links: [
                    { local_entity_id: 'e11', weight: 0.9 },
                    { local_entity_id: 'e12', weight: 0.9 },
                  ],
                },
              ],
            }) }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        }

        const content = input.messages[0]?.content
        const text = Array.isArray(content) && content[0]?.type === 'text' ? content[0].text : '[]'
        const payload = JSON.parse(text) as Array<{
          local_entity_id: string
          candidates: Array<Record<string, unknown>>
        }>
        stageBPayloadSizes.push(payload.length)
        stageBLocalIds.push(payload.map((item) => item.local_entity_id))
        for (const item of payload) {
          assert.ok(item.candidates.length <= 5)
          stageBCandidateSizes.push(item.candidates.length)
          for (const candidate of item.candidates) {
            assert.equal('match_kind' in candidate, false)
          }
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            resolutions: payload.map((item) => ({
              local_entity_id: item.local_entity_id,
              action: 'create_new',
              canonical_name: `节点-${item.local_entity_id}`,
              type: 'object',
              confidence: 0.86,
            })),
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const result = await runEpisodicConsolidationForAgent({
      agentId: agent.id,
      provider,
      embedder: {
        async embed(input, options) {
          if (options?.inputType === 'search_document' && input.some((text) => text.includes('canonical_name'))) {
            assert.ok(input.length === 7 || input.length === 1)
            return input.map((_, index) => [index + 1, 0, 0])
          }
          if (options?.inputType === 'search_query') {
            assert.equal(input.length, 12)
            return input.map((_, index) => [index + 1, 0, 0])
          }
          assert.equal(options?.inputType, 'search_document')
          assert.equal(input.length, 3)
          return input.map((_, index) => [index + 1, 0, 0])
        },
      },
      now: new Date('2026-04-30T09:00:00.000Z'),
    })

    assert.equal(result.ok, true)
    assert.deepEqual(stageBPayloadSizes, [5, 5, 2])
    assert.deepEqual(stageBLocalIds, [
      ['e1', 'e2', 'e3', 'e4', 'e5'],
      ['e6', 'e7', 'e8', 'e9', 'e10'],
      ['e11', 'e12'],
    ])
    assert.equal(stageBCandidateSizes[0], 5)
    assert.equal(result.createdEntityCount, 12)
    assert.equal(result.createdEpisodicCount, 3)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runEpisodicConsolidationForAgent ranks stage B candidates by entity card embeddings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-episodic-job-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Amadeus',
      description: '',
      model: 'claude-sonnet-4-6',
      provider: 'openrouter',
      modules: { memory: { scheme: 'sqlite' } },
    })
    const existing = episodicMemoryGraphRepo.createEntity({
      agentId: agent.id,
      type: 'event',
      canonicalName: '起飞',
      description: '王家骏喜欢的一种玩法，也会用别的个人习惯叫法来称呼。',
      confidence: 0.9,
      aliases: [],
      now: new Date('2026-04-30T07:00:00.000Z'),
    })
    episodicMemoryGraphRepo.createEntity({
      agentId: agent.id,
      type: 'object',
      canonicalName: '星际争霸2',
      description: '王家骏喜欢的科幻即时战略游戏。',
      confidence: 0.9,
      aliases: [],
      now: new Date('2026-04-30T07:00:00.000Z'),
    })
    memoryRepo.addMemory({
      agentId: agent.id,
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: '王家骏：跳皮就是起飞的别称。',
      detail: '王家骏解释“跳皮”是“起飞”的别称。',
      retrievalText: '王家骏说跳皮就是起飞的别称。',
      retrievalEmbedding: [],
      retrievalModel: 'none',
      tags: [],
      importance: 0.8,
      observedStartAt: new Date('2026-04-30T08:00:00.000Z'),
      observedEndAt: new Date('2026-04-30T08:05:00.000Z'),
    })

    const provider = {
      async sendMessage(input: LLMRequest) {
        if (input.systemPrompt.includes('episodic_memories')) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              entities: [
                {
                  local_entity_id: 'e1',
                  surface: '跳皮',
                  type: 'event',
                  context_hint: '王家骏解释该词是起飞的别称',
                },
              ],
              episodic_memories: [
                {
                  summary: '王家骏说跳皮就是起飞的别称。',
                  detail: '王家骏解释“跳皮”是“起飞”的别称。',
                  importance: 0.8,
                  entity_links: [{ local_entity_id: 'e1', weight: 1 }],
                },
              ],
            }) }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        }

        const content = input.messages[0]?.content
        const text = Array.isArray(content) && content[0]?.type === 'text' ? content[0].text : '[]'
        const payload = JSON.parse(text) as Array<{
          local_entity_id: string
          candidates: Array<{ entity_id: string; canonical_name: string }>
        }>
        assert.equal(payload[0]?.local_entity_id, 'e1')
        assert.equal(payload[0]?.candidates[0]?.entity_id, existing.id)
        assert.equal(payload[0]?.candidates[0]?.canonical_name, '起飞')

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            resolutions: [
              {
                local_entity_id: 'e1',
                action: 'merge',
                entity_id: existing.id,
                confidence: 0.94,
                alias_to_add: '跳皮',
              },
            ],
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const result = await runEpisodicConsolidationForAgent({
      agentId: agent.id,
      provider,
      embedder: {
        async embed(input, options) {
          if (options?.inputType === 'search_query') {
            assert.deepEqual(options, { model: 'BAAI/bge-m3', inputType: 'search_query' })
            assert.equal(input.length, 1)
            assert.match(input[0] ?? '', /跳皮/)
            return [[1, 0]]
          }
          if (options?.inputType === 'search_document' && input.some((text) => text.includes('canonical_name'))) {
            assert.deepEqual(options, { model: 'BAAI/bge-m3', inputType: 'search_document' })
            return input.map((text) =>
              text.includes('起飞') ? [1, 0] : [0, 1],
            )
          }
          assert.equal(options?.inputType, 'search_document')
          return input.map(() => [1, 0])
        },
      },
      now: new Date('2026-04-30T09:00:00.000Z'),
    })

    assert.equal(result.ok, true)
    assert.equal(result.createdEntityCount, 0)
    assert.equal(result.createdEpisodicCount, 1)
    assert.deepEqual(
      getMemoryRawSqlite().prepare(`
        SELECT alias
        FROM memory_entity_aliases
        WHERE entity_id = ?
      `).all(existing.id),
      [{ alias: '跳皮' }],
    )
    const embeddedEntity = episodicMemoryGraphRepo.getEntity(existing.id)
    assert.deepEqual(embeddedEntity?.embedding, [1, 0])
    assert.equal(embeddedEntity?.embeddingModel, 'BAAI/bge-m3')
    assert.match(embeddedEntity?.embeddingText ?? '', /canonical_name: 起飞/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runEpisodicConsolidationForAgent processes stage A in batches of three until no short term memory remains', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-episodic-job-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Amadeus',
      description: '',
      model: 'claude-sonnet-4-6',
      provider: 'openrouter',
      modules: { memory: { scheme: 'sqlite' } },
    })

    for (let index = 1; index <= 7; index += 1) {
      memoryRepo.addMemory({
        agentId: agent.id,
        sessionId: 'session-1',
        layer: 'short_term',
        sourceText: `WJJ：第 ${index} 条短期记忆。`,
        detail: `第 ${index} 条短期记忆 detail。`,
        retrievalText: `第 ${index} 条短期记忆 retrieval。`,
        retrievalEmbedding: [],
        retrievalModel: 'none',
        tags: [],
        importance: 0.6,
        createdAt: new Date(`2026-04-30T08:0${index}:00.000Z`),
        observedStartAt: new Date(`2026-04-30T08:0${index}:00.000Z`),
        observedEndAt: new Date(`2026-04-30T08:0${index}:30.000Z`),
      })
    }

    const stageABatchSizes: number[] = []
    const stageADetails: string[][] = []
    let stageACalls = 0
    const provider = {
      async sendMessage(input: LLMRequest) {
        const content = input.messages[0]?.content
        const text = Array.isArray(content) && content[0]?.type === 'text' ? content[0].text : ''

        if (input.systemPrompt.includes('episodic_memories')) {
          stageACalls += 1
          const details = Array.from(text.matchAll(/第 \d+ 条短期记忆 detail。/g)).map((match) => match[0])
          stageABatchSizes.push(details.length)
          stageADetails.push(details)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              entities: [
                {
                  local_entity_id: `e${stageACalls}`,
                  surface: `批次${stageACalls}`,
                  type: 'event',
                  context_hint: `第 ${stageACalls} 批 STM`,
                },
              ],
              episodic_memories: [
                {
                  summary: `第 ${stageACalls} 批 STM 已沉淀。`,
                  detail: details.join(' '),
                  importance: 0.7,
                  entity_links: [{ local_entity_id: `e${stageACalls}`, weight: 0.9 }],
                },
              ],
            }) }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        }

        const payload = JSON.parse(text) as Array<{ local_entity_id: string; type: 'event' }>
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            resolutions: payload.map((item) => ({
              local_entity_id: item.local_entity_id,
              action: 'create_new',
              canonical_name: `节点-${item.local_entity_id}`,
              type: item.type,
              confidence: 0.86,
            })),
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const result = await runEpisodicConsolidationForAgent({
      agentId: agent.id,
      provider,
      embedder: {
        async embed(input) {
          return input.map((_, index) => [index + 1, 0, 0])
        },
      },
      now: new Date('2026-04-30T09:00:00.000Z'),
    })

    assert.equal(result.ok, true)
    assert.deepEqual(stageABatchSizes, [3, 3, 1])
    assert.deepEqual(stageADetails, [
      ['第 1 条短期记忆 detail。', '第 2 条短期记忆 detail。', '第 3 条短期记忆 detail。'],
      ['第 4 条短期记忆 detail。', '第 5 条短期记忆 detail。', '第 6 条短期记忆 detail。'],
      ['第 7 条短期记忆 detail。'],
    ])
    assert.equal(result.createdEntityCount, 3)
    assert.equal(result.createdEpisodicCount, 3)
    assert.equal(result.deletedShortTermCount, 7)
    assert.equal(memoryRepo.listMemoriesByAgent(agent.id).filter((memory) => memory.layer === 'short_term').length, 0)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runEpisodicConsolidationForAgent does not mutate entity graph when extraction has no episodic memories', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-episodic-job-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Amadeus',
      description: '',
      model: 'claude-sonnet-4-6',
      provider: 'openrouter',
      modules: { memory: { scheme: 'sqlite' } },
    })
    const stm = memoryRepo.addMemory({
      agentId: agent.id,
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'WJJ：只是随口提到一个临时地点。',
      detail: 'WJJ 随口提到一个临时地点。',
      retrievalText: 'WJJ 临时地点',
      retrievalEmbedding: [],
      retrievalModel: 'none',
      tags: [],
      importance: 0.4,
      observedStartAt: new Date('2026-04-30T08:00:00.000Z'),
      observedEndAt: new Date('2026-04-30T08:05:00.000Z'),
    })
    let stageBCalls = 0
    const provider = {
      async sendMessage(input: { systemPrompt: string }) {
        if (input.systemPrompt.includes('episodic_memories')) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              entities: [
                { local_entity_id: 'e1', surface: '临时地点', type: 'place', context_hint: '弱 mention', aliases: [] },
              ],
              episodic_memories: [],
            }) }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        }
        stageBCalls += 1
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            resolutions: [
              { local_entity_id: 'e1', action: 'create_new', canonical_name: '临时地点', type: 'place', confidence: 0.8 },
            ],
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const first = await runEpisodicConsolidationForAgent({
      agentId: agent.id,
      provider,
      now: new Date('2026-04-30T09:00:00.000Z'),
    })
    const second = await runEpisodicConsolidationForAgent({
      agentId: agent.id,
      provider,
      now: new Date('2026-04-30T09:05:00.000Z'),
    })

    const entityCount = (getMemoryRawSqlite().prepare(`
      SELECT count(*) AS count
      FROM memory_entities
      WHERE agent_id = ?
    `).get(agent.id) as { count: number }).count

    assert.equal(first.ok, true)
    assert.equal(first.createdEntityCount, 0)
    assert.equal(first.createdEpisodicCount, 0)
    assert.equal(first.deletedShortTermCount, 1)
    assert.equal(second.ok, true)
    assert.equal(second.createdEntityCount, 0)
    assert.equal(second.createdEpisodicCount, 0)
    assert.equal(second.deletedShortTermCount, 0)
    assert.equal(stageBCalls, 0)
    assert.equal(entityCount, 0)
    assert.equal(memoryRepo.getMemory(stm.id), undefined)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runEpisodicConsolidationForAgent does not mutate entity graph when episodic drafts have no usable links', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-episodic-job-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Amadeus',
      description: '',
      model: 'claude-sonnet-4-6',
      provider: 'openrouter',
      modules: { memory: { scheme: 'sqlite' } },
    })
    const stm = memoryRepo.addMemory({
      agentId: agent.id,
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'WJJ：这是一条只有弱实体链接的短期记忆。',
      detail: 'WJJ 提到一条弱实体链接。',
      retrievalText: 'WJJ 弱实体链接',
      retrievalEmbedding: [],
      retrievalModel: 'none',
      tags: [],
      importance: 0.4,
      observedStartAt: new Date('2026-04-30T08:00:00.000Z'),
      observedEndAt: new Date('2026-04-30T08:05:00.000Z'),
    })
    let stageBCalls = 0
    const provider = {
      async sendMessage(input: { systemPrompt: string }) {
        if (input.systemPrompt.includes('episodic_memories')) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              entities: [
                { local_entity_id: 'e1', surface: '弱地点', type: 'place', context_hint: '弱链接地点', aliases: [] },
              ],
              episodic_memories: [
                {
                  summary: '这条情景记忆没有可用实体链接。',
                  detail: '只有弱实体链接',
                  importance: 0.4,
                  entity_links: [
                    { local_entity_id: 'missing', weight: 1 },
                    { local_entity_id: 'e1', weight: 0.2 },
                  ],
                },
              ],
            }) }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        }
        stageBCalls += 1
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            resolutions: [
              { local_entity_id: 'e1', action: 'create_new', canonical_name: '弱地点', type: 'place', confidence: 0.8 },
            ],
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const first = await runEpisodicConsolidationForAgent({
      agentId: agent.id,
      provider,
      now: new Date('2026-04-30T09:00:00.000Z'),
    })
    const second = await runEpisodicConsolidationForAgent({
      agentId: agent.id,
      provider,
      now: new Date('2026-04-30T09:05:00.000Z'),
    })
    const entityCount = (getMemoryRawSqlite().prepare(`
      SELECT count(*) AS count
      FROM memory_entities
      WHERE agent_id = ?
    `).get(agent.id) as { count: number }).count

    assert.equal(first.ok, true)
    assert.equal(first.createdEntityCount, 0)
    assert.equal(first.createdEpisodicCount, 0)
    assert.equal(first.deletedShortTermCount, 1)
    assert.equal(second.ok, true)
    assert.equal(second.createdEntityCount, 0)
    assert.equal(second.createdEpisodicCount, 0)
    assert.equal(second.deletedShortTermCount, 0)
    assert.equal(stageBCalls, 0)
    assert.equal(entityCount, 0)
    assert.equal(memoryRepo.getMemory(stm.id), undefined)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runEpisodicConsolidationForAgent resolves only entities linked by usable episodic drafts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-episodic-job-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Amadeus',
      description: '',
      model: 'claude-sonnet-4-6',
      provider: 'openrouter',
      modules: { memory: { scheme: 'sqlite' } },
    })
    const existing = episodicMemoryGraphRepo.createEntity({
      agentId: agent.id,
      type: 'object',
      canonicalName: '海盐焦糖',
      confidence: 0.9,
      aliases: [{ alias: '焦糖', confidence: 0.8 }],
      now: new Date('2026-04-30T08:00:00.000Z'),
    })
    memoryRepo.addMemory({
      agentId: agent.id,
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'WJJ：焦糖和怀念都被提到，但只有焦糖进入情景。',
      detail: 'WJJ 提到焦糖。',
      retrievalText: 'WJJ 焦糖',
      retrievalEmbedding: [],
      retrievalModel: 'none',
      tags: [],
      importance: 0.6,
      observedStartAt: new Date('2026-04-30T08:00:00.000Z'),
      observedEndAt: new Date('2026-04-30T08:05:00.000Z'),
    })
    let stageBInput = ''
    const provider = {
      async sendMessage(input: any) {
        if (input.systemPrompt.includes('episodic_memories')) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              entities: [
                { local_entity_id: 'c', surface: '焦糖', type: 'object', context_hint: '海盐焦糖简称', aliases: [] },
                { local_entity_id: 'abs', surface: '怀念', type: 'unknown', context_hint: '抽象情绪', aliases: [] },
              ],
              episodic_memories: [
                {
                  summary: 'WJJ 把焦糖放进这条情景记忆。',
                  detail: '焦糖进入情景',
                  importance: 0.6,
                  entity_links: [
                    { local_entity_id: 'c', weight: 0.8 },
                    { local_entity_id: 'abs', weight: 0.2 },
                  ],
                },
              ],
            }) }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        }
        stageBInput = input.messages?.[0]?.content?.[0]?.text ?? ''
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            resolutions: [
              { local_entity_id: 'c', action: 'merge', entity_id: existing.id, confidence: 0.7, alias_to_add: '焦糖' },
              { local_entity_id: 'abs', action: 'create_new', canonical_name: '怀念', type: 'unknown', confidence: 0.8 },
            ],
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const result = await runEpisodicConsolidationForAgent({
      agentId: agent.id,
      provider,
      embedder: {
        async embed(input) {
          return input.map(() => [1, 0])
        },
      },
      now: new Date('2026-04-30T09:00:00.000Z'),
    })
    const entityRows = getMemoryRawSqlite().prepare(`
      SELECT canonical_name, type
      FROM memory_entities
      WHERE agent_id = ?
      ORDER BY canonical_name
    `).all(agent.id) as Array<{ canonical_name: string; type: string }>

    assert.equal(result.ok, true)
    assert.equal(result.createdEntityCount, 0)
    assert.equal(result.createdEpisodicCount, 1)
    assert.doesNotMatch(stageBInput, /怀念/)
    assert.deepEqual(entityRows, [
      { canonical_name: '海盐焦糖', type: 'object' },
    ])
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runEpisodicConsolidationForAgent uses editable episodic extraction and resolution prompts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-episodic-prompts-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Amadeus',
      description: '',
      model: 'claude-sonnet-4-6',
      provider: 'openrouter',
      modules: {
        memory: {
          scheme: 'sqlite',
          episodicExtractionPrompt: '自定义情景抽取 prompt',
          entityResolutionPrompt: '自定义实体合并 prompt',
        },
      },
    })
    memoryRepo.addMemory({
      agentId: agent.id,
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'WJJ 说星际2就是星际争霸2。',
      detail: 'WJJ 提到星际2。',
      retrievalText: 'WJJ 星际2 星际争霸2',
      retrievalEmbedding: [],
      retrievalModel: 'none',
      tags: [],
      importance: 0.8,
    })

    const seenPrompts: string[] = []
    const provider = {
      async sendMessage(input: { systemPrompt: string }) {
        seenPrompts.push(input.systemPrompt)
        if (input.systemPrompt === '自定义情景抽取 prompt') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              entities: [
                { local_entity_id: 'sc2', surface: '星际2', type: 'object', context_hint: '星际争霸2简称' },
              ],
              episodic_memories: [
                {
                  summary: 'WJJ 说星际2就是星际争霸2。',
                  detail: '星际2就是星际争霸2',
                  importance: 0.8,
                  entity_links: [{ local_entity_id: 'sc2', weight: 1 }],
                },
              ],
            }) }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            resolutions: [
              {
                local_entity_id: 'sc2',
                action: 'create_new',
                canonical_name: '星际争霸2',
                type: 'object',
                confidence: 0.9,
              },
            ],
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const result = await runEpisodicConsolidationForAgent({
      agentId: agent.id,
      provider,
      embedder: {
        async embed(input) {
          return input.map(() => [1, 0])
        },
      },
      now: new Date('2026-04-30T09:00:00.000Z'),
    })

    assert.equal(result.ok, true)
    assert.deepEqual(seenPrompts, ['自定义情景抽取 prompt', '自定义实体合并 prompt'])
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runEpisodicConsolidationForAgent reuses an exact existing entity when resolution says create_new', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-episodic-memory-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Amadeus',
      description: '',
      model: 'claude-sonnet-4-6',
      provider: 'openrouter',
      modules: { memory: { scheme: 'sqlite' } },
    })
    const existing = episodicMemoryGraphRepo.createEntity({
      agentId: agent.id,
      type: 'place',
      canonicalName: '东京旧书店',
      description: '已存在的地点节点',
      confidence: 0.9,
      aliases: [],
    })
    memoryRepo.addMemory({
      agentId: agent.id,
      sessionId: 'session-1',
      layer: 'short_term',
      sourceText: 'Nora 今天又提到东京旧书店。',
      detail: 'Nora 提到东京旧书店。',
      retrievalText: 'Nora 提到东京旧书店。',
      retrievalEmbedding: [],
      retrievalModel: 'none',
      tags: [],
      importance: 0.7,
    })

    const provider = {
      async sendMessage(input: { systemPrompt: string }) {
        if (input.systemPrompt.includes('episodic_memories')) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              entities: [
                { local_entity_id: 'tokyo', surface: '东京旧书店', type: 'place', context_hint: 'Nora 提到的地点' },
              ],
              episodic_memories: [
                {
                  summary: 'Nora 又提到东京旧书店。',
                  detail: 'Nora 今天又提到东京旧书店',
                  importance: 0.7,
                  entity_links: [{ local_entity_id: 'tokyo', weight: 1 }],
                },
              ],
            }) }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            resolutions: [
              {
                local_entity_id: 'tokyo',
                action: 'create_new',
                canonical_name: '东京旧书店',
                type: 'place',
                confidence: 0.9,
              },
            ],
          }) }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
    }

    const result = await runEpisodicConsolidationForAgent({
      agentId: agent.id,
      provider,
      embedder: {
        async embed(input) {
          return input.map(() => [1, 0])
        },
      },
      now: new Date('2026-04-30T09:00:00.000Z'),
    })
    const entityRows = getMemoryRawSqlite().prepare(`
      SELECT id, canonical_name
      FROM memory_entities
      WHERE agent_id = ?
    `).all(agent.id) as Array<{ id: string; canonical_name: string }>
    const linkRows = getMemoryRawSqlite().prepare(`
      SELECT entity_id
      FROM episodic_memory_entities
    `).all() as Array<{ entity_id: string }>

    assert.equal(result.ok, true)
    assert.equal(result.createdEntityCount, 0)
    assert.deepEqual(entityRows, [{ id: existing.id, canonical_name: '东京旧书店' }])
    assert.deepEqual(linkRows, [{ entity_id: existing.id }])
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
