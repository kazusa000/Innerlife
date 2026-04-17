# B3 Modules Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a nullable `agents.modules` JSON field, expose it through the agent CRUD API, and show a placeholder modules section in the persona create/edit form without implementing any runtime module behavior.

**Architecture:** Store `modules` as nullable text in SQLite and convert it to parsed JSON objects only at the repository boundary. Keep API handlers as thin pass-through layers and add a static UI placeholder so later module work can reuse the existing persona form surface.

**Tech Stack:** TypeScript, Next.js App Router, Drizzle ORM, SQLite, Node.js test runner

---

### Task 1: Add a failing repository test for modules persistence

**Files:**
- Create: `packages/db/src/repository/agents.test.ts`
- Modify: none
- Test: `packages/db/src/repository/agents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

test('createAgent and updateAgent round-trip nullable modules JSON', async () => {
  assert.fail('write repository persistence test before implementation')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test packages/db/src/repository/agents.test.ts`
Expected: FAIL with the intentional assertion failure.

- [ ] **Step 3: Replace with the real failing test**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDb } from '../client'
import { createAgent, getAgent, updateAgent } from './agents'

test('createAgent and updateAgent round-trip nullable modules JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mas-db-'))
  const dbPath = join(dir, 'test.db')

  try {
    process.env.DATABASE_URL = dbPath
    initDb()

    const created = createAgent({
      name: 'Modules Test',
      description: 'repo test',
      model: 'claude-sonnet-4-6',
    })

    assert.equal(created.modules, null)

    const modules = {
      personality: { type: 'big-five' },
      safety: { mode: 'confirm-dangerous' },
    }

    const updated = updateAgent(created.id, { modules })
    assert.deepEqual(updated?.modules, modules)

    const loaded = getAgent(created.id)
    assert.deepEqual(loaded?.modules, modules)
  } finally {
    delete process.env.DATABASE_URL
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 4: Run test to verify it fails for the missing `modules` support**

Run: `node --import tsx --test packages/db/src/repository/agents.test.ts`
Expected: FAIL because the repository types or returned shape do not yet include `modules`.

### Task 2: Implement schema and repository support

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/repository/agents.ts`
- Modify: `packages/db/package.json`
- Test: `packages/db/src/repository/agents.test.ts`

- [ ] **Step 1: Add `modules` to the schema**

```ts
  skills: text('skills'),
  modules: text('modules'),
  status: text('status', { enum: ['idle', 'running', 'error'] })
```

- [ ] **Step 2: Add repository serialization helpers and types**

```ts
type AgentModules = Record<string, unknown> | null

function parseModules(modules: string | null) {
  return modules ? (JSON.parse(modules) as Record<string, unknown>) : null
}

function serializeModules(modules: AgentModules | undefined) {
  if (modules === undefined) return undefined
  return modules === null ? null : JSON.stringify(modules)
}
```

- [ ] **Step 3: Update create/get/list/update to use parsed `modules`**

```ts
export function createAgent(data: {
  name: string
  description?: string
  personality?: string
  skills?: string
  model: string
  modules?: Record<string, unknown> | null
}) {
  const db = getDb()
  const id = randomUUID()
  db.insert(agents).values({ id, ...data, modules: serializeModules(data.modules) ?? null }).run()
  return getAgent(id)!
}
```

- [ ] **Step 4: Add `tsx` so the repository test can run**

```json
"devDependencies": {
  "@types/better-sqlite3": "^7.6.13",
  "drizzle-kit": "^0.31.1",
  "tsx": "^4.20.3"
}
```

- [ ] **Step 5: Run the repository test to verify it passes**

Run: `node --import tsx --test packages/db/src/repository/agents.test.ts`
Expected: PASS.

### Task 3: Generate and apply the migration

**Files:**
- Create: `packages/db/migrations/*`
- Modify: `packages/db/migrations/meta/*`
- Test: local SQLite database `data.db`

- [ ] **Step 1: Generate the migration from the schema change**

Run: `npm --workspace packages/db run db:generate`
Expected: a new migration file is created that adds the `modules` column to `agents`.

- [ ] **Step 2: Apply the migration locally**

Run: `npm --workspace packages/db run db:migrate`
Expected: PASS and `data.db` gains an `agents.modules` column without deleting existing rows.

- [ ] **Step 3: Verify the column exists**

Run: `sqlite3 data.db ".schema agents"`
Expected: output includes `modules` on the `agents` table definition.

### Task 4: Expose modules in the agents API

**Files:**
- Modify: `apps/web/src/app/api/agents/route.ts`
- Modify: `apps/web/src/app/api/agents/[id]/route.ts`
- Test: API handlers via typecheck

- [ ] **Step 1: Accept optional `modules` in create**

```ts
  const modules = (body.modules as Record<string, unknown> | null | undefined) ?? null
  const agent = agentRepo.createAgent({ name: name.trim(), description, model, modules })
```

- [ ] **Step 2: Accept optional `modules` in update**

```ts
  const updates: {
    name?: string
    description?: string
    model?: string
    modules?: Record<string, unknown> | null
  } = {}

  if (body.modules !== undefined) updates.modules = body.modules
```

- [ ] **Step 3: Verify API code still typechecks**

Run: `npm --workspace apps/web run typecheck`
Expected: PASS.

### Task 5: Add the placeholder UI section

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Test: manual visual check in the existing homepage form

- [ ] **Step 1: Add the placeholder section inside the form**

```tsx
            <section className="modules-placeholder" aria-label="Modules configuration placeholder">
              <div className="modules-placeholder-head">
                <span className="field-label">模块配置（暂未启用）</span>
                <span className="placeholder-pill">Coming soon</span>
              </div>
              <p className="modules-placeholder-text">
                后续版本会在这里配置 personality、memory、emotion 等模块。当前版本仅预留数据入口，暂不提供编辑控件。
              </p>
            </section>
```

- [ ] **Step 2: Add minimal styles that fit the existing form**

```tsx
        .modules-placeholder {
          border: 1px dashed var(--border);
          border-radius: 18px;
          padding: 14px 16px;
          background: rgba(255, 255, 255, 0.02);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
```

- [ ] **Step 3: Manually confirm layout is still intact**

Run: `cd apps/web && npx next dev --turbopack`
Expected: the create/edit form renders the new placeholder section without breaking the current layout.

### Task 6: Finish task documentation and final verification

**Files:**
- Modify: `project-docs/TASKS/B3-modules-field.md`
- Rename: `project-docs/TASKS/B3-modules-field.md` -> `project-docs/TASKS/(done)B3-modules-field.md`

- [ ] **Step 1: Mark completion criteria checkboxes**

Update the checklist in the task file after verifying the implementation and migration results.

- [ ] **Step 2: Add a completion note**

Add a short note covering what changed, what was verified, and any remaining caveats.

- [ ] **Step 3: Rename the task file with the `(done)` prefix**

Run: `mv project-docs/TASKS/B3-modules-field.md "project-docs/TASKS/(done)B3-modules-field.md"`
Expected: the file remains in the same directory with the required prefix.

- [ ] **Step 4: Run final verification**

Run:
- `node --import tsx --test packages/db/src/repository/agents.test.ts`
- `npm --workspace packages/db run typecheck`
- `npm --workspace apps/web run typecheck`

Expected: all commands pass.
