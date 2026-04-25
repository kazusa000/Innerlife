# World System V0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first event-first text world runtime where existing agents can be placed in a small multi-location world, advance on fixed ticks, produce constrained actions, and generate observable world events.

**Architecture:** Add a new `@mas/world` package for pure world domain logic, add world tables and repositories to `@mas/db`, then connect a deterministic world tick runner into `@mas/daemon`. The first vertical slice records all meaningful changes into `world_events`; agent LLM action, conversation, memory, and relationship hooks are added after the deterministic runtime is testable.

**Tech Stack:** TypeScript, Node test runner, npm workspaces, Drizzle sqlite schema, better-sqlite3, existing `@mas/core`, `@mas/db`, `@mas/daemon`, and `@mas/systems` packages.

---

## Prerequisites

Run implementation in an isolated worktree. Do not implement on `master`.

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git status --short
git worktree add ../wt/world-v0 -b task/world-v0 master
cd ../wt/world-v0
npm install
```

Expected:

- `git status --short` in the worktree is clean.
- `npm install` finishes without changing source files other than lockfile changes required by new workspace metadata.

The current main working tree has unrelated memory-system edits. Do not copy those edits into the world worktree unless the user explicitly asks.

## File Structure

Create a focused package for world domain logic:

- Create `packages/world/package.json`: workspace package metadata and scripts.
- Create `packages/world/tsconfig.json`: TypeScript project config.
- Create `packages/world/src/types.ts`: shared world ids, statuses, snapshots, and decision interfaces.
- Create `packages/world/src/actions.ts`: action schema validation and normalization.
- Create `packages/world/src/events.ts`: world event type definitions and event builders.
- Create `packages/world/src/visibility.ts`: location visibility helpers.
- Create `packages/world/src/resolver.ts`: pure action resolver.
- Create `packages/world/src/tick.ts`: pure tick selection and deterministic state advancement.
- Create `packages/world/src/conversation.ts`: conversation start and stop policy.
- Create `packages/world/src/index.ts`: public exports.
- Create tests beside each focused file: `*.test.ts`.

Extend database support:

- Modify `packages/db/src/schema.ts`: add `worlds`, `worldLocations`, `worldMemberships`, `worldSchedules`, and `worldEvents`.
- Modify `packages/db/src/bootstrap.ts`: create the same tables and indexes for runtime bootstrap.
- Create `packages/db/src/repository/worlds.ts`: repository API for worlds, locations, memberships, schedules, and events.
- Create `packages/db/src/repository/worlds.test.ts`: repository tests.
- Modify `packages/db/src/index.ts`: export `worldRepo`.
- Create `packages/db/migrations/0007_world_system.sql`: migration SQL for persistent installs.
- Modify `packages/db/migrations/meta/_journal.json`: append tag `0007_world_system`.

Connect daemon runtime:

- Create `packages/daemon/src/world-jobs.ts`: process due world ticks.
- Create `packages/daemon/src/world-jobs.test.ts`: daemon world tick tests.
- Create `packages/daemon/src/world-agent-runtime.ts`: strict JSON action intent adapter for real LLM calls.
- Create `packages/daemon/src/world-agent-runtime.test.ts`: parser and fake-provider tests.
- Modify `packages/daemon/src/main.ts`: call `processWorldJobs(signal)` in the daemon tick.
- Modify `packages/daemon/src/index.ts`: export `processWorldJobs`.
- Modify `packages/daemon/package.json`: add dependency on `@mas/world`.

Add minimal web observability after daemon works:

- Create `apps/web/src/app/api/worlds/route.ts`: list/create worlds.
- Create `apps/web/src/app/api/worlds/[worldId]/events/route.ts`: list latest world events.

Update workspace metadata:

- Modify root `package.json`: workspaces already include `packages/*`, so no workspace glob change is needed.
- Modify `package-lock.json`: allow npm to record the new `@mas/world` workspace.

## Task 1: Create `@mas/world` Package And Action Schema

**Files:**

- Create: `packages/world/package.json`
- Create: `packages/world/tsconfig.json`
- Create: `packages/world/src/types.ts`
- Create: `packages/world/src/actions.ts`
- Create: `packages/world/src/actions.test.ts`
- Create: `packages/world/src/index.ts`
- Modify: `package-lock.json`

- [ ] **Step 1: Create the package metadata**

Create `packages/world/package.json`:

```json
{
  "name": "@mas/world",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "node --import tsx --test src/**/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "tsx": "^4.21.0"
  }
}
```

Create `packages/world/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Add shared world types**

Create `packages/world/src/types.ts`:

```ts
export type WorldId = string
export type WorldAgentId = string
export type WorldLocationId = string

export type WorldStatus = 'paused' | 'running'
export type WorldMembershipStatus =
  | 'idle'
  | 'moving'
  | 'working'
  | 'resting'
  | 'sleeping'
  | 'talking'

export interface WorldRecord {
  id: WorldId
  name: string
  status: WorldStatus
  currentTime: Date
  tickMinutes: number
  conversationMaxTurns: number
  createdAt: Date
  updatedAt: Date
}

export interface WorldLocationRecord {
  id: WorldLocationId
  worldId: WorldId
  name: string
  description: string
  adjacentLocationIds: WorldLocationId[]
  moveCostMinutes: number
  createdAt: Date
  updatedAt: Date
}

export interface WorldMembershipRecord {
  id: string
  worldId: WorldId
  agentId: WorldAgentId
  locationId: WorldLocationId
  status: WorldMembershipStatus
  activityUntil: Date | null
  fatigue: number
  createdAt: Date
  updatedAt: Date
}
```

- [ ] **Step 3: Write action schema tests first**

Create `packages/world/src/actions.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWorldAction } from './actions'

test('parseWorldAction accepts valid move action', () => {
  assert.deepEqual(parseWorldAction({
    type: 'move',
    targetLocationId: 'loc-work',
    reason: '上班时间到了',
  }), {
    type: 'move',
    targetLocationId: 'loc-work',
    reason: '上班时间到了',
  })
})

test('parseWorldAction rejects impossible action shapes', () => {
  assert.equal(parseWorldAction({ type: 'teleport', targetLocationId: 'loc-x' }), null)
  assert.equal(parseWorldAction({ type: 'talk', targetAgentId: '', openingLine: 'hi', reason: 'x' }), null)
  assert.equal(parseWorldAction({ type: 'sleep', durationMinutes: -1, reason: '累了' }), null)
})
```

