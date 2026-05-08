# Innerlife

[中文说明](./README_zh.md)

Innerlife is an experimental local virtual-person runtime for exploring how a virtual person can have long-term episodic memory, entity-graph retrieval, emotional state, relationship state, background consolidation, and observable internal processes.

It is not a production-grade multi-user chat platform. It is a development prototype for research into long-term memory, virtual persons, and agent runtimes. It is still experimental.

## Highlights

The core value of Innerlife is not a single chat interface, but a modular system designed around a virtual person that keeps running over time. It decomposes a virtual person into composable, observable, and continuously updatable parts, giving persona, memory, emotion, relationship, tools, and background processes clear responsibilities.

In this design, a virtual person is not just a name and character prompt, nor just a prompt plus chat history. It is a runtime entity composed from multiple modules:

- Persona module
- Memory module
- Emotion module
- Relationship module
- Tool module
- Daemon
- Observer

Another key design is the entity-graph memory system. The system does not retrieve memory only by text similarity. It organizes people, places, objects, and events into entity nodes, and allows each entity to have personal aliases. This is meant to approximate stable mental representations of concrete things, while letting one memory hit spread along weighted edges to nearby entities and bring up a cluster of related experiences.

This structure allows a virtual person to gradually form its own memory network, relationship state, and internal rhythm instead of starting from zero and role-playing temporarily on every turn.

## Current Capabilities

- Create, edit, and delete multiple virtual persons
- Web chat interface
- Streaming replies and interruption
- Anthropic, OpenRouter, and OpenAI-compatible model providers
- Local database persistence
- Per-person tool management
- Short-term memory retrieval
- Entity graph plus long-term episodic memory retrieval
- Emotion state system
- Relationship state system
- Daemon-based memory consolidation
- Observer debugging interface
- Chinese and English interface switching

## Modules

### 1. Persona Module

The persona module defines the virtual person's basic identity, speaking style, and interaction boundaries.

It currently includes:

- System prompt
- Persona prompt
- Virtual-person name
- Virtual-person description
- Avatar and profile information

The persona is not hard-coded directly into the main prompt. It is loaded as virtual-person configuration and enters the runtime on each conversation turn.

### 2. Memory Module

The memory module is the core part of the project.

Innerlife does not treat long-term memory as a plain chat log, and it does not put every memory directly into the prompt. It separates memory into several layers, with each layer taking a different role:

```
Active context
  -> Short-term memory
  -> Episodic memory
  -> Entity graph
```

#### Active Context

Active context is the current active conversation window. It represents what is being discussed recently. It participates in the current conversation, but does not directly become long-term memory.

#### Short-Term Memory

Short-term memory stores recent information that may be useful later. Before each chat turn, the system retrieves short-term memory and decides whether the matched memories should enter the prompt.

Short-term memory retrieval is not simple keyword search. Two analyzers jointly produce the retrieval intent for the current turn:

- **Time analyzer**: calls a language model before each turn to infer a memory-search time range from the current time, recent conversation, and the latest user message. If it fails, the system falls back to a local time parser.
- **Semantic analyzer**: uses a lightweight language-model call to resolve pronouns, omissions, and references in the latest user message from recent conversation, producing one stable retrieval query.

The system then combines the time range and semantic query, and uses vector retrieval over existing short-term memories:

```
Latest user message
  -> Time analyzer
  -> Semantic analyzer
  -> Vector retrieval
  -> Matched short-term memories enter the prompt
```

If short-term memory is enough to answer, the main model can use it directly without calling the long-term memory tool.

#### Episodic Memory

Episodic memory stores long-term events, scenes, relationships, and experiences. It is not a per-turn chat summary. It is a more stable memory fragment consolidated by the daemon from short-term memory.

An episodic memory usually contains:

- Summary
- Detail
- Importance
- Observed time range
- Linked entities
- Summary vector

The summary is used for vectorization and retrieval. The detail is the actual memory content returned for the main model to read.

When writing long-term episodic memory, the daemon first extracts local entities and episodic-memory drafts from short-term memories, then resolves the local entities into the global entity graph:

```
Short-term memory
  -> Local entities + episodic-memory drafts
  -> Entity resolution
  -> Episodic memory + entity links
```

This avoids standardizing names from the original text too early, while still allowing long-term memory to attach to stable entity nodes.

#### Entity Graph

The entity graph is based on a simple observation: human memory is not stored only by text similarity. We form stable mental representations for specific people, places, objects, and events, and each person may create their own names, nicknames, and aliases for those objects. The same game, person, or cat may have different names in different people's memories.

Human recall is also not a single-point lookup. Thinking of one person often brings up related places, shared experiences, common topics, and nearby emotional background. This resembles spreading activation in associative memory: once a node is lit up, activation spreads along related connections to nearby nodes and brings up a cluster of related memories.

