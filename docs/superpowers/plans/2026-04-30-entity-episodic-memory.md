# Entity Episodic Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the next-stage `long_term/fixed` memory direction with a sqlite-backed entity graph that recalls top episodic memories through persona-level entity activation.

**Architecture:** Keep existing `short_term` memory rows as the staging material, add entity graph and episodic-memory tables to `memory.db`, then wire daemon sleep to perform two-stage STM -> episodic consolidation. Chat recall will identify entity mentions, activate existing entity nodes without mutating the graph, spread activation one hop, and inject top 5 episodic memories into the memory prompt fragment.

**Tech Stack:** TypeScript, Node.js test runner, better-sqlite3, existing `@mas/db`, `@mas/systems`, `@mas/core`, and `@mas/daemon` packages. No embedding, no ChromaDB, no typed edges in this first version.

---

## File Map

- Modify: `packages/db/src/memory-client.ts`
- Create: `packages/db/src/repository/episodic-memory-graph.ts`
- Create: `packages/db/src/repository/episodic-memory-graph.test.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/systems/src/memory/entity-graph.ts`
- Create: `packages/systems/src/memory/entity-graph.test.ts`
- Modify: `packages/systems/src/memory/index.ts`
- Modify: `packages/systems/src/memory/sqlite.ts`
- Modify: `packages/systems/src/memory/sqlite.test.ts`
- Modify: `packages/core/src/agent/pending/memory-query.ts`
- Modify: `packages/core/src/agent/memory-runner.test.ts`
- Modify: `packages/daemon/src/memory-jobs.ts`
- Create: `packages/daemon/src/episodic-memory-jobs.test.ts`
- Modify: `packages/core/src/tools/search-long-term-memory.ts`
- Modify: `packages/core/src/tools/search-long-term-memory.test.ts`
- Modify: `project-docs/STATUS.md` only after the implementation is merged and verified.

## Implementation Sequence

### Task 1: Add Entity Graph Persistence

