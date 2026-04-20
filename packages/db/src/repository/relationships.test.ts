import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb } from '../client'
import {
  getRelationship,
  listRelationshipHistory,
  upsertRelationship,
} from './relationships'

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

test('upsertRelationship creates and updates a user-only relationship record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-relationships-repo-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    assert.equal(getRelationship('agent-1', 'default-user'), undefined)

    const created = upsertRelationship({
      agentId: 'agent-1',
      counterpartId: 'default-user',
      dimensions: {
        trust: 0.5,
        affinity: 0.4,
        familiarity: 0.1,
        respect: 0.5,
      },
      history: [],
      updatedAt: new Date('2026-04-20T10:00:00.000Z'),
    })

    const rawRow = getRawSqlite().prepare(`
      SELECT counterpart_type AS counterpartType
      FROM relationships
      WHERE id = ?
    `).get(created.id) as { counterpartType: string }

    assert.equal(rawRow.counterpartType, 'user')
    assert.deepEqual(created.history, [])

    const updated = upsertRelationship({
      agentId: 'agent-1',
      counterpartId: 'default-user',
      dimensions: {
        trust: 0.7,
        affinity: 0.65,
        familiarity: 0.22,
        respect: 0.58,
      },
      history: [
        {
          summary: '用户语气友好，关系略微升温',
          trigger: 'friendly turn',
          delta: {
            trust: 0.2,
            affinity: 0.25,
            familiarity: 0.12,
            respect: 0.08,
          },
          createdAt: '2026-04-20T10:01:00.000Z',
        },
      ],
      updatedAt: new Date('2026-04-20T10:01:00.000Z'),
    })

    assert.equal(updated.id, created.id)
    assert.deepEqual(updated.dimensions, {
      trust: 0.7,
      affinity: 0.65,
      familiarity: 0.22,
      respect: 0.58,
    })
    assert.equal(updated.updatedAt.toISOString(), '2026-04-20T10:01:00.000Z')
    assert.equal(listRelationshipHistory(updated.id).length, 1)
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('listRelationshipHistory preserves append order and signed deltas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-relationships-repo-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapDb(dbPath)

    const relationship = upsertRelationship({
      agentId: 'agent-1',
      counterpartId: 'default-user',
      dimensions: {
        trust: 0.15,
        affinity: 0,
        familiarity: 0.93,
        respect: 1,
      },
      history: [
        {
          summary: '先前相处顺利',
          trigger: 'older',
          delta: {
            trust: 0.1,
            affinity: 0.12,
            familiarity: 0.15,
            respect: 0.05,
          },
          createdAt: '2026-04-20T09:59:00.000Z',
        },
        {
          summary: '刚发生一次冒犯，亲和度被拉低',
          trigger: 'recent',
          delta: {
            trust: -0.95,
            affinity: -1,
            familiarity: 0.05,
            respect: 0.95,
          },
          createdAt: '2026-04-20T10:02:00.000Z',
        },
      ],
      updatedAt: new Date('2026-04-20T10:02:00.000Z'),
    })

    assert.deepEqual(listRelationshipHistory(relationship.id), [
      {
        summary: '先前相处顺利',
        trigger: 'older',
        delta: {
          trust: 0.1,
          affinity: 0.12,
          familiarity: 0.15,
          respect: 0.05,
        },
        createdAt: '2026-04-20T09:59:00.000Z',
      },
      {
        summary: '刚发生一次冒犯，亲和度被拉低',
        trigger: 'recent',
        delta: {
          trust: -0.95,
          affinity: -1,
          familiarity: 0.05,
          respect: 0.95,
        },
        createdAt: '2026-04-20T10:02:00.000Z',
      },
    ])
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
