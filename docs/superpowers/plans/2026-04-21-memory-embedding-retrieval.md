# Memory Embedding Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `memory:sqlite` onto a standalone `memory.db` and switch retrieval from `tags like` to embedding similarity over `retrieval_text`.

**Architecture:** Keep `data.db` as the business database and create `storage/memory/memory.db` for memory records only. Add a minimal OpenRouter embeddings provider, store embeddings with each memory row, and retrieve by comparing the embeddings of the raw user query plus an LLM-rewritten retrieval query.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, Drizzle ORM, OpenRouter embeddings, Next.js.

---

### Task 1: Add memory database pathing and schema

**Files:**
- Create: `packages/db/src/memory-client.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/drizzle.config.ts`
- Test: `packages/db/src/repository/memories.test.ts`

- [ ] Add failing repository tests that expect the new memory shape and standalone memory DB usage.
- [ ] Run the targeted DB tests and confirm they fail for missing `display_summary`, `retrieval_text`, `retrieval_embedding`, and `retrieval_model`.
- [ ] Implement `memory-client.ts` for `storage/memory/memory.db` and switch memory repository access onto it.
- [ ] Replace the memory table schema with the new columns and indexes.
- [ ] Run the targeted DB tests again until green.
- [ ] Commit the schema + client refactor.

### Task 2: Replace repository retrieval with embedding similarity

**Files:**
- Modify: `packages/db/src/repository/memories.ts`
- Test: `packages/db/src/repository/memories.test.ts`

- [ ] Add failing tests for embedding retrieval using raw query + rewritten query + optional time filter.
- [ ] Run the repository tests and confirm they fail for missing embedding-based retrieval.
- [ ] Implement cosine similarity retrieval over `retrieval_embedding`, keeping `time_range` filtering.
- [ ] Remove the old `tags like` primary retrieval path.
- [ ] Run repository tests until green.
- [ ] Commit the repository retrieval change.

### Task 3: Add OpenRouter embeddings provider

**Files:**
- Create: `packages/core/src/provider/embeddings.ts`
- Modify: `packages/core/src/provider/openrouter.ts`
- Modify: `packages/core/src/provider/types.ts`
- Test: `packages/core/src/provider/openrouter.test.ts`

- [ ] Add failing provider tests for OpenRouter embeddings requests and response parsing.
- [ ] Run the provider tests and confirm they fail before implementation.
- [ ] Implement a minimal embeddings provider interface and an OpenRouter embeddings call path.
- [ ] Default the memory embedding model to `qwen/qwen3-embedding-0.6b`.
- [ ] Run provider tests until green.
- [ ] Commit the embeddings provider change.

### Task 4: Rebuild memory system write/query contracts

**Files:**
- Modify: `packages/systems/src/types.ts`
- Modify: `packages/systems/src/memory/sqlite.ts`
- Modify: `packages/core/src/agent/runner.ts`
- Test: `packages/systems/src/memory/sqlite.test.ts`
- Test: `packages/core/src/agent/memory-runner.test.ts`

- [ ] Add failing tests for:
  - summarize output using `display_summary` + `retrieval_text`
  - query output using `retrieval_query` + `time_range` + optional `focus`
  - prompt injection using only `display_summary`
  - observer metadata reflecting the new query shape
- [ ] Run the targeted system/runner tests and confirm they fail.
- [ ] Implement the new prompts, parse contracts, persistence payloads, and retrieval query flow.
- [ ] Ensure memory retrieve uses embeddings for both the raw user message and rewritten retrieval query.
- [ ] Run targeted tests until green.
- [ ] Commit the memory system contract change.

### Task 5: Update memory management API and UI

**Files:**
- Modify: `apps/web/src/app/api/agents/[id]/memory/sqlite/handler.ts`
- Modify: `apps/web/src/app/api/agents/[id]/memory/sqlite/consolidate/handler.ts`
- Modify: `apps/web/src/app/agent/[id]/memory/MemoryManager.sqlite.tsx`
- Modify: `apps/web/src/app/chat/MemoryCallCard.sqlite.tsx`
- Modify: `apps/web/src/lib/call-renderers.tsx`
- Test: `apps/web/src/app/api/agents/[id]/memory/sqlite/route.test.ts`
- Test: `apps/web/src/app/api/agents/[id]/memory/sqlite/consolidate/route.test.ts`
- Test: `apps/web/src/app/chat/ObserverDrawer.test.tsx`

- [ ] Add failing API/UI tests expecting `displaySummary`, `retrievalText`-based management, and observer output for `retrieval_query`.
- [ ] Run the targeted tests and confirm they fail.
- [ ] Update API responses and UI rendering to use the new fields, keeping tags as metadata only.
- [ ] Run targeted tests until green.
- [ ] Commit the web/API adjustment.

### Task 6: Reset old memories and verify end-to-end

**Files:**
- Modify: `apps/web/src/lib/db-init.ts`
- Modify: `packages/db/src/memory-client.ts` (if reset helper belongs there)
- Test: existing targeted suites

- [ ] Add a failing test or verification hook showing that old memory data can be reset without touching `data.db`.
- [ ] Implement explicit memory reset/rebuild behavior for the standalone `memory.db`.
- [ ] Run the full targeted test set:
  - `npm test --workspace @mas/db`
  - `npm test --workspace @mas/core`
  - `npm test --workspace @mas/systems`
  - `node --import tsx --test apps/web/src/app/api/agents/[id]/memory/sqlite/route.test.ts apps/web/src/app/api/agents/[id]/memory/sqlite/consolidate/route.test.ts apps/web/src/app/chat/ObserverDrawer.test.tsx`
  - `npm run build --workspace @mas/web`
- [ ] Commit the reset + verification pass.