**Files:**
- Modify: `packages/db/src/memory-client.ts`
- Create: `packages/db/src/repository/episodic-memory-graph.ts`
- Create: `packages/db/src/repository/episodic-memory-graph.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing schema bootstrap test**

Add this test to `packages/db/src/repository/episodic-memory-graph.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getMemoryDb, getMemoryRawSqlite, resetMemoryDb } from '../memory-client'

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
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/db/src/repository/episodic-memory-graph.test.ts
```

Expected: FAIL because the graph tables do not exist.

- [ ] **Step 3: Extend memory DB bootstrap**

In `packages/db/src/memory-client.ts`, extend `ensureMemoryDbSchema()` with:

```ts
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS memory_entities (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    type TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    description TEXT,
    confidence REAL NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    last_seen_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_memory_entities_agent_type_name
    ON memory_entities(agent_id, type, canonical_name);
  CREATE INDEX IF NOT EXISTS idx_memory_entities_agent_last_seen
    ON memory_entities(agent_id, last_seen_at);

  CREATE TABLE IF NOT EXISTS memory_entity_aliases (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    confidence REAL NOT NULL,
    source_memory_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    last_seen_at INTEGER,
    UNIQUE(entity_id, alias)
  );
  CREATE INDEX IF NOT EXISTS idx_memory_entity_aliases_alias
    ON memory_entity_aliases(alias);

  CREATE TABLE IF NOT EXISTS memory_entity_edges (
    agent_id TEXT NOT NULL,
    source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    weight REAL NOT NULL,
    co_occurrence_count INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY(agent_id, source_entity_id, target_entity_id)
  );

  CREATE TABLE IF NOT EXISTS episodic_memories (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    source_text TEXT NOT NULL,
    source_quote TEXT,
    importance REAL NOT NULL,
    observed_start_at INTEGER,
    observed_end_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_episodic_memories_agent_created
    ON episodic_memories(agent_id, created_at);

  CREATE TABLE IF NOT EXISTS episodic_memory_entities (
    memory_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    weight REAL NOT NULL,
    PRIMARY KEY(memory_id, entity_id)
  );
  CREATE INDEX IF NOT EXISTS idx_episodic_memory_entities_entity
    ON episodic_memory_entities(entity_id);

  CREATE TABLE IF NOT EXISTS memory_entity_activations (
    agent_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    activation REAL NOT NULL,
    reason TEXT,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(agent_id, entity_id)
  );
  CREATE INDEX IF NOT EXISTS idx_memory_entity_activations_expiry
    ON memory_entity_activations(agent_id, expires_at);
`)
```

- [ ] **Step 4: Run the schema test and verify GREEN**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/db/src/repository/episodic-memory-graph.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing repository tests for create, match, activate, and recall**

Append these tests to `packages/db/src/repository/episodic-memory-graph.test.ts`:

```ts
import * as graphRepo from './episodic-memory-graph'

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
```

- [ ] **Step 6: Run repository tests and verify RED**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/db/src/repository/episodic-memory-graph.test.ts
```

Expected: FAIL because `episodic-memory-graph.ts` is not implemented.

- [ ] **Step 7: Implement the graph repository**

Create `packages/db/src/repository/episodic-memory-graph.ts` with focused exported functions:

```ts
import { randomUUID } from 'node:crypto'
import { getMemoryRawSqlite } from '../memory-client'

export type EntityType = 'person' | 'place' | 'object' | 'project' | 'event' | 'unknown'
export type MatchKind = 'exact' | 'contains'

export interface MemoryEntityRecord {
  id: string
  agentId: string
  type: EntityType
  canonicalName: string
  description: string | null
  confidence: number
  createdAt: Date
  lastSeenAt: Date | null
}

export interface EpisodicMemoryRecord {
  id: string
  agentId: string
  sessionId: string
  summary: string
  sourceText: string
  sourceQuote: string | null
  importance: number
  observedStartAt: Date | null
  observedEndAt: Date | null
  createdAt: Date
}

function normalizeType(type: string): EntityType {
  return type === 'person' || type === 'place' || type === 'object' || type === 'project' || type === 'event'
    ? type
    : 'unknown'
}

function clip01(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function sortedPair(left: string, right: string) {
  return left < right ? [left, right] : [right, left]
}

export function createEntity(input: {
  agentId: string
  type: EntityType
  canonicalName: string
  description?: string | null
  confidence: number
  aliases: Array<{ alias: string; confidence: number }>
  now?: Date
}) {
  const sqlite = getMemoryRawSqlite()
  const now = input.now ?? new Date()
  const id = randomUUID()
  sqlite.prepare(`
    INSERT INTO memory_entities (
      id, agent_id, type, canonical_name, description, confidence, created_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.agentId,
    normalizeType(input.type),
    input.canonicalName.trim(),
    input.description?.trim() || null,
    clip01(input.confidence),
    now.getTime(),
    now.getTime(),
  )

  for (const alias of input.aliases) {
    addEntityAlias({
      entityId: id,
      alias: alias.alias,
      confidence: alias.confidence,
      now,
    })
  }

  return getEntity(id)!
}

export function getEntity(entityId: string) {
  const row = getMemoryRawSqlite().prepare(`
    SELECT id, agent_id, type, canonical_name, description, confidence, created_at, last_seen_at
    FROM memory_entities
    WHERE id = ?
  `).get(entityId) as {
    id: string
    agent_id: string
    type: string
    canonical_name: string
    description: string | null
    confidence: number
    created_at: number
    last_seen_at: number | null
  } | undefined
  if (!row) return undefined
  return {
    id: row.id,
    agentId: row.agent_id,
    type: normalizeType(row.type),
    canonicalName: row.canonical_name,
    description: row.description,
    confidence: row.confidence,
    createdAt: new Date(row.created_at),
    lastSeenAt: typeof row.last_seen_at === 'number' ? new Date(row.last_seen_at) : null,
  }
}

export function addEntityAlias(input: {
  entityId: string
  alias: string
  confidence: number
  sourceMemoryId?: string | null
  now?: Date
}) {
  const alias = input.alias.trim()
  if (!alias) return false
  const now = input.now ?? new Date()
  const result = getMemoryRawSqlite().prepare(`
    INSERT OR IGNORE INTO memory_entity_aliases (
      id, entity_id, alias, confidence, source_memory_id, created_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), input.entityId, alias, clip01(input.confidence), input.sourceMemoryId ?? null, now.getTime(), now.getTime())
  return result.changes > 0
}

export function findEntityCandidates(input: {
  agentId: string
  type: EntityType
  surface: string
  limit?: number
}) {
  const surface = input.surface.trim()
  if (!surface) return []
  const sqlite = getMemoryRawSqlite()
  const types = input.type === 'unknown' ? ['unknown'] : [input.type, 'unknown']
  const placeholders = types.map(() => '?').join(', ')
  const rows = sqlite.prepare(`
    SELECT DISTINCT e.id
    FROM memory_entities e
    LEFT JOIN memory_entity_aliases a ON a.entity_id = e.id
    WHERE e.agent_id = ?
      AND e.type IN (${placeholders})
      AND (
        e.canonical_name = ?
        OR a.alias = ?
        OR instr(?, e.canonical_name) > 0
        OR instr(e.canonical_name, ?) > 0
        OR instr(?, a.alias) > 0
        OR instr(a.alias, ?) > 0
      )
    LIMIT ?
  `).all(input.agentId, ...types, surface, surface, surface, surface, surface, surface, input.limit ?? 10) as Array<{ id: string }>

  return rows
    .map((row) => getEntity(row.id))
    .filter((entity): entity is MemoryEntityRecord => Boolean(entity))
    .map((entity) => ({
      entity,
      matchKind: entity.canonicalName === surface ? 'exact' as const : 'contains' as const,
    }))
}

export function createEpisodicMemory(input: {
  agentId: string
  sessionId: string
  summary: string
  sourceText: string
  sourceQuote?: string | null
  importance: number
  observedStartAt?: Date | null
  observedEndAt?: Date | null
  entityLinks: Array<{ entityId: string; weight: number }>
  now?: Date
}) {
  const sqlite = getMemoryRawSqlite()
  const now = input.now ?? new Date()
  const id = randomUUID()
  sqlite.prepare(`
    INSERT INTO episodic_memories (
      id, agent_id, session_id, summary, source_text, source_quote, importance,
      observed_start_at, observed_end_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.agentId,
    input.sessionId,
    input.summary.trim(),
    input.sourceText,
    input.sourceQuote?.trim() || null,
    clip01(input.importance),
    input.observedStartAt?.getTime() ?? null,
    input.observedEndAt?.getTime() ?? null,
    now.getTime(),
  )

  for (const link of input.entityLinks.slice(0, 5)) {
    if (link.weight < 0.3) continue
    sqlite.prepare(`
      INSERT OR REPLACE INTO episodic_memory_entities (memory_id, entity_id, weight)
      VALUES (?, ?, ?)
    `).run(id, link.entityId, clip01(link.weight))
  }

  return getEpisodicMemory(id)!
}

export function getEpisodicMemory(memoryId: string) {
  const row = getMemoryRawSqlite().prepare(`
    SELECT id, agent_id, session_id, summary, source_text, source_quote, importance,
      observed_start_at, observed_end_at, created_at
    FROM episodic_memories
    WHERE id = ?
  `).get(memoryId) as {
    id: string
    agent_id: string
    session_id: string
    summary: string
    source_text: string
    source_quote: string | null
    importance: number
    observed_start_at: number | null
    observed_end_at: number | null
    created_at: number
  } | undefined
  if (!row) return undefined
  return {
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    summary: row.summary,
    sourceText: row.source_text,
    sourceQuote: row.source_quote,
    importance: row.importance,
    observedStartAt: typeof row.observed_start_at === 'number' ? new Date(row.observed_start_at) : null,
    observedEndAt: typeof row.observed_end_at === 'number' ? new Date(row.observed_end_at) : null,
    createdAt: new Date(row.created_at),
  }
}

export function upsertEntityEdge(input: {
  agentId: string
  sourceEntityId: string
  targetEntityId: string
  delta: number
  now?: Date
}) {
  if (input.sourceEntityId === input.targetEntityId) return
  const [source, target] = sortedPair(input.sourceEntityId, input.targetEntityId)
  const now = input.now ?? new Date()
  getMemoryRawSqlite().prepare(`
    INSERT INTO memory_entity_edges (
      agent_id, source_entity_id, target_entity_id, weight, co_occurrence_count, last_seen_at
    ) VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(agent_id, source_entity_id, target_entity_id) DO UPDATE SET
      weight = min(1.0, weight + excluded.weight),
      co_occurrence_count = co_occurrence_count + 1,
      last_seen_at = excluded.last_seen_at
  `).run(input.agentId, source, target, clip01(input.delta), now.getTime())
}

export function activateEntities(input: {
  agentId: string
  activations: Array<{ entityId: string; activation: number; reason: string }>
  ttlMs: number
  maxActive: number
  spreadFactor: number
  now?: Date
}) {
  const sqlite = getMemoryRawSqlite()
  const now = input.now ?? new Date()
  const expiresAt = now.getTime() + input.ttlMs
  sqlite.prepare(`DELETE FROM memory_entity_activations WHERE agent_id = ? AND expires_at <= ?`)
    .run(input.agentId, now.getTime())

  const direct = input.activations.map((item) => ({
    entityId: item.entityId,
    activation: clip01(item.activation),
    reason: item.reason,
  }))
  const spread = direct.flatMap((item) => {
    const rows = sqlite.prepare(`
      SELECT source_entity_id, target_entity_id, weight
      FROM memory_entity_edges
      WHERE agent_id = ? AND (source_entity_id = ? OR target_entity_id = ?)
    `).all(input.agentId, item.entityId, item.entityId) as Array<{ source_entity_id: string; target_entity_id: string; weight: number }>
    return rows.map((row) => ({
      entityId: row.source_entity_id === item.entityId ? row.target_entity_id : row.source_entity_id,
      activation: clip01(item.activation * row.weight * input.spreadFactor),
      reason: 'spread',
    }))
  })

  for (const item of [...direct, ...spread]) {
    if (item.activation <= 0) continue
    sqlite.prepare(`
      INSERT INTO memory_entity_activations (
        agent_id, entity_id, activation, reason, expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, entity_id) DO UPDATE SET
        activation = min(1.0, activation + excluded.activation),
        reason = excluded.reason,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(input.agentId, item.entityId, item.activation, item.reason, expiresAt, now.getTime())
  }

  const overflow = sqlite.prepare(`
    SELECT entity_id
    FROM memory_entity_activations
    WHERE agent_id = ?
    ORDER BY activation DESC, updated_at DESC
    LIMIT -1 OFFSET ?
  `).all(input.agentId, input.maxActive) as Array<{ entity_id: string }>
  for (const row of overflow) {
    sqlite.prepare(`DELETE FROM memory_entity_activations WHERE agent_id = ? AND entity_id = ?`)
      .run(input.agentId, row.entity_id)
  }
}

export function recallEpisodicMemories(input: {
  agentId: string
  topK: number
  now?: Date
}) {
  const now = input.now ?? new Date()
  const rows = getMemoryRawSqlite().prepare(`
    SELECT
      m.id,
      sum(a.activation * l.weight) + (0.15 * m.importance) + (0.1 * max(0, count(distinct l.entity_id) - 1)) AS score
    FROM memory_entity_activations a
    JOIN episodic_memory_entities l ON l.entity_id = a.entity_id
    JOIN episodic_memories m ON m.id = l.memory_id
    WHERE a.agent_id = ?
      AND m.agent_id = ?
      AND a.expires_at > ?
    GROUP BY m.id
    ORDER BY score DESC, m.created_at DESC
    LIMIT ?
  `).all(input.agentId, input.agentId, now.getTime(), input.topK) as Array<{ id: string }>

  return rows
    .map((row) => getEpisodicMemory(row.id))
    .filter((memory): memory is EpisodicMemoryRecord => Boolean(memory))
}
```

- [ ] **Step 8: Export the repository**

Modify `packages/db/src/index.ts`:

```ts
export * as episodicMemoryGraphRepo from './repository/episodic-memory-graph'
```

- [ ] **Step 9: Run repository tests and typecheck**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/db/src/repository/episodic-memory-graph.test.ts
npm run typecheck --workspace @mas/db
```

Expected: both commands PASS.

- [ ] **Step 10: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add packages/db/src/memory-client.ts packages/db/src/index.ts packages/db/src/repository/episodic-memory-graph.ts packages/db/src/repository/episodic-memory-graph.test.ts
git commit -m "feat(db): add episodic entity graph repository"
```

### Task 2: Add Entity Mention Parsing and Prompt Helpers

**Files:**
- Create: `packages/systems/src/memory/entity-graph.ts`
- Create: `packages/systems/src/memory/entity-graph.test.ts`
- Modify: `packages/systems/src/memory/index.ts`

- [ ] **Step 1: Write failing parser tests**

Create `packages/systems/src/memory/entity-graph.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEntityMentionPrompt,
  parseEntityMentionResponse,
  parseEpisodicExtractionResponse,
  parseEntityResolutionResponse,
} from './entity-graph'

test('entity mention prompt forbids graph mutation during chat recall', () => {
  const prompt = buildEntityMentionPrompt()
  assert.match(prompt, /不要创建实体/)
  assert.match(prompt, /不要合并实体/)
  assert.match(prompt, /不要新增 alias/)
})

test('parseEntityMentionResponse accepts typed mentions with context hints', () => {
  const parsed = parseEntityMentionResponse(JSON.stringify({
    mentions: [
      {
        surface: '那家旧书店',
        type: 'place',
        context_hint: '用户追问先前提到的旧书店地点',
        confidence: 0.86,
      },
      {
        surface: '情绪',
        type: 'concept',
        context_hint: '抽象概念，第一版不应保留',
        confidence: 0.9,
      },
    ],
  }))

  assert.deepEqual(parsed, [
    {
      surface: '那家旧书店',
      type: 'place',
      contextHint: '用户追问先前提到的旧书店地点',
      confidence: 0.86,
    },
  ])
})

test('parseEpisodicExtractionResponse enforces max links and drops weak links', () => {
  const parsed = parseEpisodicExtractionResponse(JSON.stringify({
    entities: [
      { local_entity_id: 'e1', surface: 'WJJ', type: 'person', context_hint: '当前对话对象', aliases: [] },
      { local_entity_id: 'e2', surface: '旧书店', type: 'place', context_hint: '地点', aliases: ['那家书店'] },
      { local_entity_id: 'e3', surface: '海盐焦糖', type: 'object', context_hint: '物品', aliases: [] },
      { local_entity_id: 'e4', surface: '雨天', type: 'event', context_hint: '事件背景', aliases: [] },
      { local_entity_id: 'e5', surface: '项目', type: 'project', context_hint: '项目', aliases: [] },
      { local_entity_id: 'e6', surface: '背景音乐', type: 'object', context_hint: '弱背景', aliases: [] },
    ],
    episodic_memories: [
      {
        summary: 'WJJ 在旧书店提到过海盐焦糖。',
        source_quote: '旧书店那次买了海盐焦糖',
        importance: 0.72,
        entity_links: [
          { local_entity_id: 'e1', weight: 0.8 },
          { local_entity_id: 'e2', weight: 1 },
          { local_entity_id: 'e3', weight: 0.7 },
          { local_entity_id: 'e4', weight: 0.4 },
          { local_entity_id: 'e5', weight: 0.3 },
          { local_entity_id: 'e6', weight: 0.2 },
        ],
      },
    ],
  }))

  assert.equal(parsed.entities.length, 6)
  assert.equal(parsed.episodicMemories[0]?.entityLinks.length, 5)
  assert.equal(parsed.episodicMemories[0]?.entityLinks.some((link) => link.localEntityId === 'e6'), false)
})

test('parseEntityResolutionResponse only merges above threshold', () => {
  const parsed = parseEntityResolutionResponse(JSON.stringify({
    resolutions: [
      {
        local_entity_id: 'e1',
        action: 'merge',
        entity_id: 'existing-1',
        confidence: 0.82,
        alias_to_add: '那家旧书店',
      },
      {
        local_entity_id: 'e2',
        action: 'merge',
        entity_id: 'existing-2',
        confidence: 0.7,
      },
      {
        local_entity_id: 'e3',
        action: 'create_new',
        canonical_name: '海盐焦糖',
        type: 'object',
        confidence: 0.78,
      },
    ],
  }))

  assert.deepEqual(parsed.map((item) => item.action), ['merge', 'create_new', 'create_new'])
  assert.equal(parsed[0]?.aliasToAdd, '那家旧书店')
  assert.equal(parsed[1]?.localEntityId, 'e2')
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/systems/src/memory/entity-graph.test.ts
```

Expected: FAIL because `entity-graph.ts` does not exist.

- [ ] **Step 3: Implement parser and prompt helpers**

Create `packages/systems/src/memory/entity-graph.ts`:

```ts
export type MemoryEntityType = 'person' | 'place' | 'object' | 'project' | 'event' | 'unknown'

export interface EntityMention {
  surface: string
  type: MemoryEntityType
  contextHint: string
  confidence: number
}

export interface EpisodicExtractionEntity {
  localEntityId: string
  surface: string
  type: MemoryEntityType
  contextHint: string
  aliases: string[]
}

export interface EpisodicMemoryDraft {
  summary: string
  sourceQuote: string | null
  importance: number
  entityLinks: Array<{ localEntityId: string; weight: number }>
}

export type EntityResolution =
  | {
      localEntityId: string
      action: 'merge'
      entityId: string
      confidence: number
      aliasToAdd: string | null
    }
  | {
      localEntityId: string
      action: 'create_new'
      canonicalName: string
      type: MemoryEntityType
      confidence: number
    }

const ENTITY_TYPES = new Set(['person', 'place', 'object', 'project', 'event', 'unknown'])

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  const parsed = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected JSON object')
  }
  return parsed as Record<string, unknown>
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function confidence(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0.5
}

function type(value: unknown): MemoryEntityType {
  const candidate = text(value)
  return ENTITY_TYPES.has(candidate) ? candidate as MemoryEntityType : 'unknown'
}

export function buildEntityMentionPrompt() {
  return [
    '你是实体 mention 提取器，只服务当前聊天召回。',
    '请从当前用户消息中提取真实实体 mention：person/place/object/project/event/unknown。',
    '不要提取抽象概念、情绪标签、关系解释或心理分析。',
    '不要创建实体、不要合并实体、不要新增 alias；你只输出当前文本中的 mention。',
    '返回 JSON：{"mentions":[{"surface":string,"type":string,"context_hint":string,"confidence":number}]}。',
    'surface 必须来自原文或原文里的稳定称呼；context_hint 用一句话说明这个 mention 在当前语境里指什么。',
    '如果没有实体，返回 {"mentions":[]}。',
  ].join('\n')
}

export function parseEntityMentionResponse(responseText: string): EntityMention[] {
  const parsed = parseJsonObject(responseText)
  const rawMentions = Array.isArray(parsed.mentions) ? parsed.mentions : []
  return rawMentions.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const surface = text(record.surface)
    const resolvedType = type(record.type)
    if (!surface || resolvedType === 'unknown' && text(record.type) && text(record.type) !== 'unknown') return []
    return [{
      surface,
      type: resolvedType,
      contextHint: text(record.context_hint),
      confidence: confidence(record.confidence),
    }]
  })
}

export function parseEpisodicExtractionResponse(responseText: string): {
  entities: EpisodicExtractionEntity[]
  episodicMemories: EpisodicMemoryDraft[]
} {
  const parsed = parseJsonObject(responseText)
  const entities = (Array.isArray(parsed.entities) ? parsed.entities : []).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const localEntityId = text(record.local_entity_id)
    const surface = text(record.surface)
    if (!localEntityId || !surface) return []
    return [{
      localEntityId,
      surface,
      type: type(record.type),
      contextHint: text(record.context_hint),
      aliases: Array.isArray(record.aliases) ? record.aliases.map(text).filter(Boolean) : [],
    }]
  })
  const entityIds = new Set(entities.map((entity) => entity.localEntityId))
  const episodicMemories = (Array.isArray(parsed.episodic_memories) ? parsed.episodic_memories : []).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const summary = text(record.summary)
    if (!summary) return []
    const entityLinks = (Array.isArray(record.entity_links) ? record.entity_links : [])
      .flatMap((link) => {
        if (!link || typeof link !== 'object' || Array.isArray(link)) return []
        const linkRecord = link as Record<string, unknown>
        const localEntityId = text(linkRecord.local_entity_id)
        const weight = confidence(linkRecord.weight)
        return entityIds.has(localEntityId) && weight >= 0.3 ? [{ localEntityId, weight }] : []
      })
      .slice(0, 5)
    return [{
      summary,
      sourceQuote: text(record.source_quote) || null,
      importance: confidence(record.importance),
      entityLinks,
    }]
  })
  return { entities, episodicMemories }
}

