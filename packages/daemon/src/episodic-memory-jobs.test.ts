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