- [ ] **Step 4: Run the failing test**

Run:

```bash
npm run test --workspace @mas/world -- src/actions.test.ts
```

Expected: FAIL because `packages/world/src/actions.ts` does not exist.

- [ ] **Step 5: Implement the action parser**

Create `packages/world/src/actions.ts`:

```ts
export type WorldAction =
  | { type: 'move'; targetLocationId: string; reason: string }
  | { type: 'talk'; targetAgentId: string; openingLine: string; reason: string }
  | { type: 'work'; focus: string; durationMinutes: number; reason: string }
  | { type: 'rest'; activity: 'eat' | 'drink' | 'relax' | 'read' | 'walk'; durationMinutes: number; reason: string }
  | { type: 'sleep'; durationMinutes: number; reason: string }
  | { type: 'observe'; focus: 'location' | 'agent' | 'self' | 'events'; reason: string }
  | { type: 'wait'; durationMinutes: number; reason: string }

type RestActivity = Extract<WorldAction, { type: 'rest' }>['activity']

const REST_ACTIVITIES = new Set(['eat', 'drink', 'relax', 'read', 'walk'])
const OBSERVE_FOCUS = new Set(['location', 'agent', 'self', 'events'])

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readPositiveMinutes(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null
}

export function parseWorldAction(value: unknown): WorldAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const type = record.type
  const reason = readString(record, 'reason')
  if (!reason) return null

  if (type === 'move') {
    const targetLocationId = readString(record, 'targetLocationId')
    return targetLocationId ? { type, targetLocationId, reason } : null
  }
  if (type === 'talk') {
    const targetAgentId = readString(record, 'targetAgentId')
    const openingLine = readString(record, 'openingLine')
    return targetAgentId && openingLine ? { type, targetAgentId, openingLine, reason } : null
  }
  if (type === 'work') {
    const focus = readString(record, 'focus')
    const durationMinutes = readPositiveMinutes(record, 'durationMinutes')
    return focus && durationMinutes ? { type, focus, durationMinutes, reason } : null
  }
  if (type === 'rest') {
    const activity = readString(record, 'activity')
    const durationMinutes = readPositiveMinutes(record, 'durationMinutes')
    return activity && REST_ACTIVITIES.has(activity) && durationMinutes
      ? { type, activity: activity as RestActivity, durationMinutes, reason }
      : null
  }
  if (type === 'sleep') {
    const durationMinutes = readPositiveMinutes(record, 'durationMinutes')
    return durationMinutes ? { type, durationMinutes, reason } : null
  }
  if (type === 'observe') {
    const focus = readString(record, 'focus')
    return focus && OBSERVE_FOCUS.has(focus)
      ? { type, focus: focus as 'location' | 'agent' | 'self' | 'events', reason }
      : null
  }
  if (type === 'wait') {
    const durationMinutes = readPositiveMinutes(record, 'durationMinutes')
    return durationMinutes ? { type, durationMinutes, reason } : null
  }
  return null
}
```

- [ ] **Step 6: Export the package surface**

Create `packages/world/src/index.ts`:

```ts
export * from './types'
export * from './actions'
```

- [ ] **Step 7: Verify package**

Run:

```bash
npm install
npm run test --workspace @mas/world
npm run typecheck --workspace @mas/world
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package-lock.json packages/world/package.json packages/world/tsconfig.json packages/world/src
git commit -m "feat(world): add action schema package"
```

## Task 2: Add World Tables And Repository

**Files:**

- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/bootstrap.ts`
- Create: `packages/db/src/repository/worlds.ts`
- Create: `packages/db/src/repository/worlds.test.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/migrations/0007_world_system.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Write repository tests first**

Create `packages/db/src/repository/worlds.test.ts` with a local bootstrap that creates only world tables:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, getRawSqlite, resetDb, worldRepo } from '..'

function bootstrapWorldTables(dbPath: string) {
  resetDb()
  getDb(dbPath)
  getRawSqlite().exec(`
    CREATE TABLE worlds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      current_time INTEGER NOT NULL,
      tick_minutes INTEGER NOT NULL,
      conversation_max_turns INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE world_locations (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL REFERENCES worlds(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      adjacent_location_ids TEXT NOT NULL,
      move_cost_minutes INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE world_memberships (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL REFERENCES worlds(id),
      agent_id TEXT NOT NULL,
      location_id TEXT NOT NULL REFERENCES world_locations(id),
      status TEXT NOT NULL,
      activity_until INTEGER,
      fatigue REAL NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_world_memberships_world_agent
      ON world_memberships(world_id, agent_id);
    CREATE TABLE world_schedules (
      id TEXT PRIMARY KEY,
      membership_id TEXT NOT NULL REFERENCES world_memberships(id),
      kind TEXT NOT NULL,
      start_minute INTEGER NOT NULL,
      end_minute INTEGER NOT NULL,
      location_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE world_events (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL REFERENCES worlds(id),
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      actor_agent_id TEXT,
      target_agent_id TEXT,
      location_id TEXT,
      payload_json TEXT,
      occurred_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_world_events_world_occurred_at
      ON world_events(world_id, occurred_at);
  `)
}

