import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
      displaySummary: 'WJJ 提到旧书店和海盐焦糖。',
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
        if (input.systemPrompt.includes('阶段 A')) {
          assert.match(input.systemPrompt, /local_entity_id/)
          assert.match(input.systemPrompt, /surface/)
          assert.match(input.systemPrompt, /source_quote/)
          assert.match(input.systemPrompt, /entity_links/)
          assert.doesNotMatch(input.systemPrompt, /"aliases":string\[\]/)
          assert.match(input.systemPrompt, /Stage A 禁止建立 alias/)
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
                  source_quote: '旧书店那次我买了海盐焦糖',
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
      now: new Date('2026-04-30T09:00:00.000Z'),
    })

    assert.equal(result.ok, true)
    assert.equal(result.createdEpisodicCount, 1)
    assert.equal(result.createdEntityCount, 3)
    assert.deepEqual(
      getMemoryRawSqlite().prepare(`
        SELECT alias
        FROM memory_entity_aliases
        ORDER BY alias
      `).all(),
      [],
    )
    assert.equal(memoryRepo.getMemory(stm.id), undefined)
    assert.equal(episodicMemoryGraphRepo.recallEpisodicMemories({
      agentId: agent.id,
      topK: 5,
      now: new Date('2026-04-30T09:00:00.000Z'),
    }).length, 0)
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
      displaySummary: 'WJJ 随口提到一个临时地点。',
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
        if (input.systemPrompt.includes('阶段 A')) {
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
    assert.equal(first.deletedShortTermCount, 0)
    assert.equal(second.ok, true)
    assert.equal(second.createdEntityCount, 0)
    assert.equal(second.createdEpisodicCount, 0)
    assert.equal(second.deletedShortTermCount, 0)
    assert.equal(stageBCalls, 0)
    assert.equal(entityCount, 0)
    assert.ok(memoryRepo.getMemory(stm.id))
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
      displaySummary: 'WJJ 提到一条弱实体链接。',
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
        if (input.systemPrompt.includes('阶段 A')) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              entities: [
                { local_entity_id: 'e1', surface: '弱地点', type: 'place', context_hint: '弱链接地点', aliases: [] },
              ],
              episodic_memories: [
                {
                  summary: '这条情景记忆没有可用实体链接。',
                  source_quote: '只有弱实体链接',
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
    assert.equal(first.deletedShortTermCount, 0)
    assert.equal(second.ok, true)
    assert.equal(second.createdEntityCount, 0)
    assert.equal(second.createdEpisodicCount, 0)
    assert.equal(second.deletedShortTermCount, 0)
    assert.equal(stageBCalls, 0)
    assert.equal(entityCount, 0)
    assert.ok(memoryRepo.getMemory(stm.id))
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
      displaySummary: 'WJJ 提到焦糖。',
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
        if (input.systemPrompt.includes('阶段 A')) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              entities: [
                { local_entity_id: 'c', surface: '焦糖', type: 'object', context_hint: '海盐焦糖简称', aliases: [] },
                { local_entity_id: 'abs', surface: '怀念', type: 'unknown', context_hint: '抽象情绪', aliases: [] },
              ],
              episodic_memories: [
                {
                  summary: 'WJJ 把焦糖放进这条情景记忆。',
                  source_quote: '焦糖进入情景',
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
      now: new Date('2026-04-30T09:00:00.000Z'),
    })
    const entityRows = getMemoryRawSqlite().prepare(`
      SELECT canonical_name, type
      FROM memory_entities
      WHERE agent_id = ?
      ORDER BY canonical_name
    `).all(agent.id) as Array<{ canonical_name: string; type: string }>

    assert.equal(result.ok, true)
    assert.equal(result.createdEntityCount, 1)
    assert.equal(result.createdEpisodicCount, 1)
    assert.doesNotMatch(stageBInput, /怀念/)
    assert.deepEqual(entityRows, [
      { canonical_name: '海盐焦糖', type: 'object' },
      { canonical_name: '焦糖', type: 'object' },
    ])
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