export function parseEntityResolutionResponse(responseText: string): EntityResolution[] {
  const parsed = parseJsonObject(responseText)
  return (Array.isArray(parsed.resolutions) ? parsed.resolutions : []).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const localEntityId = text(record.local_entity_id)
    if (!localEntityId) return []
    const action = text(record.action)
    const score = confidence(record.confidence)
    if (action === 'merge' && score >= 0.75 && text(record.entity_id)) {
      return [{
        localEntityId,
        action: 'merge' as const,
        entityId: text(record.entity_id),
        confidence: score,
        aliasToAdd: text(record.alias_to_add) || null,
      }]
    }
    return [{
      localEntityId,
      action: 'create_new' as const,
      canonicalName: text(record.canonical_name),
      type: type(record.type),
      confidence: score,
    }]
  })
}
```

- [ ] **Step 4: Export helpers**

Modify `packages/systems/src/memory/index.ts`:

```ts
export * from './entity-graph'
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/systems/src/memory/entity-graph.test.ts
npm run typecheck --workspace @mas/systems
```

Expected: both commands PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add packages/systems/src/memory/entity-graph.ts packages/systems/src/memory/entity-graph.test.ts packages/systems/src/memory/index.ts
git commit -m "feat(systems): add entity graph memory parsers"
```