test('worldRepo creates world, locations, memberships, and events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-world-repo-'))
  const dbPath = join(dir, 'test.db')

  try {
    bootstrapWorldTables(dbPath)
    const now = new Date('2026-04-25T10:00:00.000Z')
    const world = worldRepo.createWorld({ name: '小镇', currentTime: now })
    const home = worldRepo.createLocation({
      worldId: world.id,
      name: '家',
      description: '安静的小房间',
      adjacentLocationIds: [],
      moveCostMinutes: 10,
    })
    const membership = worldRepo.addMembership({
      worldId: world.id,
      agentId: 'agent-a',
      locationId: home.id,
    })
    const event = worldRepo.appendWorldEvent({
      worldId: world.id,
      kind: 'tick_started',
      message: '世界 tick 开始',
      actorAgentId: 'agent-a',
      locationId: home.id,
      payload: { tickMinutes: 10 },
      occurredAt: now,
    })

    assert.equal(world.tickMinutes, 10)
    assert.equal(world.conversationMaxTurns, 10)
    assert.equal(membership.status, 'idle')
    assert.deepEqual(worldRepo.listLocations(world.id).map((item) => item.id), [home.id])
    assert.deepEqual(worldRepo.listMemberships(world.id).map((item) => item.id), [membership.id])
    assert.deepEqual(worldRepo.listWorldEvents({ worldId: world.id }).map((item) => item.id), [event.id])
    assert.deepEqual(event.payload, { tickMinutes: 10 })
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the failing repository test**

Run:

```bash
npm run test --workspace @mas/db -- src/repository/worlds.test.ts
```

Expected: FAIL because `worldRepo` is not exported.

- [ ] **Step 3: Add Drizzle schema tables**

In `packages/db/src/schema.ts`, append these tables after `daemonEvents`:

```ts
export const worlds = sqliteTable('worlds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status', { enum: ['paused', 'running'] }).notNull().default('paused'),
  currentTime: integer('current_time', { mode: 'timestamp_ms' }).notNull(),
  tickMinutes: integer('tick_minutes').notNull().default(10),
  conversationMaxTurns: integer('conversation_max_turns').notNull().default(10),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

export const worldLocations = sqliteTable('world_locations', {
  id: text('id').primaryKey(),
  worldId: text('world_id').notNull().references(() => worlds.id),
  name: text('name').notNull(),
  description: text('description').notNull(),
  adjacentLocationIds: text('adjacent_location_ids').notNull(),
  moveCostMinutes: integer('move_cost_minutes').notNull().default(10),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  worldIdx: index('idx_world_locations_world_id').on(table.worldId),
}))

export const worldMemberships = sqliteTable('world_memberships', {
  id: text('id').primaryKey(),
  worldId: text('world_id').notNull().references(() => worlds.id),
  agentId: text('agent_id').notNull().references(() => agents.id),
  locationId: text('location_id').notNull().references(() => worldLocations.id),
  status: text('status', { enum: ['idle', 'moving', 'working', 'resting', 'sleeping', 'talking'] }).notNull().default('idle'),
  activityUntil: integer('activity_until', { mode: 'timestamp_ms' }),
  fatigue: real('fatigue').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  worldAgentIdx: uniqueIndex('idx_world_memberships_world_agent').on(table.worldId, table.agentId),
  worldStatusIdx: index('idx_world_memberships_world_status').on(table.worldId, table.status),
}))

export const worldSchedules = sqliteTable('world_schedules', {
  id: text('id').primaryKey(),
  membershipId: text('membership_id').notNull().references(() => worldMemberships.id),
  kind: text('kind', { enum: ['work', 'sleep', 'free'] }).notNull(),
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
  locationId: text('location_id').references(() => worldLocations.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  membershipIdx: index('idx_world_schedules_membership').on(table.membershipId),
}))

export const worldEvents = sqliteTable('world_events', {
  id: text('id').primaryKey(),
  worldId: text('world_id').notNull().references(() => worlds.id),
  kind: text('kind').notNull(),
  message: text('message').notNull(),
  actorAgentId: text('actor_agent_id').references(() => agents.id),
  targetAgentId: text('target_agent_id').references(() => agents.id),
  locationId: text('location_id').references(() => worldLocations.id),
  payloadJson: text('payload_json'),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  worldOccurredAtIdx: index('idx_world_events_world_occurred_at').on(table.worldId, table.occurredAt),
  actorIdx: index('idx_world_events_actor_agent_id').on(table.actorAgentId),
}))
```

- [ ] **Step 4: Implement `worldRepo`**

Create `packages/db/src/repository/worlds.ts` with these exported functions:

```ts
import { and, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb } from '../client'
import { worldEvents, worldLocations, worldMemberships, worlds } from '../schema'

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parsePayload(value: string | null) {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function createWorld(input: {
  name: string
  currentTime?: Date
  tickMinutes?: number
  conversationMaxTurns?: number
}) {
  const db = getDb()
  const id = randomUUID()
  const now = new Date()
  db.insert(worlds).values({
    id,
    name: input.name.trim(),
    status: 'paused',
    currentTime: input.currentTime ?? now,
    tickMinutes: input.tickMinutes ?? 10,
    conversationMaxTurns: input.conversationMaxTurns ?? 10,
    createdAt: now,
    updatedAt: now,
  }).run()
  return getWorld(id)!
}

export function getWorld(id: string) {
  return getDb().select().from(worlds).where(eq(worlds.id, id)).get()
}

export function listWorlds() {
  return getDb().select().from(worlds).orderBy(desc(worlds.updatedAt)).all()
}

export function updateWorldTime(input: { worldId: string; currentTime: Date }) {
  getDb().update(worlds).set({
    currentTime: input.currentTime,
    updatedAt: new Date(),
  }).where(eq(worlds.id, input.worldId)).run()
  return getWorld(input.worldId)
}

export function createLocation(input: {
  worldId: string
  name: string
  description: string
  adjacentLocationIds?: string[]
  moveCostMinutes?: number
}) {
  const db = getDb()
  const id = randomUUID()
  const now = new Date()
  db.insert(worldLocations).values({
    id,
    worldId: input.worldId,
    name: input.name.trim(),
    description: input.description.trim(),
    adjacentLocationIds: JSON.stringify(input.adjacentLocationIds ?? []),
    moveCostMinutes: input.moveCostMinutes ?? 10,
    createdAt: now,
    updatedAt: now,
  }).run()
  return listLocations(input.worldId).find((location) => location.id === id)!
}

export function listLocations(worldId: string) {
  return getDb().select().from(worldLocations).where(eq(worldLocations.worldId, worldId)).all()
    .map((row) => ({
      ...row,
      adjacentLocationIds: parseJsonArray(row.adjacentLocationIds),
    }))
}

export function addMembership(input: {
  worldId: string
  agentId: string
  locationId: string
}) {
  const db = getDb()
  const id = randomUUID()
  const now = new Date()
  db.insert(worldMemberships).values({
    id,
    worldId: input.worldId,
    agentId: input.agentId,
    locationId: input.locationId,
    status: 'idle',
    activityUntil: null,
    fatigue: 0,
    createdAt: now,
    updatedAt: now,
  }).run()
  return getMembership(id)!
}

export function getMembership(id: string) {
  return getDb().select().from(worldMemberships).where(eq(worldMemberships.id, id)).get()
}

export function listMemberships(worldId: string) {
  return getDb().select().from(worldMemberships).where(eq(worldMemberships.worldId, worldId)).all()
}

export function updateMembershipState(input: {
  membershipId: string
  locationId?: string
  status?: typeof worldMemberships.$inferSelect.status
  activityUntil?: Date | null
  fatigue?: number
}) {
  getDb().update(worldMemberships).set({
    locationId: input.locationId,
    status: input.status,
    activityUntil: input.activityUntil,
    fatigue: input.fatigue,
    updatedAt: new Date(),
  }).where(eq(worldMemberships.id, input.membershipId)).run()
  return getMembership(input.membershipId)
}

export function appendWorldEvent(input: {
  worldId: string
  kind: string
  message: string
  actorAgentId?: string | null
  targetAgentId?: string | null
  locationId?: string | null
  payload?: Record<string, unknown> | null
  occurredAt?: Date
}) {
  const db = getDb()
  const id = randomUUID()
  const now = new Date()
  db.insert(worldEvents).values({
    id,
    worldId: input.worldId,
    kind: input.kind,
    message: input.message,
    actorAgentId: input.actorAgentId ?? null,
    targetAgentId: input.targetAgentId ?? null,
    locationId: input.locationId ?? null,
    payloadJson: input.payload ? JSON.stringify(input.payload) : null,
    occurredAt: input.occurredAt ?? now,
    createdAt: now,
  }).run()
  return listWorldEvents({ worldId: input.worldId, limit: 1 })[0]!
}

export function listWorldEvents(input: { worldId: string; limit?: number; kind?: string }) {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)))
  const db = getDb()
  const rows = input.kind
    ? db.select().from(worldEvents)
      .where(and(eq(worldEvents.worldId, input.worldId), eq(worldEvents.kind, input.kind)))
      .orderBy(desc(worldEvents.occurredAt), desc(worldEvents.createdAt), desc(worldEvents.id))
      .limit(limit)
      .all()
    : db.select().from(worldEvents)
      .where(eq(worldEvents.worldId, input.worldId))
      .orderBy(desc(worldEvents.occurredAt), desc(worldEvents.createdAt), desc(worldEvents.id))
      .limit(limit)
      .all()
  return rows.map((row) => ({
    ...row,
    payload: parsePayload(row.payloadJson),
  }))
}
```

- [ ] **Step 5: Export repository**

Modify `packages/db/src/index.ts`:

```ts
export * as worldRepo from './repository/worlds'
```

- [ ] **Step 6: Add bootstrap SQL**

In `packages/db/src/bootstrap.ts`, add the five world tables and indexes to the main `sqlite.exec` block. Use the same column names from the test bootstrap in Step 1.

- [ ] **Step 7: Add migration SQL**

Create `packages/db/migrations/0007_world_system.sql` with the same `CREATE TABLE` and `CREATE INDEX` statements from Step 1, without `IF NOT EXISTS`.

Append this entry to `packages/db/migrations/meta/_journal.json`:

```json
{
  "idx": 7,
  "version": "6",
  "when": 1777125600000,
  "tag": "0007_world_system",
  "breakpoints": true
}
```

- [ ] **Step 8: Verify db**

Run:

```bash
npm run test --workspace @mas/db -- src/repository/worlds.test.ts
npm run typecheck --workspace @mas/db
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/bootstrap.ts packages/db/src/repository/worlds.ts packages/db/src/repository/worlds.test.ts packages/db/src/index.ts packages/db/migrations/0007_world_system.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): add world repositories"
```

## Task 3: Add Pure Resolver, Visibility, And Tick Logic

**Files:**

- Create: `packages/world/src/events.ts`
- Create: `packages/world/src/visibility.ts`
- Create: `packages/world/src/resolver.ts`
- Create: `packages/world/src/tick.ts`
- Create: `packages/world/src/resolver.test.ts`
- Create: `packages/world/src/tick.test.ts`
- Modify: `packages/world/src/index.ts`

- [ ] **Step 1: Write resolver tests**

Create `packages/world/src/resolver.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWorldAction } from './resolver'

const world = {
  id: 'world-1',
  currentTime: new Date('2026-04-25T10:00:00.000Z'),
  tickMinutes: 10,
}
const locations = [
  { id: 'home', adjacentLocationIds: ['street'], moveCostMinutes: 10 },
  { id: 'street', adjacentLocationIds: ['home', 'work'], moveCostMinutes: 10 },
]
const membership = {
  id: 'member-a',
  agentId: 'agent-a',
  locationId: 'home',
  status: 'idle' as const,
  activityUntil: null,
}

test('resolveWorldAction converts adjacent move into move_completed event and state update', () => {
  const result = resolveWorldAction({
    world,
    locations,
    memberships: [membership],
    actor: membership,
    action: { type: 'move', targetLocationId: 'street', reason: '去上班' },
  })

  assert.equal(result.membershipPatch.locationId, 'street')
  assert.equal(result.membershipPatch.status, 'idle')
  assert.equal(result.events[0]?.kind, 'move_completed')
})

test('resolveWorldAction rejects non-adjacent move and keeps actor idle', () => {
  const result = resolveWorldAction({
    world,
    locations,
    memberships: [membership],
    actor: membership,
    action: { type: 'move', targetLocationId: 'work', reason: '抄近路' },
  })

  assert.equal(result.membershipPatch.locationId, 'home')
  assert.equal(result.membershipPatch.status, 'idle')
  assert.equal(result.events[0]?.kind, 'action_failed')
})
```

- [ ] **Step 2: Write tick tests**

Create `packages/world/src/tick.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceWorldTick, selectDecisionMemberships } from './tick'

test('advanceWorldTick advances by configured tick minutes', () => {
  assert.equal(
    advanceWorldTick(new Date('2026-04-25T10:00:00.000Z'), 10).toISOString(),
    '2026-04-25T10:10:00.000Z',
  )
})

test('selectDecisionMemberships only selects idle memberships', () => {
  const selected = selectDecisionMemberships([
    { id: 'a', status: 'idle', activityUntil: null },
    { id: 'b', status: 'sleeping', activityUntil: new Date('2026-04-25T11:00:00.000Z') },
  ])
  assert.deepEqual(selected.map((item) => item.id), ['a'])
})
```

- [ ] **Step 3: Run failing world tests**

Run:

```bash
npm run test --workspace @mas/world
```

Expected: FAIL because resolver and tick modules do not exist.

- [ ] **Step 4: Implement event types**

Create `packages/world/src/events.ts`:

```ts
export interface WorldEventDraft {
  kind: string
  message: string
  actorAgentId?: string | null
  targetAgentId?: string | null
  locationId?: string | null
  payload?: Record<string, unknown> | null
}
```

- [ ] **Step 5: Implement resolver**

Create `packages/world/src/resolver.ts`:

```ts
import type { WorldAction } from './actions'
import type { WorldEventDraft } from './events'

type LocationLike = {
  id: string
  adjacentLocationIds: string[]
  moveCostMinutes: number
}

type MembershipLike = {
  id: string
  agentId: string
  locationId: string
  status: 'idle' | 'moving' | 'working' | 'resting' | 'sleeping' | 'talking'
  activityUntil: Date | null
}

type WorldLike = {
  id: string
  currentTime: Date
  tickMinutes: number
}

export function resolveWorldAction(input: {
  world: WorldLike
  locations: LocationLike[]
  memberships: MembershipLike[]
  actor: MembershipLike
  action: WorldAction
}): {
  events: WorldEventDraft[]
  membershipPatch: {
    locationId: string
    status: MembershipLike['status']
    activityUntil: Date | null
  }
} {
  const actorLocation = input.locations.find((location) => location.id === input.actor.locationId)
  const basePatch = {
    locationId: input.actor.locationId,
    status: 'idle' as const,
    activityUntil: null,
  }

  if (input.action.type === 'move') {
    if (!actorLocation?.adjacentLocationIds.includes(input.action.targetLocationId)) {
      return {
        membershipPatch: basePatch,
        events: [{
          kind: 'action_failed',
          message: `移动失败：目标地点不可达`,
          actorAgentId: input.actor.agentId,
          locationId: input.actor.locationId,
          payload: { action: input.action, reason: 'not_adjacent' },
        }],
      }
    }
    return {
      membershipPatch: {
        locationId: input.action.targetLocationId,
        status: 'idle',
        activityUntil: null,
      },
      events: [{
        kind: 'move_completed',
        message: `移动到 ${input.action.targetLocationId}`,
        actorAgentId: input.actor.agentId,
        locationId: input.action.targetLocationId,
        payload: { reason: input.action.reason },
      }],
    }
  }

  if (input.action.type === 'wait' || input.action.type === 'work' || input.action.type === 'rest' || input.action.type === 'sleep') {
    const durationMinutes = 'durationMinutes' in input.action ? input.action.durationMinutes : input.world.tickMinutes
    const status = input.action.type === 'wait' ? 'idle' : input.action.type === 'sleep' ? 'sleeping' : input.action.type === 'work' ? 'working' : 'resting'
    return {
      membershipPatch: {
        locationId: input.actor.locationId,
        status,
        activityUntil: new Date(input.world.currentTime.getTime() + durationMinutes * 60_000),
      },
      events: [{
        kind: `${input.action.type}_started`,
        message: `${input.action.type} 开始`,
        actorAgentId: input.actor.agentId,
        locationId: input.actor.locationId,
        payload: { action: input.action },
      }],
    }
  }

  return {
    membershipPatch: basePatch,
    events: [{
      kind: input.action.type === 'talk' ? 'conversation_requested' : 'observation_requested',
      message: input.action.type === 'talk' ? '请求对话' : '请求观察',
      actorAgentId: input.actor.agentId,
      targetAgentId: input.action.type === 'talk' ? input.action.targetAgentId : null,
      locationId: input.actor.locationId,
      payload: { action: input.action },
    }],
  }
}
```

- [ ] **Step 6: Implement tick helpers**

Create `packages/world/src/tick.ts`:

```ts
export function advanceWorldTick(currentTime: Date, tickMinutes: number) {
  return new Date(currentTime.getTime() + Math.max(1, Math.floor(tickMinutes)) * 60_000)
}

export function selectDecisionMemberships<T extends {
  id: string
  status: string
  activityUntil: Date | null
}>(memberships: T[], now = new Date()) {
  return memberships.filter((membership) => {
    if (membership.status === 'idle') return true
    return membership.activityUntil !== null && membership.activityUntil.getTime() <= now.getTime()
  })
}
```

- [ ] **Step 7: Export new modules**

Modify `packages/world/src/index.ts`:

```ts
export * from './types'
export * from './actions'
export * from './events'
export * from './resolver'
export * from './tick'
```

- [ ] **Step 8: Verify world package**

Run:

```bash
npm run test --workspace @mas/world
npm run typecheck --workspace @mas/world
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/world/src
git commit -m "feat(world): add resolver and tick logic"
```

## Task 4: Add Daemon World Tick Runner

**Files:**

- Modify: `packages/daemon/package.json`
- Create: `packages/daemon/src/world-jobs.ts`
- Create: `packages/daemon/src/world-jobs.test.ts`
- Modify: `packages/daemon/src/main.ts`
- Modify: `packages/daemon/src/index.ts`

- [ ] **Step 1: Add package dependency**

Modify `packages/daemon/package.json` dependencies:

```json
"@mas/world": "*"
```

- [ ] **Step 2: Write daemon world job test**

Create `packages/daemon/src/world-jobs.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bootstrapAppDatabases, getDb, resetDb, worldRepo, agentRepo } from '@mas/db'
import { processWorldJobs } from './world-jobs'

test('processWorldJobs advances running worlds and records events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-world-jobs-'))
  const dbPath = join(dir, 'app.db')
  const memoryDbPath = join(dir, 'memory.db')

  try {
    resetDb()
    bootstrapAppDatabases({ dbPath, memoryDbPath })
    getDb(dbPath)

    const agent = agentRepo.createAgent({ name: '小明', model: 'fake-model' })
    const world = worldRepo.createWorld({
      name: '小镇',
      currentTime: new Date('2026-04-25T10:00:00.000Z'),
    })
    const location = worldRepo.createLocation({
      worldId: world.id,
      name: '家',
      description: '安静的小屋',
      adjacentLocationIds: [],
    })
    worldRepo.addMembership({ worldId: world.id, agentId: agent.id, locationId: location.id })
    worldRepo.setWorldStatus({ worldId: world.id, status: 'running' })

    const result = await processWorldJobs({
      decideAction: async () => ({ type: 'wait', durationMinutes: 10, reason: '观察环境' }),
    })

    assert.equal(result.processedWorlds, 1)
    assert.equal(worldRepo.getWorld(world.id)?.currentTime.toISOString(), '2026-04-25T10:10:00.000Z')
    assert.ok(worldRepo.listWorldEvents({ worldId: world.id }).some((event) => event.kind === 'tick_started'))
  } finally {
    resetDb()
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: Add missing repo helpers used by test**

If Task 2 did not add these helpers, add them to `packages/db/src/repository/worlds.ts`:

```ts
export function setWorldStatus(input: { worldId: string; status: 'paused' | 'running' }) {
  getDb().update(worlds).set({
    status: input.status,
    updatedAt: new Date(),
  }).where(eq(worlds.id, input.worldId)).run()
  return getWorld(input.worldId)
}

export function listRunningWorlds() {
  return getDb().select().from(worlds).where(eq(worlds.status, 'running')).all()
}
```

- [ ] **Step 4: Run failing daemon test**

Run:

```bash
npm run test --workspace @mas/daemon -- src/world-jobs.test.ts
```

Expected: FAIL because `processWorldJobs` does not exist.

- [ ] **Step 5: Implement deterministic world jobs**

Create `packages/daemon/src/world-jobs.ts`:

```ts
import { worldRepo } from '@mas/db'
import { advanceWorldTick, resolveWorldAction, selectDecisionMemberships, type WorldAction } from '@mas/world'

export interface WorldDecisionInput {
  worldId: string
  agentId: string
  locationId: string
  observation: string
}

export type WorldActionDecider = (input: WorldDecisionInput) => Promise<WorldAction>

const defaultDecideAction: WorldActionDecider = async () => ({
  type: 'wait',
  durationMinutes: 10,
  reason: '没有明确行动',
})

export async function processWorldJobs(input: {
  signal?: AbortSignal
  decideAction?: WorldActionDecider
} = {}) {
  const decideAction = input.decideAction ?? defaultDecideAction
  let processedWorlds = 0
  const worlds = worldRepo.listRunningWorlds()

  for (const world of worlds) {
    if (input.signal?.aborted) break
    processedWorlds += 1
    const nextTime = advanceWorldTick(world.currentTime, world.tickMinutes)
    worldRepo.updateWorldTime({ worldId: world.id, currentTime: nextTime })
    worldRepo.appendWorldEvent({
      worldId: world.id,
      kind: 'tick_started',
      message: '世界 tick 开始',
      payload: { previousTime: world.currentTime.toISOString(), currentTime: nextTime.toISOString() },
      occurredAt: nextTime,
    })

    const locations = worldRepo.listLocations(world.id)
    const memberships = worldRepo.listMemberships(world.id)
    for (const membership of selectDecisionMemberships(memberships, nextTime)) {
      const action = await decideAction({
        worldId: world.id,
        agentId: membership.agentId,
        locationId: membership.locationId,
        observation: `当前位置：${membership.locationId}`,
      })
      worldRepo.appendWorldEvent({
        worldId: world.id,
        kind: 'agent_action_intent',
        message: 'agent 输出世界行动意图',
        actorAgentId: membership.agentId,
        locationId: membership.locationId,
        payload: { action },
        occurredAt: nextTime,
      })
      const resolved = resolveWorldAction({
        world: { id: world.id, currentTime: nextTime, tickMinutes: world.tickMinutes },
        locations,
        memberships,
        actor: membership,
        action,
      })
      worldRepo.updateMembershipState({
        membershipId: membership.id,
        locationId: resolved.membershipPatch.locationId,
        status: resolved.membershipPatch.status,
        activityUntil: resolved.membershipPatch.activityUntil,
      })
      for (const event of resolved.events) {
        worldRepo.appendWorldEvent({
          worldId: world.id,
          ...event,
          occurredAt: nextTime,
        })
      }
    }
  }

  return { processedWorlds }
}
```

- [ ] **Step 6: Wire daemon main**

Modify `packages/daemon/src/main.ts` imports:

```ts
import { processWorldJobs } from './world-jobs'
```

Modify the daemon `tick` callback:

```ts
tick: async ({ signal }) => {
  await processMemoryJobs(signal)
  await processWorldJobs({ signal })
  await processNextQueuedTuringRun(signal)
},
```

- [ ] **Step 7: Export daemon world jobs**

Modify `packages/daemon/src/index.ts`:

```ts
export { processWorldJobs } from './world-jobs'
```

- [ ] **Step 8: Verify daemon**

Run:

```bash
npm install
npm run test --workspace @mas/daemon -- src/world-jobs.test.ts
npm run typecheck --workspace @mas/daemon
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package-lock.json packages/daemon/package.json packages/daemon/src/world-jobs.ts packages/daemon/src/world-jobs.test.ts packages/daemon/src/main.ts packages/daemon/src/index.ts packages/db/src/repository/worlds.ts
git commit -m "feat(daemon): process world ticks"
```

## Task 5: Add Strict LLM Action Intent Adapter

**Files:**

- Create: `packages/daemon/src/world-agent-runtime.ts`
- Create: `packages/daemon/src/world-agent-runtime.test.ts`
- Modify: `packages/daemon/src/world-jobs.ts`

- [ ] **Step 1: Write parser tests**

Create `packages/daemon/src/world-agent-runtime.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWorldActionResponse } from './world-agent-runtime'

