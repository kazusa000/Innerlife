import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { agentRepo, getDb, getRawSqlite, relationshipRepo, resetDb } from '@mas/db'
import { getRelationshipManagerMeta } from './[id]/relationships/handler'
import {
  getMultiDimRelationshipConfig,
  updateMultiDimRelationshipConfig,
} from './[id]/relationships/multi-dim/handler'

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
      agent_id TEXT NOT NULL,
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
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-1',
      'Agent One',
      'claude-sonnet-4-6',
      '{"relationship":{"scheme":"multi-dim","baseline":{"trust":0.55,"affinity":0.48,"familiarity":0.22,"respect":0.7},"decayPerTurn":0.1,"analysisModel":"relationship-fast"},"memory":{"scheme":"sqlite","summarizeModel":"memory-fast"}}'
    );
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-2',
      'Agent Two',
      'claude-sonnet-4-6',
      '{"relationship":{"scheme":"noop"}}'
    );
    INSERT INTO agents (id, name, model, modules) VALUES (
      'agent-3',
      'Agent Three',
      'claude-sonnet-4-6',
      '{"memory":{"scheme":"sqlite"}}'
    );
  `)

  relationshipRepo.upsertRelationship({
    agentId: 'agent-1',
    counterpartId: 'default-user',
    dimensions: {
      trust: 0.63,
      affinity: 0.52,
      familiarity: 0.35,
      respect: 0.74,
    },
    history: [
      {
        summary: '用户主动汇报了昨天的进展',
        trigger: '主动更新',
        delta: {
          trust: 0.08,
          affinity: 0.03,
          familiarity: 0.05,
          respect: 0.02,
        },
        createdAt: '2026-04-19T10:00:00.000Z',
      },
      {
        summary: '用户迟到但诚恳解释',
        trigger: '解释迟到',
        delta: {
          trust: -0.02,
          affinity: 0.01,
          familiarity: 0.02,
          respect: 0,
        },
        createdAt: '2026-04-19T14:00:00.000Z',
      },
    ],
    updatedAt: new Date('2026-04-19T14:00:00.000Z'),
  })
}

test('getRelationshipManagerMeta returns current scheme metadata', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-relationship-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = getRelationshipManagerMeta('agent-1')

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      agentId: 'agent-1',
      scheme: 'multi-dim',
      supportedSchemes: ['multi-dim'],
      configured: true,
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getRelationshipManagerMeta reports noop and missing config as unconfigured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-relationship-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const noopResponse = getRelationshipManagerMeta('agent-2')
    const missingResponse = getRelationshipManagerMeta('agent-3')

    assert.deepEqual(await noopResponse.json(), {
      agentId: 'agent-2',
      scheme: 'noop',
      supportedSchemes: ['multi-dim'],
      configured: false,
    })
    assert.deepEqual(await missingResponse.json(), {
      agentId: 'agent-3',
      scheme: null,
      supportedSchemes: ['multi-dim'],
      configured: false,
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getMultiDimRelationshipConfig returns config, current dimensions and history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-relationship-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = getMultiDimRelationshipConfig('agent-1')
    const data = await response.json()

    assert.equal(response.status, 200)
    assert.deepEqual(data.baseline, {
      trust: 0.55,
      affinity: 0.48,
      familiarity: 0.22,
      respect: 0.7,
    })
    assert.equal(data.decayPerTurn, 0.1)
    assert.equal(data.analysisModel, 'relationship-fast')
    assert.deepEqual(data.currentState, {
      trust: 0.63,
      affinity: 0.52,
      familiarity: 0.35,
      respect: 0.74,
    })
    assert.equal(data.history.length, 2)
    assert.equal(data.history[0].summary, '用户主动汇报了昨天的进展')
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('getMultiDimRelationshipConfig rejects noop and missing relationship scheme', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-relationship-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const noopResponse = getMultiDimRelationshipConfig('agent-2')
    const missingResponse = getMultiDimRelationshipConfig('agent-3')

    assert.equal(noopResponse.status, 400)
    assert.deepEqual(await noopResponse.json(), {
      error: 'Agent relationship scheme must be multi-dim',
    })
    assert.equal(missingResponse.status, 400)
    assert.deepEqual(await missingResponse.json(), {
      error: 'Agent relationship scheme must be multi-dim',
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateMultiDimRelationshipConfig only mutates modules.relationship and preserves sibling modules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-web-relationship-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const response = updateMultiDimRelationshipConfig('agent-1', {
      baseline: {
        trust: 0.71,
        familiarity: 0.4,
      },
      decayPerTurn: 0.18,
      analysisModel: 'relationship-cheap',
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      agentId: 'agent-1',
      scheme: 'multi-dim',
      baseline: {
        trust: 0.71,
        affinity: 0.48,
        familiarity: 0.4,
        respect: 0.7,
      },
      decayPerTurn: 0.18,
      analysisModel: 'relationship-cheap',
      currentState: {
        trust: 0.63,
        affinity: 0.52,
        familiarity: 0.35,
        respect: 0.74,
      },
      history: [
        {
          summary: '用户主动汇报了昨天的进展',
          trigger: '主动更新',
          delta: {
            trust: 0.08,
            affinity: 0.03,
            familiarity: 0.05,
            respect: 0.02,
          },
          createdAt: '2026-04-19T10:00:00.000Z',
        },
        {
          summary: '用户迟到但诚恳解释',
          trigger: '解释迟到',
          delta: {
            trust: -0.02,
            affinity: 0.01,
            familiarity: 0.02,
            respect: 0,
          },
          createdAt: '2026-04-19T14:00:00.000Z',
        },
      ],
    })

    assert.deepEqual(agentRepo.getAgent('agent-1')?.modules, {
      relationship: {
        scheme: 'multi-dim',
        baseline: {
          trust: 0.71,
          affinity: 0.48,
          familiarity: 0.4,
          respect: 0.7,
        },
        decayPerTurn: 0.18,
        analysisModel: 'relationship-cheap',
      },
      memory: {
        scheme: 'sqlite',
        summarizeModel: 'memory-fast',
      },
    })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