### Task 3: Implement STM to Episodic Daemon Consolidation

**Files:**
- Modify: `packages/daemon/src/memory-jobs.ts`
- Create: `packages/daemon/src/episodic-memory-jobs.test.ts`

- [ ] **Step 1: Write failing daemon job test**

Create `packages/daemon/src/episodic-memory-jobs.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bootstrapAppDatabases, getMemoryDb, resetDb, resetMemoryDb, agentRepo, memoryRepo, episodicMemoryGraphRepo } from '@mas/db'
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
    agentRepo.createAgent({
      name: 'Amadeus',
      description: '',
      model: 'claude-sonnet-4-6',
      provider: 'openrouter',
      modules: { memory: { scheme: 'sqlite' } },
    })
    const agent = agentRepo.listAgents()[0]!
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
            content: [{ type: 'text', text: JSON.stringify({
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
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({
            resolutions: [
              { local_entity_id: 'e1', action: 'create_new', canonical_name: 'WJJ', type: 'person', confidence: 0.95 },
              { local_entity_id: 'e2', action: 'create_new', canonical_name: '旧书店', type: 'place', confidence: 0.8 },
              { local_entity_id: 'e3', action: 'create_new', canonical_name: '海盐焦糖', type: 'object', confidence: 0.86 },
            ],
          }) }],
          stopReason: 'end_turn',
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
```

