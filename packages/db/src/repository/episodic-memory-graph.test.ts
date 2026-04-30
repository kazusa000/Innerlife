import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getMemoryDb, getMemoryRawSqlite, resetMemoryDb } from '../memory-client'
import * as graphRepo from './episodic-memory-graph'

function bootstrap(dbPath: string) {
  process.env.MAS_MEMORY_DB_PATH = dbPath
  resetMemoryDb()
  getMemoryDb(dbPath)
}

test('memory db bootstrap creates entity graph and episodic memory tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const tables = getMemoryRawSqlite()
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((row) => (row as { name: string }).name)

    assert.ok(tables.includes('memory_entities'))
    assert.ok(tables.includes('memory_entity_aliases'))
    assert.ok(tables.includes('memory_entity_edges'))
    assert.ok(tables.includes('episodic_memories'))
    assert.ok(tables.includes('episodic_memory_entities'))
    assert.ok(tables.includes('memory_entity_activations'))
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('entity graph repo creates entities with aliases and matches mention candidates without embedding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const entity = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'place',
      canonicalName: '安特卫普旧书店',
      description: '一个和海盐焦糖回忆相关的旧书店地点',
      confidence: 0.86,
      aliases: [{ alias: '旧书店', confidence: 0.8 }],
      now: new Date('2026-04-30T09:00:00.000Z'),
    })

    const exact = graphRepo.findEntityCandidates({
      agentId: 'agent-1',
      type: 'place',
      surface: '旧书店',
    })
    const fuzzy = graphRepo.findEntityCandidates({
      agentId: 'agent-1',
      type: 'place',
      surface: '那家旧书店',
    })

    assert.equal(exact[0]?.entity.id, entity.id)
    assert.equal(exact[0]?.matchKind, 'exact')
    assert.equal(fuzzy[0]?.entity.id, entity.id)
    assert.equal(fuzzy[0]?.matchKind, 'contains')
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('entity alias insertion rejects aliases identical to the canonical name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const entity = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'event',
      canonicalName: '周末 memory workshop',
      description: null,
      confidence: 0.9,
      aliases: [],
    })

    assert.equal(graphRepo.addEntityAlias({
      entityId: entity.id,
      alias: '周末 memory workshop',
      confidence: 0.95,
    }), false)

    const rows = getMemoryRawSqlite().prepare(`
      SELECT alias
      FROM memory_entity_aliases
      WHERE entity_id = ?
    `).all(entity.id)
    assert.deepEqual(rows, [])
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('entity candidate matching surfaces shared concrete suffixes without aliases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const antwerpBookstore = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'place',
      canonicalName: '安特卫普旧书店',
      description: 'WJJ 买海盐焦糖的地点',
      confidence: 0.9,
      aliases: [],
    })
    const tokyoBookstore = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'place',
      canonicalName: '东京旧书店',
      description: 'Nora 买焦糖咖啡的地点',
      confidence: 0.9,
      aliases: [],
    })
    const seaSaltCaramel = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '海盐焦糖',
      description: '糖果',
      confidence: 0.9,
      aliases: [],
    })

    const bookstoreCandidates = graphRepo.findEntityCandidates({
      agentId: 'agent-1',
      type: 'place',
      surface: '那家旧书店',
    })

    assert.deepEqual(
      bookstoreCandidates.map((candidate) => candidate.entity.id).sort(),
      [antwerpBookstore.id, tokyoBookstore.id].sort(),
    )
    assert.deepEqual(
      bookstoreCandidates.map((candidate) => candidate.matchKind),
      ['contains', 'contains'],
    )

    const caramelCandidates = graphRepo.findEntityCandidates({
      agentId: 'agent-1',
      type: 'object',
      surface: '焦糖咖啡',
    })

    assert.equal(
      caramelCandidates.some((candidate) => candidate.entity.id === seaSaltCaramel.id),
      false,
    )
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('entity activations spread one hop and recall top episodic memories by linked entity weights', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const now = new Date('2026-04-30T09:00:00.000Z')
    const wjj = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'person',
      canonicalName: 'WJJ',
      confidence: 0.95,
      aliases: [],
      now,
    })
    const bookstore = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'place',
      canonicalName: '安特卫普旧书店',
      confidence: 0.9,
      aliases: [{ alias: '旧书店', confidence: 0.8 }],
      now,
    })
    const caramel = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '海盐焦糖',
      confidence: 0.9,
      aliases: [],
      now,
    })
    const memory = graphRepo.createEpisodicMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
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

    graphRepo.upsertEntityEdge({
      agentId: 'agent-1',
      sourceEntityId: bookstore.id,
      targetEntityId: caramel.id,
      delta: 0.2,
      now,
    })
    graphRepo.activateEntities({
      agentId: 'agent-1',
      activations: [{ entityId: bookstore.id, activation: 1, reason: 'exact_single' }],
      ttlMs: 30 * 60 * 1000,
      maxActive: 20,
      spreadFactor: 0.35,
      now,
    })

    const recalled = graphRepo.recallEpisodicMemories({
      agentId: 'agent-1',
      topK: 5,
      now,
    })

    assert.equal(recalled[0]?.id, memory.id)
    assert.equal(recalled[0]?.summary, 'WJJ 在安特卫普旧书店提到过海盐焦糖。')
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