The entity graph is therefore not intended to be a general knowledge graph. It is meant to model personalized naming and associative recall: aliases handle different names for the same object, and weighted edges let memory spread from one entity to nearby entities.

The entity graph stores stable objects in memory and the connections between them. Entity types are currently narrowed to:

- Person
- Place
- Object
- Event

Each entity can have a canonical name, description, and aliases. Aliases are not freely generated during normal extraction. They are created only when entity resolution decides that two mentions refer to the same object.

Edges between entities are untyped weighted edges. They represent the strength of co-occurrence in episodic memories, not manually written relationship types.

During long-term retrieval, the entity graph expands one hit into a related memory network:

```
Entity mentions
  -> Match entity nodes by canonical names / aliases
  -> Activate matched entities
  -> Spread one hop to neighboring entities
  -> Find related episodic memories
```

This allows the system to find the "StarCraft II" node through an alias like "SC2", and also retrieve related episodic memories through entities near the activated node.

#### Long-Term Memory Retrieval

Long-term memory does not automatically enter the prompt on every turn. It is retrieved through the long-term memory search tool. Retrieval uses both the entity graph path and the text-semantic path:

```
Current question + recent context
  -> Extract entity mentions
  -> Match entity nodes by canonical names / aliases
  -> One-hop weighted spreading
  -> Semantic matching on summary vectors
  -> Return episodic memory details
```

The tool returns episodic memory details, not just summaries. A retrieved episodic memory also receives a temporary short-term activation state, so it can participate in short-term memory retrieval for a while. It is not permanently fixed into the prompt.

### 3. Emotion Module

The emotion module maintains the virtual person's persistent emotional state.

Current dimensions:

- Mood
- Energy
- Stress

After each conversation turn, the system analyzes how the interaction affected the emotional state and writes a new state.

Emotion decays toward a baseline over time or turns. It is not fully regenerated on every turn.

Emotional state affects reply tone through prompt fragments, but raw scores are not exposed directly to the user.

### 4. Relationship Module

The relationship module maintains the virtual person's relationship state toward different counterparts. Its goal is not to make the model temporarily "act out" a relationship on every turn, but to make relationship a persistent state that can be read, injected, analyzed, and updated.

Current dimensions:

- Trust
- Closeness
- Familiarity
- Respect

There are currently two modes. Multi-dimensional relationship is the default single-counterpart mode, suitable for simple cases where only the relationship between the virtual person and the user matters.

The more distinctive mode is named multi-dimensional relationship: one virtual person can maintain multiple named counterparts, each with its own relationship state and history.

A counterpart can include:

- Name
- Role
- Description
- Avatar
- Subjective note
- Relationship dimensions
- Relationship history

A chat session can be bound to a counterpart. Only after binding will the relationship module inject that counterpart's relationship state into the prompt:

```
Session
  -> Bind counterpart
  -> Read relationship state
  -> Inject relationship prompt fragment
  -> Analyze relationship changes for this turn
  -> Update only that counterpart
```

This means the same virtual person can have different levels of closeness, trust, familiarity, and respect toward different counterparts. For example, it can maintain different relationships for a research partner, a casual visitor, and a long-term friend, instead of mixing every interaction into one global user state.

After each conversation turn, the system analyzes how the turn affected the currently bound counterpart, generates relationship deltas, and applies slight decay toward the baseline. Relationship state affects tone, patience, closeness, and wording, but scores are not exposed directly to the user.

### 5. Tool Module

The tool module controls what capabilities a virtual person can actively use. This README focuses on the long-term memory search tool.

The long-term memory search tool is the main model's entry point into long-term episodic memory. Innerlife does not put all long-term memories into the prompt on every turn. Instead, the model can call this tool when context and short-term memory are not enough.

Its key feature is that the tool call is not simple text search. It combines the semantic query produced by short-term memory retrieval, the tool input query, recent context, and the entity graph.

```
Long-term memory search tool
  -> Generate long-term memory text query
  -> Extract entity mentions
  -> Match entity nodes by canonical names / aliases
  -> One-hop spreading through the entity graph
  -> Semantic recall over summary vectors
  -> Merge and rank
  -> Return episodic memory details
```

If retrieval succeeds, the tool returns episodic memory details so the main model can read fuller event descriptions instead of only short summaries.

Retrieved episodic memories are also temporarily activated. In later conversation, they can be hit by the pre-turn short-term memory retrieval path. This activation has both a count limit and an expiration time, so it does not become a permanent fixed prompt.

### 6. Daemon Module

The daemon is Innerlife's local background heartbeat.