- [ ] **Step 2: Run daemon test and verify RED**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/daemon/src/episodic-memory-jobs.test.ts
```

Expected: FAIL because `runEpisodicConsolidationForAgent` does not exist.

- [ ] **Step 3: Implement two-stage consolidation**

In `packages/daemon/src/memory-jobs.ts`, add:

```ts
export async function runEpisodicConsolidationForAgent(input: {
  agentId: string
  now?: Date
  provider?: Pick<LLMProvider, 'sendMessage'>
  signal?: AbortSignal
}) {
  const agent = agentRepo.getAgent(input.agentId)
  if (!agent || !isSqliteMemoryConfig(agent.modules?.memory)) {
    return { ok: false as const, reason: 'memory_not_sqlite' as const }
  }

  const now = input.now ?? new Date()
  const memoryConfig = resolveMemorySqliteConfig(agent.modules?.memory)
  const provider = input.provider ?? createProvider(agent.provider)
  const shortTermMemories = memoryRepo
    .listMemoriesByAgentOldestFirst(agent.id)
    .filter((memory) => memory.layer === 'short_term')

  if (shortTermMemories.length === 0) {
    return {
      ok: true as const,
      createdEntityCount: 0,
      createdEpisodicCount: 0,
      deletedShortTermCount: 0,
    }
  }

  const sourceText = buildShortTermToLongTermSourceText(shortTermMemories)
  const extractionResponse = await provider.sendMessage({
    model: memoryConfig.summarizeModel ?? agent.model,
    systemPrompt: [
      '阶段 A：从 STM 抽取实体和情景记忆。',
      '只输出 entities 与 episodic_memories JSON。',
      '每条情景记忆最多 5 个 entity_links；weight < 0.3 不输出。',
    ].join('\n'),
    messages: [{ role: 'user', content: [{ type: 'text', text: sourceText }] }],
    reasoning: { effort: 'none' },
    signal: input.signal,
  })
  const extraction = parseEpisodicExtractionResponse(extractText(extractionResponse.content))
  const candidatePayload = extraction.entities.map((entity) => ({
    local_entity_id: entity.localEntityId,
    surface: entity.surface,
    type: entity.type,
    context_hint: entity.contextHint,
    candidates: episodicMemoryGraphRepo.findEntityCandidates({
      agentId: agent.id,
      type: entity.type,
      surface: entity.surface,
      limit: 10,
    }).map((candidate) => ({
      entity_id: candidate.entity.id,
      canonical_name: candidate.entity.canonicalName,
      type: candidate.entity.type,
      description: candidate.entity.description,
      match_kind: candidate.matchKind,
    })),
  }))

  const resolutionResponse = await provider.sendMessage({
    model: memoryConfig.summarizeModel ?? agent.model,
    systemPrompt: [
      '阶段 B：判断 local entity 是否应 merge 到候选实体，或 create_new。',
      '只有 confidence >= 0.75 才允许 merge。',
      '不确定就 create_new。alias_to_add 只能来自原文或稳定叫法。',
    ].join('\n'),
    messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(candidatePayload, null, 2) }] }],
    reasoning: { effort: 'none' },
    signal: input.signal,
  })
  const resolutions = parseEntityResolutionResponse(extractText(resolutionResponse.content))
  const entityIdsByLocalId = new Map<string, string>()
  let createdEntityCount = 0

  for (const resolution of resolutions) {
    if (resolution.action === 'merge') {
      entityIdsByLocalId.set(resolution.localEntityId, resolution.entityId)
      if (resolution.aliasToAdd) {
        episodicMemoryGraphRepo.addEntityAlias({
          entityId: resolution.entityId,
          alias: resolution.aliasToAdd,
          confidence: resolution.confidence,
          now,
        })
      }
    } else {
      const sourceEntity = extraction.entities.find((entity) => entity.localEntityId === resolution.localEntityId)
      const entity = episodicMemoryGraphRepo.createEntity({
        agentId: agent.id,
        type: resolution.type,
        canonicalName: resolution.canonicalName || sourceEntity?.surface || 'unknown',
        description: sourceEntity?.contextHint ?? null,
        confidence: resolution.confidence,
        aliases: sourceEntity?.aliases.map((alias) => ({ alias, confidence: 0.7 })) ?? [],
        now,
      })
      createdEntityCount += 1
      entityIdsByLocalId.set(resolution.localEntityId, entity.id)
    }
  }

  const createdMemories = []
  for (const draft of extraction.episodicMemories) {
    const entityLinks = draft.entityLinks
      .map((link) => ({ entityId: entityIdsByLocalId.get(link.localEntityId), weight: link.weight }))
      .filter((link): link is { entityId: string; weight: number } => Boolean(link.entityId))
      .slice(0, 5)
    if (entityLinks.length === 0) continue
    const created = episodicMemoryGraphRepo.createEpisodicMemory({
      agentId: agent.id,
      sessionId: shortTermMemories[0]!.sessionId,
      summary: draft.summary,
      sourceText,
      sourceQuote: draft.sourceQuote,
      importance: draft.importance,
      observedStartAt: getObservedRangeFromMemories(shortTermMemories).observedStartAt,
      observedEndAt: getObservedRangeFromMemories(shortTermMemories).observedEndAt,
      entityLinks,
      now,
    })
    createdMemories.push(created)
    for (let left = 0; left < entityLinks.length; left += 1) {
      for (let right = left + 1; right < entityLinks.length; right += 1) {
        const leftLink = entityLinks[left]!
        const rightLink = entityLinks[right]!
        episodicMemoryGraphRepo.upsertEntityEdge({
          agentId: agent.id,
          sourceEntityId: leftLink.entityId,
          targetEntityId: rightLink.entityId,
          delta: 0.1 * Math.min(leftLink.weight, rightLink.weight) * draft.importance,
          now,
        })
      }
    }
  }

  for (const memory of shortTermMemories) {
    memoryRepo.deleteSqliteMemoryByAgent(agent.id, memory.id)
  }

  return {
    ok: true as const,
    createdEntityCount,
    createdEpisodicCount: createdMemories.length,
    deletedShortTermCount: shortTermMemories.length,
  }
}
```

Add a local helper if one does not already exist in the file:

```ts
function extractText(content: Array<{ type: string; text?: string }>) {
  return content.map((block) => block.type === 'text' ? block.text ?? '' : '').join('\n')
}
```

- [ ] **Step 4: Run daemon test and targeted daemon tests**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/daemon/src/episodic-memory-jobs.test.ts
node --import tsx --test packages/daemon/src/memory-jobs.test.ts
```