test('parseWorldActionResponse parses fenced JSON action', () => {
  assert.deepEqual(parseWorldActionResponse('```json\n{"type":"wait","durationMinutes":10,"reason":"先观察"}\n```'), {
    type: 'wait',
    durationMinutes: 10,
    reason: '先观察',
  })
})

test('parseWorldActionResponse returns wait fallback on invalid JSON', () => {
  assert.deepEqual(parseWorldActionResponse('我不知道'), {
    type: 'wait',
    durationMinutes: 10,
    reason: 'LLM did not return valid world action JSON',
  })
})
```

- [ ] **Step 2: Run failing parser tests**

Run:

```bash
npm run test --workspace @mas/daemon -- src/world-agent-runtime.test.ts
```

Expected: FAIL because the file does not exist.

- [ ] **Step 3: Implement parser and prompt builder**

Create `packages/daemon/src/world-agent-runtime.ts`:

```ts
import { createProvider, type LLMProvider, type Message } from '@mas/core'
import { agentRepo } from '@mas/db'
import { parseWorldAction, type WorldAction } from '@mas/world'

function stripFence(text: string) {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return match ? match[1]!.trim() : trimmed
}

export function parseWorldActionResponse(text: string): WorldAction {
  try {
    const parsed = JSON.parse(stripFence(text)) as unknown
    return parseWorldAction(parsed) ?? {
      type: 'wait',
      durationMinutes: 10,
      reason: 'LLM returned unsupported world action shape',
    }
  } catch {
    return {
      type: 'wait',
      durationMinutes: 10,
      reason: 'LLM did not return valid world action JSON',
    }
  }
}