The main chat only handles the conversation happening now. The daemon keeps working outside the conversation: checking active context, organizing short-term memory, consolidating long-term episodic memory, and recording daemon events. It lets the virtual person have a rhythm for maintaining its own state in a local process, instead of only passively waiting for the next message.

It currently handles:

```
Context -> Short-term memory
Short-term memory -> Episodic memory + entity graph
```

The daemon gradually turns conversation context into structured memory and writes it into the local database. It does not answer the user for the main model, and it does not directly change an ongoing reply. It handles memory consolidation work that is better done slowly in the background.

The daemon also stores its own runtime status and event stream, including start time, heartbeat, recent errors, refresh results, and sleep-consolidation results. This allows the observer and daemon workbench to show whether the background heartbeat is still running.

### 7. Observer Module

The observer is the research and debugging entry point for inspecting the virtual person's internal processes.

It can replay previous runs on the standalone observer page, and it can also be opened as a live drawer in the chat page to inspect language-model calls, prompt fragments, tool calls, and memory retrieval for the current turn.

It can show:

- Final system prompt
- Prompt fragments
- Language-model calls
- Tool calls
- Memory retrieval details
- Entity mentions
- Activated entities
- Episodic memory hits
- Emotion analysis
- Relationship analysis

Its goal is to make "why did the virtual person answer this way?" inspectable.

## System Architecture

```
apps/web
  Next.js web interface, API routes, chat page, virtual-person management pages

packages/core
  Model providers, agent loop, tool execution, streaming runtime

packages/systems
  System lifecycle modules:
  memory, emotion, relationship, context compression

packages/db
  Local database schema, migrations, repositories, initialization

packages/daemon
  Local background tasks:
  context -> short-term memory
  short-term memory -> episodic memory + entity graph

packages/observer
  Language-model call records, prompt snapshots, internal-process observation
```

## Runtime Flow

```
User input
  -> Web chat API
  -> Load virtual person / session / modules
  -> Pre-turn system processing
  -> Assemble prompt fragments before model call
  -> Core language-model and tool loop
  -> Post-model system processing
  -> End-of-turn system processing
  -> Persist messages, states, and daemon task data
```

## Quick Start

```
npm install
cp .env.example .env
npm run dev --workspace @mas/web
```

Open:

```
http://localhost:3000
```

Optional daemon:

```
npm run daemon:start
```

## Example Usage

There are two clean sample agents under `examples/`:

- `examples/zh` contains a Chinese sample agent.
- `examples/en` contains an English sample agent.

Each sample uses the same local data layout as the app:

```
storage/app/data.db
storage/memory/memory.db
```

To try a sample agent, start from an empty local data directory or move your existing `storage/` directory aside first, then copy one sample into the project root:

```
cp -r examples/zh/storage ./storage
```

Use `examples/en/storage` instead for the English sample.

Suggested ways to try the project:

- Start with the Chinese sample agent and ask about its recent memories, relationship counterparts, and long-term experiences.
- Open the observer drawer during chat to inspect prompt fragments, memory retrieval, activated entities, tool calls, emotion analysis, and relationship analysis.
- Start the daemon and let it consolidate context into short-term memory, then into episodic memory and the entity graph.
- Create a fresh virtual person from an empty database if you want to test the architecture without demo data.

## Model Provider Configuration

Currently supported:

- Anthropic
- OpenRouter
- OpenAI-compatible interface

Memory vectorization currently mainly uses OpenRouter. The default model is:

```
qwen/qwen3-embedding-8b
```

Configuration is split between `.env` and the web UI:

- Put provider API keys and optional base URLs in `.env`.
- Select the chat model provider and model on the virtual-person settings page.
- Select the memory embedding provider and embedding model in the memory settings.

See `.env.example` for Anthropic, OpenRouter, OpenAI-compatible, and DeepSeek-compatible examples.

## Local Data And Privacy

Default data paths:

```
storage/app/data.db
storage/memory/memory.db
```

These databases may contain real chats, prompts, memories, and relationship states.

Do not commit real databases to a public repository.

The checked-in databases under `examples/` are demo databases intended for public use. They should be reviewed before release whenever the sample agents are changed.

## Development Checks

Useful verification commands:

```
npm run typecheck --workspace @mas/systems
npm run typecheck --workspace @mas/core
npm run typecheck --workspace @mas/web
npm test --workspace @mas/systems
npm test --workspace @mas/core
```

End-to-end tests are available separately:

```
npm run playwright:install
npm run test:e2e
```

## Current Limitations

- This is an experimental project. APIs and database schemas are not guaranteed to be stable.
- It is currently aimed at local single-user research, not production-grade multi-user service.
- Memory retrieval is still research-level and needs more testing and tuning.
- Local data may contain sensitive content and must be cleaned before public release.
- Model providers, vectorization, and daemon behavior are still evolving quickly.

## License

MIT