Expected: both commands PASS.

- [ ] **Step 5: Decide integration mode for sleep**

Keep existing `runSleepForAgent()` intact in this task. Do not replace production sleep yet. This task only adds `runEpisodicConsolidationForAgent()` and proves it works.

- [ ] **Step 6: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add packages/daemon/src/memory-jobs.ts packages/daemon/src/episodic-memory-jobs.test.ts
git commit -m "feat(daemon): add episodic memory consolidation job"
```

### Task 4: Add Chat-Time Entity Activation and Episodic Recall

**Files:**
- Modify: `packages/systems/src/memory/sqlite.ts`
- Modify: `packages/systems/src/memory/sqlite.test.ts`
- Modify: `packages/core/src/agent/pending/memory-query.ts`
- Modify: `packages/core/src/agent/memory-runner.test.ts`

- [ ] **Step 1: Write failing system test for episodic prompt injection**

Add to `packages/systems/src/memory/sqlite.test.ts`:

```ts
test('memory sqlite injects recalled episodic memories as natural surfaced memories', async () => {
  const system = new MemorySqliteSystem({ scheme: 'sqlite' })
  const ctx = createTurnContext({
    agentId: 'agent-1',
    sessionId: 'session-1',
    messages: [{ role: 'user', content: [{ type: 'text', text: '那家旧书店后来怎么样了？' }] }],
  })
  ctx.state.episodicMemories = [
    {
      id: 'memory-1',
      agentId: 'agent-1',
      sessionId: 'session-1',
      summary: 'WJJ 在安特卫普旧书店提到过海盐焦糖。',
      sourceText: '',
      sourceQuote: null,
      importance: 0.7,
      observedStartAt: new Date('2026-04-24T18:00:00.000Z'),
      observedEndAt: new Date('2026-04-24T18:20:00.000Z'),
      createdAt: new Date('2026-04-24T18:20:00.000Z'),
    },
  ]

  await system.beforeLLM(ctx)

  assert.match(ctx.promptFragments.map((fragment) => fragment.content).join('\n'), /此刻自然浮现的情景记忆/)
  assert.match(ctx.promptFragments.map((fragment) => fragment.content).join('\n'), /WJJ 在安特卫普旧书店提到过海盐焦糖/)
})
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/systems/src/memory/sqlite.test.ts --test-name-pattern "episodic"
```

Expected: FAIL because `beforeLLM` does not render `episodicMemories`.

- [ ] **Step 3: Render episodic memories in memory prompt**

In `packages/systems/src/memory/sqlite.ts`, add a renderer:

```ts
function renderEpisodicMemoryFragment(memories: Array<{
  summary: string
  observedStartAt: Date | null
  observedEndAt: Date | null
}>): string {
  if (memories.length === 0) return ''
  return [
    '以下是此刻自然浮现的情景记忆：',
    ...memories.slice(0, 5).map((memory) => {
      const time = memory.observedStartAt
        ? `[发生于 ${formatLocalMemoryPromptTime(memory.observedStartAt)}] `
        : ''
      return `- ${time}${memory.summary}`
    }),
  ].join('\n')
}
```

Update `beforeLLM()` to append this content after the existing STM/fixed fragment:

```ts
const episodicMemories = Array.isArray(ctx.state.episodicMemories) ? ctx.state.episodicMemories : []
const episodicContent = renderEpisodicMemoryFragment(episodicMemories as Array<{
  summary: string
  observedStartAt: Date | null
  observedEndAt: Date | null
}>)