export function buildWorldActionPrompt() {
  return [
    '你正在一个文字世界中生活。',
    '只返回一个 JSON object，不要 markdown，不要解释。',
    '可用动作：move, talk, work, rest, sleep, observe, wait。',
    '必须包含 reason 字段。',
    '如果没有明确行动，返回 {"type":"wait","durationMinutes":10,"reason":"..."}。',
  ].join('\n')
}

export async function decideWorldActionWithAgent(input: {
  agentId: string
  observation: string
  provider?: Pick<LLMProvider, 'sendMessage'>
  signal?: AbortSignal
}): Promise<WorldAction> {
  const agent = agentRepo.getAgent(input.agentId)
  if (!agent) {
    return { type: 'wait', durationMinutes: 10, reason: 'agent not found' }
  }

  const provider = input.provider ?? createProvider(agent.provider)
  const messages: Message[] = [
    { role: 'user', content: [{ type: 'text', text: input.observation }] },
  ]
  const response = await provider.sendMessage({
    model: agent.model,
    systemPrompt: `${agent.systemPrompt}\n\n${agent.personaPrompt}\n\n${buildWorldActionPrompt()}`,
    messages,
    reasoning: { effort: 'none' },
    signal: input.signal,
  })
  return parseWorldActionResponse(response.content.map((block) => block.type === 'text' ? block.text : '').join('\n'))
}
```

- [ ] **Step 4: Wire default decider into world jobs**

Modify `packages/daemon/src/world-jobs.ts`:

```ts
import { decideWorldActionWithAgent } from './world-agent-runtime'
```

Replace `defaultDecideAction`:

```ts
const defaultDecideAction: WorldActionDecider = async (input) => decideWorldActionWithAgent(input)
```

- [ ] **Step 5: Verify daemon**

Run:

```bash
npm run test --workspace @mas/daemon -- src/world-agent-runtime.test.ts src/world-jobs.test.ts
npm run typecheck --workspace @mas/daemon
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/daemon/src/world-agent-runtime.ts packages/daemon/src/world-agent-runtime.test.ts packages/daemon/src/world-jobs.ts
git commit -m "feat(daemon): add world action llm adapter"
```

## Task 6: Add Conversation Policy And Event Recording

**Files:**

- Create: `packages/world/src/conversation.ts`
- Create: `packages/world/src/conversation.test.ts`
- Modify: `packages/world/src/index.ts`
- Modify: `packages/daemon/src/world-jobs.ts`
- Modify: `packages/daemon/src/world-jobs.test.ts`

- [ ] **Step 1: Write conversation policy tests**

Create `packages/world/src/conversation.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { canStartConversation, shouldStopConversation } from './conversation'

