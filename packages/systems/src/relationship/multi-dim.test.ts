import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, relationshipRepo, resetDb } from '@mas/db'
import { MultiDimRelationshipSystem } from './multi-dim'
import type { TurnContext } from '../types'

function bootstrapDb(dbPath: string) {
  resetDb()
  getDb(dbPath)
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
    CREATE TABLE relationships (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      counterpart_type TEXT NOT NULL,
      counterpart_id TEXT NOT NULL,
      dimensions TEXT NOT NULL,
      history TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE UNIQUE INDEX idx_relationships_agent_counterpart
      ON relationships(agent_id, counterpart_type, counterpart_id);
  `)
  getRawSqlite().exec(`
    INSERT INTO agents (id, name, model) VALUES ('agent-1', 'Agent One', 'claude-sonnet-4-6');
  `)
}

function createContext(userText = '你最近老是答非所问'): TurnContext {
  return {
    agentId: 'agent-1',
    sessionId: 'session-1',
    userId: 'default-user',
    input: {
      raw: userText,
      text: userText,
      modality: 'text',
    },
    state: {},
    turnMetadata: {},
    promptFragments: [],
    messages: [
      { role: 'user', content: [{ type: 'text', text: userText }] },
    ],
    response: {
      content: [{ type: 'text', text: '我会继续帮你。' }],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 12,
        outputTokens: 18,
      },
    },
  }
}

test('multi-dim relationship loads baseline, injects a fragment, and persists the updated state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-relationship-system-'))
  const dbPath = join(dir, 'relationship.db')

  try {
    bootstrapDb(dbPath)

    const system = new MultiDimRelationshipSystem({
      scheme: 'multi-dim',
      baseline: {
        trust: 0.5,
        affinity: 0.4,
        familiarity: 0.1,
        respect: 0.5,
      },
      decayPerTurn: 0.1,
    })
    const ctx = createContext('你上次记错了我的名字')

    await system.beforeTurn?.(ctx)
    assert.deepEqual(ctx.state.relationship, {
      trust: 0.5,
      affinity: 0.4,
      familiarity: 0.1,
      respect: 0.5,
    })

    await system.beforeLLM?.(ctx)
    assert.equal(ctx.promptFragments[0]?.priority, 40)
    assert.match(ctx.promptFragments[0]?.content ?? '', /熟悉度/)

    await system.afterLLM?.(ctx)
    assert.equal(ctx.pendingRelationshipAnalysis?.kind, 'multi-dim')
    assert.match(ctx.pendingRelationshipAnalysis?.systemPrompt ?? '', /只输出 JSON/)
    assert.match(JSON.stringify(ctx.pendingRelationshipAnalysis?.messages ?? []), /分析这一轮已经完成的对话/)

    ctx.relationshipAnalysis = {
      delta: {
        trust: -0.25,
        affinity: -0.15,
        familiarity: 0.05,
        respect: -0.1,
      },
      trigger: '用户提起上次被记错名字的不快',
      rawResponse: '{"trust_delta":-0.25,"affinity_delta":-0.15,"familiarity_delta":0.05,"respect_delta":-0.1}',
    }

    await system.afterTurn?.(ctx)

    const latest = relationshipRepo.getRelationship('agent-1', 'default-user')
    assert.deepEqual(latest?.dimensions, {
      trust: 0.25,
      affinity: 0.25,
      familiarity: 0.15,
      respect: 0.4,
    })
    assert.equal(latest?.history.length, 1)
    assert.equal(latest?.history[0]?.trigger, '用户提起上次被记错名字的不快')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('multi-dim relationship decays from stored state, clips into range, and appends history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-relationship-system-'))
  const dbPath = join(dir, 'relationship.db')

  try {
    bootstrapDb(dbPath)

    relationshipRepo.upsertRelationship({
      agentId: 'agent-1',
      counterpartId: 'default-user',
      dimensions: {
        trust: 0.95,
        affinity: 0.98,
        familiarity: 0.9,
        respect: 0.88,
      },
      history: [
        {
          summary: '先前互动一直不错',
          trigger: 'older',
          delta: {
            trust: 0.15,
            affinity: 0.2,
            familiarity: 0.22,
            respect: 0.18,
          },
          createdAt: '2026-04-20T09:00:00.000Z',
        },
      ],
      updatedAt: new Date('2026-04-20T09:00:00.000Z'),
    })

    const system = new MultiDimRelationshipSystem({
      scheme: 'multi-dim',
      baseline: {
        trust: 0.5,
        affinity: 0.4,
        familiarity: 0.1,
        respect: 0.5,
      },
      decayPerTurn: 0.2,
    })
    const ctx = createContext('谢谢你，这次回答好多了')

    await system.beforeTurn?.(ctx)
    ctx.relationshipAnalysis = {
      delta: {
        trust: 0.4,
        affinity: 0.35,
        familiarity: 0.3,
        respect: 0.5,
      },
      trigger: '用户给出明显正反馈',
      rawResponse: '{"trust_delta":0.4,"affinity_delta":0.35,"familiarity_delta":0.3,"respect_delta":0.5}',
    }

    await system.afterTurn?.(ctx)

    const latest = relationshipRepo.getRelationship('agent-1', 'default-user')
    assert.deepEqual(latest?.dimensions, {
      trust: 1,
      affinity: 1,
      familiarity: 1,
      respect: 1,
    })
    assert.equal(latest?.history.length, 2)
    assert.equal(latest?.history[1]?.trigger, '用户给出明显正反馈')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('multi-dim relationship renders observably different fragments for low vs high states', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-relationship-system-'))
  const dbPath = join(dir, 'relationship.db')

  try {
    bootstrapDb(dbPath)

    const system = new MultiDimRelationshipSystem({
      scheme: 'multi-dim',
      baseline: {
        trust: 0.5,
        affinity: 0.4,
        familiarity: 0.1,
        respect: 0.5,
      },
    })

    relationshipRepo.upsertRelationship({
      agentId: 'agent-1',
      counterpartId: 'default-user',
      dimensions: {
        trust: 0.1,
        affinity: 0.1,
        familiarity: 0.05,
        respect: 0.2,
      },
      history: [],
    })
    const lowCtx = createContext('你怎么又错了')
    await system.beforeTurn?.(lowCtx)
    await system.beforeLLM?.(lowCtx)

    relationshipRepo.upsertRelationship({
      agentId: 'agent-1',
      counterpartId: 'default-user',
      dimensions: {
        trust: 0.92,
        affinity: 0.9,
        familiarity: 0.88,
        respect: 0.95,
      },
      history: [],
    })
    const highCtx = createContext('这次真帮上忙了')
    await system.beforeTurn?.(highCtx)
    await system.beforeLLM?.(highCtx)

    const lowFragment = lowCtx.promptFragments[0]?.content ?? ''
    const highFragment = highCtx.promptFragments[0]?.content ?? ''

    assert.match(lowFragment, /几乎不信任/)
    assert.match(lowFragment, /熟悉度较低/)
    assert.match(highFragment, /高度信任/)
    assert.match(highFragment, /非常熟悉/)
    assert.notEqual(lowFragment, highFragment)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