const content = joinPromptLines([
  renderLayeredMemoryFragment({
    shortTermMemories,
    fixedMemories,
    shortTermPrompt: this.shortTermFragmentPrompt ?? this.fragmentPrompt,
    fixedPrompt: this.fixedFragmentPrompt ?? this.fragmentPrompt,
    showNoHitMemoryFragments: this.showNoHitMemoryFragments,
  }),
  episodicContent,
])
```

- [ ] **Step 4: Run system episodic test and verify GREEN**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/systems/src/memory/sqlite.test.ts --test-name-pattern "episodic"
```

Expected: PASS.

- [ ] **Step 5: Write failing runner test for mention activation before prompt composition**

Add to `packages/core/src/agent/memory-runner.test.ts`:

```ts
test('runner executes entity mention recall before composing the main turn prompt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-memory-runner-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrapDb(dbPath, memoryDbPath)
    const now = new Date('2026-04-30T09:00:00.000Z')
    const wjj = episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-1',
      type: 'person',
      canonicalName: 'WJJ',
      confidence: 0.95,
      aliases: [],
      now,
    })
    const bookstore = episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-1',
      type: 'place',
      canonicalName: '安特卫普旧书店',
      confidence: 0.9,
      aliases: [{ alias: '旧书店', confidence: 0.8 }],
      now,
    })
    const caramel = episodicMemoryGraphRepo.createEntity({
      agentId: 'agent-1',
      type: 'object',
      canonicalName: '海盐焦糖',
      confidence: 0.9,
      aliases: [],
      now,
    })
    episodicMemoryGraphRepo.createEpisodicMemory({
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

    const seenSystemPrompts: string[] = []
    const provider = new FakeProvider(async function* (params) {
      if (params.systemPrompt.includes('实体 mention')) {
        yield {
          type: 'message_complete',
          response: {
            content: [{ type: 'text', text: JSON.stringify({
              mentions: [{ surface: '旧书店', type: 'place', context_hint: '旧书店地点', confidence: 0.9 }],
            }) }],
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        }
        return
      }
      if (isMemorySemanticPrompt(params.systemPrompt)) {
        yield {
          type: 'message_complete',
          response: {
            content: [{ type: 'text', text: JSON.stringify({ retrieval_query: null }) }],
            stopReason: 'end_turn',
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        }
        return
      }
      seenSystemPrompts.push(params.systemPrompt)
      yield {
        type: 'message_complete',
        response: {
          content: [{ type: 'text', text: 'ok' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      }
    })

    for await (const event of runAgent(
      createConfig(),
      [createTextMessage('user', '那家旧书店后来怎么样了？')],
      provider,
      createSystems({
        memory: {
          scheme: 'sqlite',
          embedder: createEmbedder({}),
        },
      }),
    )) {
      assert.notEqual(event.type, 'error')
    }

    assert.match(seenSystemPrompts[0] ?? '', /此刻自然浮现的情景记忆/)
    assert.match(seenSystemPrompts[0] ?? '', /WJJ 在安特卫普旧书店提到过海盐焦糖/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
```

Also extend the existing `@mas/db` import in this test file:

```ts
import {
  episodicMemoryGraphRepo,
  getDb,
  getMemoryDb,
  getRawSqlite,
  memoryRepo,
  resetDb,
  resetMemoryDb,
} from '@mas/db'
```

The test must fail because the runner does not yet execute entity mention activation.

- [ ] **Step 6: Extend pending memory query with optional entity recall**

In `packages/systems/src/types.ts`, add optional fields to `PendingMemoryQuery`:

```ts
entityMentionAnalyzer?: PendingMemoryQueryAnalyzer<EntityMention[]>
activateAndRecallEpisodic?: (mentions: EntityMention[]) => Promise<unknown[]> | unknown[]
```

In `MemorySqliteSystem.beforeTurn()`, set those fields:

```ts
entityMentionAnalyzer: {
  kind: 'llm',
  prompt: buildEntityMentionPrompt(),
  inputText: ctx.input.text,
  parse: parseEntityMentionResponse,
},
activateAndRecallEpisodic: async (mentions) => {
  const activations = mentions.flatMap((mention) => {
    const candidates = episodicMemoryGraphRepo.findEntityCandidates({
      agentId: ctx.agentId,
      type: mention.type,
      surface: mention.surface,
    })
    const exact = candidates.filter((candidate) => candidate.matchKind === 'exact')
    const base = candidates.length === 1
      ? (exact.length === 1 ? 1 : 0.8)
      : (exact.length > 0 ? 0.7 : 0.5)
    return candidates.map((candidate) => ({
      entityId: candidate.entity.id,
      activation: base,
      reason: candidate.matchKind === 'exact' ? 'exact' : 'contains',
    }))
  })
  episodicMemoryGraphRepo.activateEntities({
    agentId: ctx.agentId,
    activations,
    ttlMs: 30 * 60 * 1000,
    maxActive: 20,
    spreadFactor: 0.35,
  })
  return episodicMemoryGraphRepo.recallEpisodicMemories({
    agentId: ctx.agentId,
    topK: 5,
  })
},
```

In `runPendingMemoryQuery()`, run `entityMentionAnalyzer` alongside the existing time and semantic analyzers, then call `activateAndRecallEpisodic()` and store:

```ts
ctx.state.episodicMemories = episodicMemories
ctx.turnMetadata.memory = {
  ...ctx.turnMetadata.memory,
  episodicHitCount: episodicMemories.length,
  episodicMemoryIds: episodicMemories.map((memory) => memory.id),
}
```