test('canStartConversation requires same location and available target', () => {
  assert.equal(canStartConversation({
    actor: { agentId: 'a', locationId: 'home', status: 'idle' },
    target: { agentId: 'b', locationId: 'home', status: 'idle' },
  }), true)
  assert.equal(canStartConversation({
    actor: { agentId: 'a', locationId: 'home', status: 'idle' },
    target: { agentId: 'b', locationId: 'work', status: 'idle' },
  }), false)
  assert.equal(canStartConversation({
    actor: { agentId: 'a', locationId: 'home', status: 'idle' },
    target: { agentId: 'b', locationId: 'home', status: 'sleeping' },
  }), false)
})

test('shouldStopConversation stops at max turns or interruption', () => {
  assert.equal(shouldStopConversation({ turnCount: 10, maxTurns: 10, interrupted: false }), true)
  assert.equal(shouldStopConversation({ turnCount: 2, maxTurns: 10, interrupted: true }), true)
  assert.equal(shouldStopConversation({ turnCount: 2, maxTurns: 10, interrupted: false }), false)
})
```

- [ ] **Step 2: Implement conversation policy**

Create `packages/world/src/conversation.ts`:

```ts
type ConversationMember = {
  agentId: string
  locationId: string
  status: string
}

export function canStartConversation(input: {
  actor: ConversationMember
  target: ConversationMember
}) {
  return input.actor.locationId === input.target.locationId
    && input.actor.status === 'idle'
    && input.target.status === 'idle'
}

