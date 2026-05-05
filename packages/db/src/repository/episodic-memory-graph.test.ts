import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
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
    assert.ok(tables.includes('episodic_memory_activations'))
    assert.equal(tables.includes('memory_entity_activations'), false)

    const entityColumns = getMemoryRawSqlite().pragma("table_info('memory_entities')") as Array<{ name: string }>
    const entityColumnNames = entityColumns.map((column) => column.name)
    assert.ok(entityColumnNames.includes('embedding_text'))
    assert.ok(entityColumnNames.includes('embedding'))
    assert.ok(entityColumnNames.includes('embedding_model'))
    assert.ok(entityColumnNames.includes('embedding_updated_at'))

    const episodicColumns = getMemoryRawSqlite().pragma("table_info('episodic_memories')") as Array<{ name: string }>
    const episodicColumnNames = episodicColumns.map((column) => column.name)
    assert.ok(episodicColumnNames.includes('summary'))
    assert.ok(episodicColumnNames.includes('detail'))
    assert.equal(episodicColumnNames.includes('retrieval_text'), false)
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('episodic memory activations are agent scoped and expire by time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const now = new Date('2026-05-05T10:00:00.000Z')
    const later = new Date('2026-05-05T10:20:00.000Z')
    const expired = new Date('2026-05-05T10:30:00.000Z')
    const entity = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: 'Pippa长期记忆设计',
      confidence: 0.9,
      aliases: [],
      now,
    })
    const memory = graphRepo.createEpisodicMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '王家骏和 Amadeus 讨论 Pippa 的长期记忆设计。',
      sourceText: 'source',
      detail: 'detail',
      importance: 0.8,
      observedStartAt: now,
      observedEndAt: now,
      entityLinks: [{ entityId: entity.id, weight: 1 }],
      now,
    })
    graphRepo.createEpisodicMemory({
      agentId: 'agent-2',
      sessionId: 'session-2',
      summary: '另一个 agent 的情景记忆。',
      sourceText: 'source',
      detail: 'detail',
      importance: 0.8,
      observedStartAt: now,
      observedEndAt: now,
      entityLinks: [],
      now,
    })

    graphRepo.activateEpisodicMemories({
      agentId: 'agent-1',
      memories: [{ memoryId: memory.id, score: 0.42 }],
      sourceToolName: 'search_long_term_memory',
      activatedAt: now,
      expiresAt: later,
    })

    assert.deepEqual(
      graphRepo.listActiveEpisodicMemories({
        agentId: 'agent-1',
        now: new Date('2026-05-05T10:10:00.000Z'),
        limit: 5,
      }).map((item) => ({
        id: item.memory.id,
        score: item.score,
        expiresAt: item.expiresAt.toISOString(),
      })),
      [{
        id: memory.id,
        score: 0.42,
        expiresAt: later.toISOString(),
      }],
    )
    assert.deepEqual(
      graphRepo.listActiveEpisodicMemories({
        agentId: 'agent-2',
        now: new Date('2026-05-05T10:10:00.000Z'),
        limit: 5,
      }),
      [],
    )
    assert.deepEqual(
      graphRepo.listActiveEpisodicMemories({
        agentId: 'agent-1',
        now: expired,
        limit: 5,
      }),
      [],
    )
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory db bootstrap renames legacy episodic detail column and preserves data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')
  const oldDetailColumn = ['source', 'quote'].join('_')

  try {
    const sqlite = new Database(dbPath)
    sqlite.exec(`
      CREATE TABLE episodic_memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_text TEXT NOT NULL,
        ${oldDetailColumn} TEXT,
        importance REAL NOT NULL,
        observed_start_at INTEGER,
        observed_end_at INTEGER,
        created_at INTEGER NOT NULL
      );
    `)
    sqlite.prepare(`
      INSERT INTO episodic_memories (
        id,
        agent_id,
        session_id,
        summary,
        source_text,
        ${oldDetailColumn},
        importance,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('memory-1', 'agent-1', 'session-1', '旧摘要', '旧来源', '旧 detail', 0.7, 1000)
    sqlite.close()

    bootstrap(dbPath)
    const columns = getMemoryRawSqlite().pragma("table_info('episodic_memories')") as Array<{ name: string }>
    const columnNames = columns.map((column) => column.name)
    assert.ok(columnNames.includes('detail'))
    assert.equal(columnNames.includes(oldDetailColumn), false)

    const row = getMemoryRawSqlite().prepare(`
      SELECT detail
      FROM episodic_memories
      WHERE id = ?
    `).get('memory-1') as { detail: string } | undefined
    assert.equal(row?.detail, '旧 detail')
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory db bootstrap removes legacy episodic retrieval_text column and preserves summary embeddings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    const sqlite = new Database(dbPath)
    sqlite.exec(`
      CREATE TABLE episodic_memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_text TEXT NOT NULL,
        detail TEXT,
        retrieval_text TEXT NOT NULL DEFAULT '',
        retrieval_embedding TEXT NOT NULL DEFAULT '[]',
        retrieval_model TEXT NOT NULL DEFAULT '',
        importance REAL NOT NULL,
        observed_start_at INTEGER,
        observed_end_at INTEGER,
        created_at INTEGER NOT NULL
      );
      INSERT INTO episodic_memories (
        id,
        agent_id,
        session_id,
        summary,
        source_text,
        detail,
        retrieval_text,
        retrieval_embedding,
        retrieval_model,
        importance,
        created_at
      ) VALUES (
        'memory-1',
        'agent-1',
        'session-1',
        '旧摘要',
        '旧来源',
        '旧 detail',
        '旧 retrieval',
        '[1,0]',
        'summary-embed',
        0.7,
        1000
      );
    `)
    sqlite.close()

    bootstrap(dbPath)
    const columns = getMemoryRawSqlite().pragma("table_info('episodic_memories')") as Array<{ name: string }>
    const columnNames = columns.map((column) => column.name)
    assert.equal(columnNames.includes('retrieval_text'), false)

    const row = getMemoryRawSqlite().prepare(`
      SELECT summary, detail, retrieval_embedding, retrieval_model
      FROM episodic_memories
      WHERE id = ?
    `).get('memory-1') as {
      summary: string
      detail: string
      retrieval_embedding: string
      retrieval_model: string
    } | undefined
    assert.deepEqual(row, {
      summary: '旧摘要',
      detail: '旧 detail',
      retrieval_embedding: '[1,0]',
      retrieval_model: 'summary-embed',
    })
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('memory db bootstrap removes legacy persistent entity activation table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    const sqlite = new Database(dbPath)
    sqlite.exec(`
      CREATE TABLE memory_entity_activations (
        agent_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        activation REAL NOT NULL,
        reason TEXT,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(agent_id, entity_id)
      );
      CREATE INDEX idx_memory_entity_activations_expiry
        ON memory_entity_activations(agent_id, expires_at);
    `)
    sqlite.close()

    bootstrap(dbPath)
    const table = getMemoryRawSqlite().prepare(`
      SELECT 1 AS value
      FROM sqlite_master
      WHERE type = 'table' AND name = 'memory_entity_activations'
    `).get()

    assert.equal(table, undefined)
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

test('entity embedding can be persisted and is invalidated when aliases change', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const entity = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'event',
      canonicalName: '起飞',
      description: '用户喜欢的一种玩法',
      confidence: 0.9,
      aliases: [],
      now: new Date('2026-04-30T09:00:00.000Z'),
    })

    graphRepo.updateEntityEmbedding({
      entityId: entity.id,
      embeddingText: 'canonical_name: 起飞\ntype: event',
      embedding: [1, 0],
      embeddingModel: 'BAAI/bge-m3',
      now: new Date('2026-04-30T10:00:00.000Z'),
    })

    const embedded = graphRepo.getEntity(entity.id)
    assert.deepEqual(embedded?.embedding, [1, 0])
    assert.equal(embedded?.embeddingText, 'canonical_name: 起飞\ntype: event')
    assert.equal(embedded?.embeddingModel, 'BAAI/bge-m3')
    assert.equal(embedded?.embeddingUpdatedAt?.toISOString(), '2026-04-30T10:00:00.000Z')

    assert.equal(graphRepo.addEntityAlias({
      entityId: entity.id,
      alias: '跳皮',
      confidence: 0.95,
    }), true)

    const invalidated = graphRepo.getEntity(entity.id)
    assert.deepEqual(invalidated?.embedding, [])
    assert.equal(invalidated?.embeddingText, '')
    assert.equal(invalidated?.embeddingModel, '')
    assert.equal(invalidated?.embeddingUpdatedAt, null)
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

    graphRepo.upsertEntityEdge({
      agentId: 'agent-1',
      sourceEntityId: bookstore.id,
      targetEntityId: caramel.id,
      delta: 0.2,
      now,
    })
    const noActivationRecall = graphRepo.recallEpisodicMemories({
      agentId: 'agent-1',
      topK: 5,
    })

    const recalled = graphRepo.recallEpisodicMemories({
      agentId: 'agent-1',
      topK: 5,
      activations: [{ entityId: bookstore.id, activation: 1 }],
      spreadFactor: 0.35,
    })

    assert.deepEqual(noActivationRecall, [])
    assert.equal(recalled[0]?.id, memory.id)
    assert.equal(recalled[0]?.summary, 'WJJ 在安特卫普旧书店提到过海盐焦糖。')
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('episodic memories persist summary embeddings and can be ranked by text similarity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const now = new Date('2026-04-30T09:00:00.000Z')
    graphRepo.createEpisodicMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: 'WJJ 说最喜欢的游戏从魔兽世界变成星际争霸2。',
      sourceText: 'WJJ 先说最喜欢魔兽世界，后来改口星际争霸2。',
      detail: '现在最喜欢的游戏是星际争霸2',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'test-embed',
      importance: 0.8,
      entityLinks: [],
      now,
    })
    graphRepo.createEpisodicMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: 'WJJ 在安特卫普旧书店买海盐焦糖。',
      sourceText: '旧书店和海盐焦糖。',
      detail: '旧书店',
      retrievalEmbedding: [0, 1],
      retrievalModel: 'test-embed',
      importance: 0.9,
      entityLinks: [],
      now,
    })

    const hits = graphRepo.findRelevantEpisodicMemories({
      agentId: 'agent-1',
      queryEmbeddings: [[1, 0]],
      topK: 2,
      minSimilarity: 0.1,
    })

    assert.equal(hits[0]?.memory.summary, 'WJJ 说最喜欢的游戏从魔兽世界变成星际争霸2。')
    assert.equal(hits[0]?.similarity, 1)
    assert.equal(hits[0]?.memory.detail, '现在最喜欢的游戏是星际争霸2')
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateEntityByAgent replaces entity fields aliases and embedding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const entity = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '魔兽世界',
      description: '旧的游戏节点',
      confidence: 0.7,
      aliases: [{ alias: 'wow', confidence: 0.8 }],
    })

    const updated = graphRepo.updateEntityByAgent({
      agentId: 'agent-1',
      entityId: entity.id,
      type: 'object',
      canonicalName: '星际争霸2',
      description: '用户现在最喜欢的游戏',
      confidence: 0.94,
      aliases: ['星际2', 'SC2'],
      embeddingText: 'canonical_name: 星际争霸2\ntype: object',
      embedding: [0.4, 0.6],
      embeddingModel: 'BAAI/bge-m3',
      now: new Date('2026-05-01T10:00:00.000Z'),
    })
    const foreignBlocked = graphRepo.updateEntityByAgent({
      agentId: 'agent-2',
      entityId: entity.id,
      type: 'event',
      canonicalName: '不应写入',
      description: null,
      confidence: 1,
      aliases: [],
      embeddingText: 'bad',
      embedding: [9],
      embeddingModel: 'bad',
    })

    assert.equal(updated, true)
    assert.equal(foreignBlocked, false)

    const saved = graphRepo.listMemoryEntitiesByAgent('agent-1')[0]
    assert.equal(saved?.canonicalName, '星际争霸2')
    assert.equal(saved?.description, '用户现在最喜欢的游戏')
    assert.equal(saved?.confidence, 0.94)
    assert.deepEqual(saved?.aliases.sort(), ['SC2', '星际2'].sort())
    assert.deepEqual(saved?.embedding, [0.4, 0.6])
    assert.equal(saved?.embeddingModel, 'BAAI/bge-m3')
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleteEntityByAgent unlinks episodic memories and removes related edges without deleting memories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const now = new Date('2026-05-01T10:00:00.000Z')
    const cat = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '呱呱',
      confidence: 0.9,
      aliases: [{ alias: '猫', confidence: 0.8 }],
      now,
    })
    const umbrella = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '蓝色雨伞',
      confidence: 0.9,
      aliases: [],
      now,
    })
    const memory = graphRepo.createEpisodicMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '呱呱躲在蓝色雨伞旁边。',
      sourceText: '呱呱在书房。',
      detail: '呱呱躲在书房的蓝色雨伞旁边。',
      importance: 0.8,
      entityLinks: [
        { entityId: cat.id, weight: 1 },
        { entityId: umbrella.id, weight: 0.8 },
      ],
      now,
    })
    graphRepo.upsertEntityEdge({
      agentId: 'agent-1',
      sourceEntityId: cat.id,
      targetEntityId: umbrella.id,
      delta: 0.5,
      now,
    })

    const deleted = graphRepo.deleteEntityByAgent('agent-1', cat.id)

    assert.equal(deleted, true)
    assert.equal(graphRepo.getEntity(cat.id), undefined)
    assert.equal(graphRepo.getEpisodicMemory(memory.id)?.summary, '呱呱躲在蓝色雨伞旁边。')
    assert.deepEqual(
      graphRepo.getEpisodicMemoryWithEntities(memory.id)?.entities.map((link) => link.entity.id),
      [umbrella.id],
    )
    assert.deepEqual(graphRepo.listMemoryEntityEdgesByAgent('agent-1'), [])
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mergeEntitiesByAgent migrates aliases links and edges into target entity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const now = new Date('2026-05-01T10:00:00.000Z')
    const target = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '星际争霸2',
      confidence: 0.9,
      aliases: [{ alias: '星际2', confidence: 0.9 }],
      now,
    })
    const source = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: 'SC2',
      confidence: 0.8,
      aliases: [{ alias: 'starcraft2', confidence: 0.7 }],
      now,
    })
    const battleNet = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '战网',
      confidence: 0.8,
      aliases: [],
      now,
    })
    const memory = graphRepo.createEpisodicMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '用户最近重新开始玩 SC2。',
      sourceText: '用户说最近又玩 SC2。',
      detail: '用户最近又开始玩 SC2。',
      importance: 0.8,
      entityLinks: [
        { entityId: source.id, weight: 0.9 },
        { entityId: target.id, weight: 0.5 },
      ],
      now,
    })
    graphRepo.upsertEntityEdge({
      agentId: 'agent-1',
      sourceEntityId: source.id,
      targetEntityId: battleNet.id,
      delta: 0.4,
      now,
    })

    const merged = graphRepo.mergeEntitiesByAgent({
      agentId: 'agent-1',
      sourceEntityId: source.id,
      targetEntityId: target.id,
      now,
    })

    assert.equal(merged, true)
    assert.equal(graphRepo.getEntity(source.id), undefined)
    const savedTarget = graphRepo.listMemoryEntitiesByAgent('agent-1').find((entity) => entity.id === target.id)
    assert.deepEqual(savedTarget?.aliases.sort(), ['SC2', 'starcraft2', '星际2'].sort())
    assert.deepEqual(
      graphRepo.getEpisodicMemoryWithEntities(memory.id)?.entities.map((link) => [link.entity.id, link.weight]),
      [[target.id, 0.9]],
    )
    assert.deepEqual(
      graphRepo.listMemoryEntityEdgesByAgent('agent-1').map((edge) => [
        edge.sourceEntityId,
        edge.targetEntityId,
        edge.weight,
      ]),
      [[...([battleNet.id, target.id].sort()), 0.4]],
    )
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('episodic memories can be manually created updated and deleted with independent links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const now = new Date('2026-05-01T10:00:00.000Z')
    const game = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '星际争霸2',
      confidence: 0.9,
      aliases: [],
      now,
    })
    const user = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'person',
      canonicalName: 'WJJ',
      confidence: 0.95,
      aliases: [],
      now,
    })

    const created = graphRepo.createEpisodicMemory({
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: '用户喜欢星际争霸2。',
      sourceText: '用户喜欢星际争霸2。',
      detail: '用户说现在最喜欢星际争霸2。',
      retrievalEmbedding: [1, 0],
      retrievalModel: 'embed-v1',
      importance: 0.8,
      entityLinks: [{ entityId: game.id, weight: 0.9 }],
      now,
    })

    const updated = graphRepo.updateEpisodicMemoryByAgent({
      agentId: 'agent-1',
      memoryId: created.id,
      summary: 'WJJ 现在最喜欢星际争霸2。',
      detail: 'WJJ 最近又开始玩星际争霸2，并说这是现在最喜欢的游戏。',
      sourceText: 'WJJ 最近又开始玩星际争霸2，并说这是现在最喜欢的游戏。',
      retrievalEmbedding: [0.2, 0.8],
      retrievalModel: 'embed-v2',
      importance: 0.95,
      observedStartAt: new Date('2026-04-30T12:00:00.000Z'),
      observedEndAt: new Date('2026-04-30T13:00:00.000Z'),
      entityLinks: [
        { entityId: user.id, weight: 0.8 },
        { entityId: game.id, weight: 1 },
      ],
    })

    assert.equal(updated, true)
    const saved = graphRepo.getEpisodicMemoryWithEntities(created.id)
    assert.equal(saved?.summary, 'WJJ 现在最喜欢星际争霸2。')
    assert.equal(saved?.detail, 'WJJ 最近又开始玩星际争霸2，并说这是现在最喜欢的游戏。')
    assert.deepEqual(saved?.retrievalEmbedding, [0.2, 0.8])
    assert.equal(saved?.retrievalModel, 'embed-v2')
    assert.equal(saved?.importance, 0.95)
    assert.deepEqual(
      saved?.entities.map((link) => [link.entity.id, link.weight]).sort(),
      [[game.id, 1], [user.id, 0.8]].sort(),
    )
    assert.deepEqual(graphRepo.listMemoryEntityEdgesByAgent('agent-1'), [])

    assert.equal(graphRepo.deleteEpisodicMemoryByAgent('agent-1', created.id), true)
    assert.equal(graphRepo.getEpisodicMemory(created.id), undefined)
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('manual entity edges can be upserted and deleted independently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-entity-graph-'))
  const dbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath)
    const now = new Date('2026-05-01T10:00:00.000Z')
    const left = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '游戏',
      confidence: 0.9,
      aliases: [],
      now,
    })
    const right = graphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '星际争霸2',
      confidence: 0.9,
      aliases: [],
      now,
    })

    assert.equal(graphRepo.setEntityEdgeByAgent({
      agentId: 'agent-1',
      sourceEntityId: left.id,
      targetEntityId: right.id,
      weight: 0.77,
      coOccurrenceCount: 3,
      now,
    }), true)
    assert.equal(graphRepo.listMemoryEntityEdgesByAgent('agent-1')[0]?.weight, 0.77)
    assert.equal(graphRepo.listMemoryEntityEdgesByAgent('agent-1')[0]?.coOccurrenceCount, 3)

    assert.equal(graphRepo.deleteEntityEdgeByAgent({
      agentId: 'agent-1',
      sourceEntityId: left.id,
      targetEntityId: right.id,
    }), true)
    assert.deepEqual(graphRepo.listMemoryEntityEdgesByAgent('agent-1'), [])
  } finally {
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