- [ ] **Step 7: Run runner and system tests**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/core/src/agent/memory-runner.test.ts --test-name-pattern "entity mention"
node --import tsx --test packages/systems/src/memory/sqlite.test.ts --test-name-pattern "episodic"
npm run typecheck --workspace @mas/core
npm run typecheck --workspace @mas/systems
```

Expected: all commands PASS.

- [ ] **Step 8: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add packages/systems/src/types.ts packages/systems/src/memory/sqlite.ts packages/systems/src/memory/sqlite.test.ts packages/core/src/agent/pending/memory-query.ts packages/core/src/agent/memory-runner.test.ts
git commit -m "feat(memory): recall episodic memories from entity activation"
```

### Task 5: Reframe Long-Term Memory Tool as Recall

**Files:**
- Modify: `packages/core/src/tools/search-long-term-memory.ts`
- Modify: `packages/core/src/tools/search-long-term-memory.test.ts`

- [ ] **Step 1: Write failing tool test for entity recall behavior**

Add to `packages/core/src/tools/search-long-term-memory.test.ts`:

```ts
test('search_long_term_memory recalls episodic memories through entity activation when graph data exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-search-ltm-tool-'))
  const dbPath = join(dir, 'data.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    bootstrap(dbPath, memoryDbPath)
    const agent = agentRepo.createAgent({
      name: 'Hazel',
      provider: 'openrouter',
      model: 'qwen/qwen3.5-flash-02-23',
      modules: { memory: { scheme: 'sqlite' } },
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

    const result = await SearchLongTermMemoryTool.call(
      { query: '旧书店' },
      { agentId: agent.id, sessionId: session.id },
    )

    assert.equal(result.isError, undefined)
    assert.match(result.output, /情景记忆/)
    assert.match(result.output, /WJJ 在安特卫普旧书店提到过海盐焦糖/)
  } finally {
    resetDb()
    resetMemoryDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
```

Also extend the existing `@mas/db` import in this test file:

```ts
import {
  agentRepo,
  bootstrapAppDatabases,
  episodicMemoryGraphRepo,
  memoryRepo,
  resetDb,
  resetMemoryDb,
  sessionRepo,
} from '@mas/db'
```

- [ ] **Step 2: Run tool test and verify RED**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/core/src/tools/search-long-term-memory.test.ts --test-name-pattern "episodic"
```

Expected: FAIL because the tool only searches old `long_term` rows.

- [ ] **Step 3: Add graph-first behavior without renaming the public tool yet**

In `packages/core/src/tools/search-long-term-memory.ts`, before old embedding logic:

```ts
const graphCandidates = episodicMemoryGraphRepo.findEntityCandidates({
  agentId: options.agentId,
  type: 'unknown',
  surface: toolQuery,
  limit: 10,
})
if (graphCandidates.length > 0) {
  const activation = graphCandidates.length === 1 ? 1 : 0.7
  episodicMemoryGraphRepo.activateEntities({
    agentId: options.agentId,
    activations: graphCandidates.map((candidate) => ({
      entityId: candidate.entity.id,
      activation,
      reason: 'tool_recall',
    })),
    ttlMs: 30 * 60 * 1000,
    maxActive: 20,
    spreadFactor: 0.35,
  })
  const episodic = episodicMemoryGraphRepo.recallEpisodicMemories({
    agentId: options.agentId,
    topK,
  })
  if (episodic.length > 0) {
    return {
      output: ['情景记忆召回结果：', ...episodic.map((memory) => `[情景记忆] ${memory.summary}`)].join('\n'),
      metadata: {
        noResults: false,
        mode: 'episodic_entity_graph',
        hits: episodic.map((memory) => ({ id: memory.id, summary: memory.summary })),
      },
    }
  }
}
```

Keep the old long-term row search as fallback until UI/tool renaming is handled in a later task.

- [ ] **Step 4: Run tool tests**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
node --import tsx --test packages/core/src/tools/search-long-term-memory.test.ts
npm run typecheck --workspace @mas/core
```

Expected: both commands PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add packages/core/src/tools/search-long-term-memory.ts packages/core/src/tools/search-long-term-memory.test.ts
git commit -m "feat(memory): route memory tool through episodic entity recall"
```

### Task 6: Full Verification and Documentation

**Files:**
- Modify: `project-docs/STATUS.md` after implementation is merged.

- [ ] **Step 1: Run package tests**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
npm test --workspace @mas/db
npm test --workspace @mas/systems
npm test --workspace @mas/core
npm test --workspace @mas/daemon
```

Expected: PASS, except unrelated pre-existing failures must be copied into the completion note with exact test names.

- [ ] **Step 2: Run typechecks**

Run:

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
npm run typecheck --workspace @mas/db
npm run typecheck --workspace @mas/systems
npm run typecheck --workspace @mas/core
npm run typecheck --workspace @mas/daemon
```

Expected: PASS.

- [ ] **Step 3: Run targeted end-to-end smoke manually through API or UI**

Use a sqlite-memory persona and verify:

```text
1. Create or identify a persona with memory.scheme = sqlite.
2. Add short_term memory mentioning WJJ, 旧书店, 海盐焦糖.
3. Run runEpisodicConsolidationForAgent manually or through a temporary script.
4. Confirm memory_entities has 3 entities.
5. Confirm episodic_memories has 1 row.
6. Send a chat turn mentioning 旧书店.
7. Confirm observer memory metadata includes episodicHitCount >= 1.
8. Confirm final system prompt contains "此刻自然浮现的情景记忆".
```

- [ ] **Step 4: Update STATUS after coordinator merge**

Only after the implementation branch is accepted and merged, update `project-docs/STATUS.md` to say that sqlite memory now has entity graph + episodic recall. Do not update `STATUS.md` from the task branch before acceptance.

## Self-Review

- Spec coverage: This plan covers entity/alias tables, untyped edges, episodic memory links, two-stage STM consolidation, persona-level short activation, one-hop spread, top 5 recall, and no embedding in the first version.
- Known gap: UI browsing for entities and episodic memories is intentionally not included. It should be a later UI task after the runtime path works.
- Known gap: Public tool rename from `search_long_term_memory` to `recall_memory` is intentionally deferred. Task 5 changes behavior while preserving the existing tool contract.
- Placeholder scan: No `TBD`, incomplete test bodies, or "fill this in later" steps remain. The two longer runner/tool tests include full entity graph seeding.