export function shouldStopConversation(input: {
  turnCount: number
  maxTurns: number
  interrupted: boolean
}) {
  return input.interrupted || input.turnCount >= input.maxTurns
}
```

- [ ] **Step 3: Export conversation policy**

Modify `packages/world/src/index.ts`:

```ts
export * from './conversation'
```

- [ ] **Step 4: Record conversation start requests in daemon**

In `packages/daemon/src/world-jobs.ts`, when `resolveWorldAction` returns a `conversation_requested` event, lookup the target membership. If `canStartConversation` returns true, append:

```ts
worldRepo.appendWorldEvent({
  worldId: world.id,
  kind: 'conversation_started',
  message: '自动对话开始',
  actorAgentId: membership.agentId,
  targetAgentId: target.agentId,
  locationId: membership.locationId,
  payload: { openingLine: action.type === 'talk' ? action.openingLine : '' },
  occurredAt: nextTime,
})
worldRepo.appendWorldEvent({
  worldId: world.id,
  kind: 'conversation_ended',
  message: '自动对话结束：达到 v0 事件记录边界',
  actorAgentId: membership.agentId,
  targetAgentId: target.agentId,
  locationId: membership.locationId,
  payload: { stopReason: 'max_turns', maxTurns: world.conversationMaxTurns },
  occurredAt: nextTime,
})
```

If the target is unavailable, append:

```ts
worldRepo.appendWorldEvent({
  worldId: world.id,
  kind: 'conversation_rejected',
  message: '自动对话未开始：目标不可用',
  actorAgentId: membership.agentId,
  targetAgentId: action.type === 'talk' ? action.targetAgentId : null,
  locationId: membership.locationId,
  payload: { reason: 'target_unavailable' },
  occurredAt: nextTime,
})
```

This task records start/end boundaries but does not yet perform multi-turn LLM dialogue. That keeps the daemon deterministic before adding cost-heavy conversation generation.

- [ ] **Step 5: Verify conversation policy**

Run:

```bash
npm run test --workspace @mas/world -- src/conversation.test.ts
npm run test --workspace @mas/daemon -- src/world-jobs.test.ts
npm run typecheck --workspace @mas/world
npm run typecheck --workspace @mas/daemon
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/world/src/conversation.ts packages/world/src/conversation.test.ts packages/world/src/index.ts packages/daemon/src/world-jobs.ts packages/daemon/src/world-jobs.test.ts
git commit -m "feat(world): record automatic conversation events"
```

## Task 7: Add World Side-Effect Request Events

**Files:**

- Modify: `packages/daemon/src/world-jobs.ts`
- Modify: `packages/daemon/src/world-jobs.test.ts`

- [ ] **Step 1: Extend daemon test for memory and relationship request events**

In `packages/daemon/src/world-jobs.test.ts`, add a test where `decideAction` returns a `talk` action for `agent-a` targeting `agent-b` in the same location. Assert events include:

```ts
assert.ok(events.some((event) => event.kind === 'memory_write_requested'))
assert.ok(events.some((event) => event.kind === 'relationship_update_requested'))
```

Use two agents and two memberships in the same location.

- [ ] **Step 2: Run failing test**

Run:

```bash
npm run test --workspace @mas/daemon -- src/world-jobs.test.ts
```

Expected: FAIL because side-effect request events are not emitted.

- [ ] **Step 3: Emit side-effect request events after conversation end**

In `packages/daemon/src/world-jobs.ts`, after appending `conversation_ended`, append one memory request and one relationship request per participant:

```ts
for (const participant of [membership.agentId, target.agentId]) {
  const counterpart = participant === membership.agentId ? target.agentId : membership.agentId
  worldRepo.appendWorldEvent({
    worldId: world.id,
    kind: 'memory_write_requested',
    message: '世界对话请求写入短期记忆',
    actorAgentId: participant,
    targetAgentId: counterpart,
    locationId: membership.locationId,
    payload: {
      source: 'world_conversation',
      conversationStartedAt: nextTime.toISOString(),
      conversationEndedAt: nextTime.toISOString(),
    },
    occurredAt: nextTime,
  })
  worldRepo.appendWorldEvent({
    worldId: world.id,
    kind: 'relationship_update_requested',
    message: '世界对话请求更新双边关系',
    actorAgentId: participant,
    targetAgentId: counterpart,
    locationId: membership.locationId,
    payload: {
      source: 'world_conversation',
    },
    occurredAt: nextTime,
  })
}
```

This is the integration seam. Actual memory and relationship mutation should be implemented in a follow-up plan after real multi-turn dialogue content exists. Do not create fake memories from a one-line conversation boundary.

- [ ] **Step 4: Verify daemon**

Run:

```bash
npm run test --workspace @mas/daemon -- src/world-jobs.test.ts
npm run typecheck --workspace @mas/daemon
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/world-jobs.ts packages/daemon/src/world-jobs.test.ts
git commit -m "feat(world): emit memory and relationship requests"
```

## Task 8: Add Minimal World API For Observability

**Files:**

- Create: `apps/web/src/app/api/worlds/route.ts`
- Create: `apps/web/src/app/api/worlds/[worldId]/events/route.ts`
- [ ] **Step 1: Create world list/create route**

Create `apps/web/src/app/api/worlds/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { worldRepo } from '@mas/db'
import { initDb } from '../../../lib/db-init'

