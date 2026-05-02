# D1g — Entity Episodic Memory

## Goal

Replace the old flat long-term memory path with a sqlite-backed entity graph and episodic memory architecture.

## Scope

- Keep `context -> STM` as the short-term front-loaded memory path.
- Add an episodic memory graph layer for long-term recall:
  - `memory_entities`
  - `memory_entity_aliases`
  - `memory_entity_edges`
  - `episodic_memories`
  - `episodic_memory_entities`
- Consolidate STM into episodic memories through two stages:
  - Stage A: extract local entities and episodic drafts.
  - Stage B: resolve local entities into existing or new global entity nodes.
- Use entity nodes and aliases as the entrypoint for long-term recall.
- Keep entity edges untyped and weighted.
- Use summary embeddings for episodic text recall and return `detail` to the memory tool.
- Update the memory management UI and prompt test surfaces for the new architecture.

## Completion Criteria

- `search_long_term_memory` recalls episodic memories through entity mentions and aliases.
- Entity activation is local to the current tool call and does not persist across turns or sessions.
- STM consolidation can create entities, aliases, untyped weighted edges, and episodic memories.
- Stage B resolves local entities in bounded batches with bounded candidate lists.
- Existing episodic memories without summary embeddings are backfilled before text recall.
- `episodic_memories` no longer persists a separate `retrieval_text` field.
- Memory management UI can inspect STM rows, episodic memories, entity nodes, and entity edges without dumping the full graph at once.
- Observer/chat memory displays remain usable with the updated recall metadata.
- The full flow works with a real provider: chat context -> STM -> STM recall -> STM to entity/episodic -> tool node recall.

## Completion Note

Implemented on branch `task/entity-episodic-memory`.

Key behavior:

- `context -> STM` still writes `short_term` rows into the sqlite memory table and these rows are front-loaded before chat.
- `STM -> episodic` processes STM in batches of 3 until exhausted.
- Stage A extracts local entities and episodic drafts.
- Stage B handles local entities in batches of 5; each local entity receives up to 5 candidates ranked by BGE-M3 entity-card embeddings, then an LLM decides `merge` or `create_new`.
- Entity types are narrowed to `person | place | object | event`.
- Alias creation is only allowed during merge resolution.
- Entity activation is transient per `search_long_term_memory` call.
- Entity graph recall uses mention extraction with recent context, entity/alias lookup, one-hop edge spread, and episodic link scoring.
- Text recall uses episodic `summary` embeddings. Tool output returns episodic `detail`.
- Legacy episodic `retrieval_text` is removed from the schema; old DBs are migrated by table rebuild.
- Memory management UI now shows unified memory rows with episodic summary/detail, plus paginated entity nodes and edges.
- Prompt test panels were added for editable memory/emotion/relationship/tool prompts.

Verification run:

- `npm run typecheck --workspace @mas/db`
- `npm run typecheck --workspace @mas/core`
- `npm run typecheck --workspace @mas/daemon`
- `npm run typecheck --workspace @mas/web`
- `node --import tsx --test packages/db/src/repository/episodic-memory-graph.test.ts`
- `node --import tsx --test packages/core/src/tools/search-long-term-memory.test.ts packages/daemon/src/episodic-memory-jobs.test.ts packages/core/src/agent/memory-runner.test.ts`
- `node --import tsx -e "import('./apps/web/src/app/api/agents/[id]/memory/sqlite/route.test.ts')"`

Real provider check:

- `deepseek-v4-pro` hit an upstream OpenRouter 429 during the full-flow run.
- Re-ran the full flow with `deepseek/deepseek-chat-v3-0324` using the real `.env`.
- Verified: initial chat -> context flush into STM -> STM front-loaded recall -> STM consolidation into 2 entities, 1 edge, and 1 episodic memory -> direct tool node recall with `graphScore=1` and `textScore=0` -> chat tool call recall with `search_long_term_memory`.

Known caveat:

- In one real-model tool call, mention extraction labeled `呱呱` as `person` even though the entity was an `object`; recall still succeeded, but mention type calibration should be refined separately.
