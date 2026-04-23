import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getDb,
  getRawSqlite,
  relationshipRepo,
  resetDb,
  sessionRelationshipBindingRepo,
} from '@mas/db'
import { NamedMultiDimRelationshipSystem } from './named-multi-dim'
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
    INSERT INTO agents (id, name, model) VALUES ('agent-1', 'Hazel', 'deepseek-chat');
    INSERT INTO sessions (id, agent_id, title) VALUES ('session-a', 'agent-1', 'A');
    INSERT INTO sessions (id, agent_id, title) VALUES ('session-b', 'agent-1', 'B');
    INSERT INTO relationship_counterparts (id, agent_id, name) VALUES ('cp-1', 'agent-1', '张三');
    INSERT INTO relationship_counterparts (id, agent_id, name) VALUES ('cp-2', 'agent-1', '李四');
  `)
}

function createContext(sessionId: string, userText = '你好'): TurnContext {
  return {
    agentId: 'agent-1',
    sessionId,
    userId: 'default-user',
    input: {
      raw: userText,
      text: userText,
      modality: 'text',
    },
    state: {},
    turnMetadata: {},
    promptFragments: [],
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    response: {
      content: [{ type: 'text', text: '收到。' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 8, outputTokens: 8 },
    },
  }
}

test('named-multi-dim relationship stays inactive without a bound counterpart and isolates per-session counterparts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-named-relationship-system-'))
  const dbPath = join(dir, 'relationship.db')

  try {
    bootstrapDb(dbPath)

    const system = new NamedMultiDimRelationshipSystem({
      scheme: 'named-multi-dim',
      baseline: {
        trust: 0.5,
        affinity: 0.4,
        familiarity: 0.1,
        respect: 0.5,
      },
      fragmentPrompt: '让关系状态轻微影响语气与分寸。',
      analysisPrompt: '请判断这轮对关系状态的影响，只输出 JSON。',
    })

    const unboundCtx = createContext('session-a', '你好')
    await system.beforeTurn?.(unboundCtx)
    await system.beforeLLM?.(unboundCtx)
    await system.afterLLM?.(unboundCtx)
    await system.afterTurn?.(unboundCtx)

    assert.equal(unboundCtx.state.relationship, undefined)
    assert.equal(unboundCtx.promptFragments.length, 0)
    assert.equal(unboundCtx.pendingRelationshipAnalysis, undefined)

    sessionRelationshipBindingRepo.bindSessionRelationshipCounterpart({
      sessionId: 'session-a',
      counterpartId: 'cp-1',
    })
    const zhangsanCtx = createContext('session-a', '你最近辛苦了，张三')
    await system.beforeTurn?.(zhangsanCtx)
    await system.beforeLLM?.(zhangsanCtx)
    await system.afterLLM?.(zhangsanCtx)
    assert.match(zhangsanCtx.promptFragments[0]?.content ?? '', /张三/)
    zhangsanCtx.relationshipAnalysis = {
      delta: { trust: 0.15, affinity: 0.1, familiarity: 0.06, respect: 0.05 },
      trigger: '张三主动道谢',
      rawResponse: '{}',
    }
    await system.afterTurn?.(zhangsanCtx)

    sessionRelationshipBindingRepo.bindSessionRelationshipCounterpart({
      sessionId: 'session-b',
      counterpartId: 'cp-2',
    })
    const lisiCtx = createContext('session-b', '我有点不开心，李四')
    await system.beforeTurn?.(lisiCtx)
    await system.beforeLLM?.(lisiCtx)
    assert.match(lisiCtx.promptFragments[0]?.content ?? '', /李四/)
    lisiCtx.relationshipAnalysis = {
      delta: { trust: -0.1, affinity: -0.05, familiarity: 0.02, respect: -0.03 },
      trigger: '李四有些抱怨',
      rawResponse: '{}',
    }
    await system.afterTurn?.(lisiCtx)

    assert.deepEqual(relationshipRepo.getRelationship('agent-1', 'cp-1', 'named')?.dimensions, {
      trust: 0.65,
      affinity: 0.5,
      familiarity: 0.16,
      respect: 0.55,
    })
    assert.deepEqual(relationshipRepo.getRelationship('agent-1', 'cp-2', 'named')?.dimensions, {
      trust: 0.4,
      affinity: 0.35,
      familiarity: 0.12,
      respect: 0.47,
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