export async function GET() {
  initDb()
  return NextResponse.json({ worlds: worldRepo.listWorlds() })
}

export async function POST(request: Request) {
  initDb()
  const body = await request.json().catch(() => null) as { name?: unknown } | null
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : '新世界'
  const world = worldRepo.createWorld({ name })
  return NextResponse.json({ world }, { status: 201 })
}
```

- [ ] **Step 2: Create event list route**

Create `apps/web/src/app/api/worlds/[worldId]/events/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { worldRepo } from '@mas/db'
import { initDb } from '../../../../../lib/db-init'

export async function GET(
  _request: Request,
  context: { params: Promise<{ worldId: string }> },
) {
  initDb()
  const { worldId } = await context.params
  return NextResponse.json({
    events: worldRepo.listWorldEvents({ worldId, limit: 100 }),
  })
}
```

- [ ] **Step 3: Run web typecheck**

Run:

```bash
npm run typecheck --workspace @mas/web
```

Expected: PASS.

- [ ] **Step 4: Run a browser/API smoke check**

Start the app:

```bash
cd /home/wjj/Project/multi-agent-system/wt/world-v0
npm run dev --workspace @mas/web
```

In a second terminal:

```bash
curl -s http://localhost:3000/api/worlds
```

Expected: JSON object with a `worlds` array.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/worlds
git commit -m "feat(web): expose world event APIs"
```

## Task 9: Final Verification And Documentation Sync

**Files:**

- Modify: `project-docs/STATUS.md`
- Optionally modify: `project-docs/DESIGN.md`

- [ ] **Step 1: Run full focused verification**

Run:

```bash
npm run test --workspace @mas/world
npm run typecheck --workspace @mas/world
npm run test --workspace @mas/db
npm run typecheck --workspace @mas/db
npm run test --workspace @mas/daemon
npm run typecheck --workspace @mas/daemon
npm run typecheck --workspace @mas/web
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 2: Update implemented status**

In `project-docs/STATUS.md`, add a concise implemented capability entry:

```md
- World v0 foundation exists as an event-first text simulation layer: `@mas/world` defines constrained actions and resolver logic, `@mas/db` persists worlds/locations/memberships/events, and the daemon can advance running worlds on fixed ticks.
```

Do not claim real multi-turn world dialogue, 2D/3D rendering, or actual memory mutation from world conversations unless those behaviors are implemented and verified.

- [ ] **Step 3: Commit docs**

```bash
git add project-docs/STATUS.md
git commit -m "docs: record world v0 foundation"
```

- [ ] **Step 4: Confirm final branch state**

Run:

```bash
git status --short
git log --oneline master..HEAD
```

Expected:

- `git status --short` is clean.
- The branch contains one commit per task.

## Follow-Up Plans

This implementation plan deliberately stops at the first reliable world runtime foundation. Create separate plans for these next layers:

- Real multi-turn world conversation generation with two existing agents.
- Actual short-term memory writes from world conversations.
- Actual relationship analysis updates from world conversations.
- Web world management UI and timeline UI.
- 2D map projection from location graph and `world_events`.
