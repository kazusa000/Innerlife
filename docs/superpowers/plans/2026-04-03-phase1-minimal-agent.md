# Phase 1 Minimal Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working web app where you can chat with an AI agent that can execute bash commands, with streaming responses.

**Architecture:** Monorepo with npm workspaces. `packages/core` holds the agent loop, tool system, and LLM provider. `packages/db` holds SQLite schema and data access. `apps/web` is a Next.js app with a single chat page and SSE-based streaming API route.

**Tech Stack:** TypeScript, Node 24, npm workspaces, Next.js 15 (App Router), Anthropic SDK, Drizzle ORM, better-sqlite3, SSE

---

## File Structure

```
multi-agent-system/
├── package.json                          # npm workspaces root
├── tsconfig.json                         # base tsconfig
├── .gitignore
│
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # public API barrel export
│   │       ├── types.ts                  # Message, ContentBlock, ToolCall
│   │       ├── agent/
│   │       │   ├── runner.ts             # runAgent() async generator
│   │       │   └── types.ts             # AgentConfig, AgentEvent
│   │       ├── tools/
│   │       │   ├── types.ts             # Tool, ToolResult interfaces
│   │       │   ├── bash.ts              # BashTool implementation
│   │       │   └── registry.ts          # executeTool() dispatcher
│   │       └── provider/
│   │           ├── types.ts             # LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent
│   │           └── anthropic.ts         # AnthropicProvider implementation
│   │
│   └── db/
│       ├── package.json
│       ├── tsconfig.json
│       ├── drizzle.config.ts
│       └── src/
│           ├── index.ts                  # public API barrel export
│           ├── client.ts                 # SQLite connection singleton
│           ├── schema.ts                # all tables in one file (small Phase 1)
│           └── repository/
│               ├── agents.ts            # agent (虚拟人) CRUD
│               ├── sessions.ts          # session CRUD
│               └── messages.ts          # message CRUD + tool executions
│
├── apps/
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       ├── next.config.ts
│       └── src/
│           └── app/
│               ├── layout.tsx            # root layout
│               ├── page.tsx              # redirect to default chat
│               ├── chat/
│               │   └── page.tsx          # chat UI component
│               ├── api/
│               │   └── chat/
│               │       └── route.ts      # POST — SSE streaming endpoint
│               └── globals.css           # minimal styles
│
└── .env.example                          # ANTHROPIC_API_KEY=sk-ant-...
```

---

### Task 1: Monorepo Skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`

- [ ] **Step 1: Initialize root package.json with workspaces**

```json
{
  "name": "multi-agent-system",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*",
    "apps/*"
  ]
}
```

- [ ] **Step 2: Create base tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
.next/
*.db
*.db-journal
.env
.env.local
```

- [ ] **Step 4: Create .env.example**

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

- [ ] **Step 5: Create packages/core/package.json**

```json
{
  "name": "@mas/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.52.0"
  }
}
```

- [ ] **Step 6: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Create packages/db/package.json**

```json
{
  "name": "@mas/db",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "better-sqlite3": "^11.9.1",
    "drizzle-orm": "^0.44.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "drizzle-kit": "^0.31.1"
  }
}
```

- [ ] **Step 8: Create packages/db/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src", "drizzle.config.ts"]
}
```

- [ ] **Step 9: Run npm install from root**

Run: `cd /home/wjj/Project/multi-agent-system/multi-agent-system && npm install`
Expected: node_modules created, workspaces linked

- [ ] **Step 10: Commit**

```bash
git init
git add -A
git commit -m "chore: initialize monorepo skeleton with npm workspaces"
```

---

### Task 2: Shared Types (packages/core)

**Files:**
- Create: `packages/core/src/types.ts`

- [ ] **Step 1: Define core message types**

```typescript
// packages/core/src/types.ts

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

export interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): add shared message and content block types"
```

---

### Task 3: Tool System (packages/core)

**Files:**
- Create: `packages/core/src/tools/types.ts`
- Create: `packages/core/src/tools/bash.ts`
- Create: `packages/core/src/tools/registry.ts`

- [ ] **Step 1: Define Tool interface**

```typescript
// packages/core/src/tools/types.ts

export interface ToolResult {
  output: string
  isError?: boolean
  metadata?: Record<string, unknown>
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  call(input: Record<string, unknown>): Promise<ToolResult>
  isEnabled?(): boolean
}
```

- [ ] **Step 2: Implement BashTool**

```typescript
// packages/core/src/tools/bash.ts

import { exec } from 'node:child_process'
import type { Tool, ToolResult } from './types.js'

export const BashTool: Tool = {
  name: 'bash',
  description:
    'Execute a shell command and return its stdout and stderr. Use this to run programs, inspect files, or perform system operations.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
    },
    required: ['command'],
  },

  async call(input: Record<string, unknown>): Promise<ToolResult> {
    const command = input.command as string
    const timeout = (input.timeout as number) ?? 30_000

    return new Promise((resolve) => {
      exec(command, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && !stdout && !stderr) {
          resolve({
            output: `Error: ${error.message}`,
            isError: true,
            metadata: { command, exitCode: error.code },
          })
          return
        }

        const output = [stdout, stderr].filter(Boolean).join('\n---stderr---\n')
        resolve({
          output: output || '(no output)',
          isError: !!error,
          metadata: { command, exitCode: error?.code ?? 0 },
        })
      })
    })
  },
}
```

- [ ] **Step 3: Implement tool registry / executor**

```typescript
// packages/core/src/tools/registry.ts

import type { Tool, ToolResult } from './types.js'
import type { ToolDefinition, ToolUseBlock } from '../types.js'

export function toolsToDefinitions(tools: Tool[]): ToolDefinition[] {
  return tools
    .filter((t) => !t.isEnabled || t.isEnabled())
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))
}

export async function executeTool(
  tools: Tool[],
  toolCall: ToolUseBlock,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === toolCall.name)
  if (!tool) {
    return { output: `Unknown tool: ${toolCall.name}`, isError: true }
  }
  try {
    return await tool.call(toolCall.input)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { output: `Tool execution error: ${message}`, isError: true }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tools/
git commit -m "feat(core): add tool interface, BashTool, and tool registry"
```

---

### Task 4: LLM Provider (packages/core)

**Files:**
- Create: `packages/core/src/provider/types.ts`
- Create: `packages/core/src/provider/anthropic.ts`

- [ ] **Step 1: Define LLMProvider interface**

```typescript
// packages/core/src/provider/types.ts

import type { ContentBlock, Message, ToolDefinition } from '../types.js'

export interface LLMRequest {
  model: string
  systemPrompt: string
  messages: Message[]
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
}

export interface LLMResponse {
  content: ContentBlock[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  usage: { inputTokens: number; outputTokens: number }
}

export type LLMStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; input: string }
  | { type: 'message_complete'; response: LLMResponse }

export interface LLMProvider {
  name: string
  streamMessage(params: LLMRequest): AsyncGenerator<LLMStreamEvent>
  sendMessage(params: LLMRequest): Promise<LLMResponse>
}
```

- [ ] **Step 2: Implement AnthropicProvider**

```typescript
// packages/core/src/provider/anthropic.ts

import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent } from './types.js'
import type { ContentBlock } from '../types.js'

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  private client: Anthropic

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    })
  }

  async *streamMessage(params: LLMRequest): AsyncGenerator<LLMStreamEvent> {
    const stream = this.client.messages.stream({
      model: params.model,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools: params.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      })),
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature,
    })

    const contentBlocks: ContentBlock[] = []
    let currentToolId = ''
    let currentToolName = ''
    let currentToolInput = ''

    for await (const event of stream) {
      switch (event.type) {
        case 'content_block_start': {
          const block = event.content_block
          if (block.type === 'text') {
            // text block started, deltas will follow
          } else if (block.type === 'tool_use') {
            currentToolId = block.id
            currentToolName = block.name
            currentToolInput = ''
            yield { type: 'tool_use_start', id: block.id, name: block.name }
          }
          break
        }
        case 'content_block_delta': {
          const delta = event.delta
          if (delta.type === 'text_delta') {
            yield { type: 'text_delta', text: delta.text }
          } else if (delta.type === 'input_json_delta') {
            currentToolInput += delta.partial_json
            yield { type: 'tool_use_delta', id: currentToolId, input: delta.partial_json }
          }
          break
        }
        case 'content_block_stop': {
          if (currentToolName) {
            contentBlocks.push({
              type: 'tool_use',
              id: currentToolId,
              name: currentToolName,
              input: JSON.parse(currentToolInput || '{}'),
            })
            currentToolName = ''
          }
          break
        }
        case 'message_stop': {
          // handled after loop
          break
        }
      }
    }

    const finalMessage = await stream.finalMessage()

    // Build content blocks from final message for text blocks
    const allBlocks: ContentBlock[] = finalMessage.content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text }
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        }
      }
      return { type: 'text' as const, text: '' }
    })

    const response: LLMResponse = {
      content: allBlocks,
      stopReason: finalMessage.stop_reason as LLMResponse['stopReason'],
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      },
    }

    yield { type: 'message_complete', response }
  }

  async sendMessage(params: LLMRequest): Promise<LLMResponse> {
    let result: LLMResponse | undefined
    for await (const event of this.streamMessage(params)) {
      if (event.type === 'message_complete') {
        result = event.response
      }
    }
    if (!result) throw new Error('No response received from Anthropic')
    return result
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/provider/
git commit -m "feat(core): add LLMProvider interface and AnthropicProvider"
```

---

### Task 5: Agent Runner (packages/core)

**Files:**
- Create: `packages/core/src/agent/types.ts`
- Create: `packages/core/src/agent/runner.ts`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Define agent types**

```typescript
// packages/core/src/agent/types.ts

import type { Tool } from '../tools/types.js'
import type { LLMResponse } from '../provider/types.js'
import type { ToolResult } from '../tools/types.js'

export interface AgentConfig {
  id: string
  model: string
  systemPrompt: string
  tools: Tool[]
  maxTurns?: number
}

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; result: ToolResult }
  | { type: 'complete'; response: LLMResponse }
  | { type: 'error'; error: Error }
```

- [ ] **Step 2: Implement runAgent async generator**

```typescript
// packages/core/src/agent/runner.ts

import type { AgentConfig, AgentEvent } from './types.js'
import type { LLMProvider, LLMResponse } from '../provider/types.js'
import type { Message, ContentBlock, ToolUseBlock } from '../types.js'
import { toolsToDefinitions, executeTool } from '../tools/registry.js'

export async function* runAgent(
  config: AgentConfig,
  messages: Message[],
  provider: LLMProvider,
): AsyncGenerator<AgentEvent> {
  const maxTurns = config.maxTurns ?? 20
  let turns = 0

  while (true) {
    if (++turns > maxTurns) {
      yield { type: 'error', error: new Error(`Max turns (${maxTurns}) exceeded`) }
      return
    }

    // Stream LLM call and collect events
    let response: LLMResponse | undefined

    try {
      for await (const event of provider.streamMessage({
        model: config.model,
        systemPrompt: config.systemPrompt,
        messages,
        tools: toolsToDefinitions(config.tools),
      })) {
        if (event.type === 'text_delta') {
          yield { type: 'text_delta', text: event.text }
        } else if (event.type === 'message_complete') {
          response = event.response
        }
      }
    } catch (err) {
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) }
      return
    }

    if (!response) {
      yield { type: 'error', error: new Error('No response from LLM') }
      return
    }

    // Append assistant message
    messages.push({ role: 'assistant', content: response.content })

    // If no tool use, we're done
    if (response.stopReason !== 'tool_use') {
      yield { type: 'complete', response }
      return
    }

    // Execute tools
    const toolUses = response.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    )

    const toolResults: ContentBlock[] = []

    for (const toolCall of toolUses) {
      yield { type: 'tool_start', toolName: toolCall.name, input: toolCall.input }
      const result = await executeTool(config.tools, toolCall)
      yield { type: 'tool_result', toolName: toolCall.name, result }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolCall.id,
        content: result.output,
        is_error: result.isError,
      })
    }

    // Append tool results as user message
    messages.push({ role: 'user', content: toolResults })
  }
}
```

- [ ] **Step 3: Create barrel export**

```typescript
// packages/core/src/index.ts

export type { Message, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock, ToolDefinition } from './types.js'
export type { AgentConfig, AgentEvent } from './agent/types.js'
export type { Tool, ToolResult } from './tools/types.js'
export type { LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent } from './provider/types.js'

export { runAgent } from './agent/runner.js'
export { BashTool } from './tools/bash.js'
export { toolsToDefinitions, executeTool } from './tools/registry.js'
export { AnthropicProvider } from './provider/anthropic.js'
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent/ packages/core/src/index.ts
git commit -m "feat(core): add agent runner with async generator loop"
```

---

### Task 6: Database Layer (packages/db)

**Files:**
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/repository/agents.ts`
- Create: `packages/db/src/repository/sessions.ts`
- Create: `packages/db/src/repository/messages.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/drizzle.config.ts`

- [ ] **Step 1: Define schema**

```typescript
// packages/db/src/schema.ts

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  personality: text('personality'),   // JSON: { traits, speakingStyle, values, background, quirks }
  skills: text('skills'),             // JSON: skill file paths, e.g. ["skills/cooking.md"]
  status: text('status', { enum: ['idle', 'running', 'error'] }).notNull().default('idle'),
  model: text('model').notNull(),
  config: text('config'),             // JSON: runtime config (tools, maxTurns, etc.)
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  title: text('title'),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(), // JSON string of ContentBlock[]
  tokenCount: integer('token_count'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

export const toolExecutions = sqliteTable('tool_executions', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => messages.id),
  toolName: text('tool_name').notNull(),
  input: text('input').notNull(), // JSON
  output: text('output').notNull(),
  isError: integer('is_error', { mode: 'boolean' }).notNull().default(false),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})
```

- [ ] **Step 2: Create database client**

```typescript
// packages/db/src/client.ts

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

let db: ReturnType<typeof drizzle> | null = null

export function getDb(dbPath?: string) {
  if (!db) {
    const sqlite = new Database(dbPath ?? 'data.db')
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
  }
  return db
}
```

- [ ] **Step 3: Implement agent repository**

```typescript
// packages/db/src/repository/agents.ts

import { eq } from 'drizzle-orm'
import { getDb } from '../client.js'
import { agents } from '../schema.js'
import { randomUUID } from 'node:crypto'

export function createAgent(data: {
  name: string
  description?: string
  personality?: string
  skills?: string       // JSON array of skill file paths
  model: string
}) {
  const db = getDb()
  const id = randomUUID()
  db.insert(agents).values({ id, ...data }).run()
  return getAgent(id)!
}

export function getAgent(id: string) {
  const db = getDb()
  return db.select().from(agents).where(eq(agents.id, id)).get()
}

export function listAgents() {
  const db = getDb()
  return db.select().from(agents).all()
}
```

- [ ] **Step 4: Implement session repository**

```typescript
// packages/db/src/repository/sessions.ts

import { eq } from 'drizzle-orm'
import { getDb } from '../client.js'
import { sessions } from '../schema.js'
import { randomUUID } from 'node:crypto'

export function createSession(agentId: string, title?: string) {
  const db = getDb()
  const id = randomUUID()
  db.insert(sessions).values({ id, agentId, title }).run()
  return db.select().from(sessions).where(eq(sessions.id, id)).get()!
}

export function getSession(id: string) {
  const db = getDb()
  return db.select().from(sessions).where(eq(sessions.id, id)).get()
}

export function listSessionsByAgent(agentId: string) {
  const db = getDb()
  return db.select().from(sessions).where(eq(sessions.agentId, agentId)).all()
}
```

- [ ] **Step 5: Implement message repository**

```typescript
// packages/db/src/repository/messages.ts

import { eq } from 'drizzle-orm'
import { getDb } from '../client.js'
import { messages, toolExecutions } from '../schema.js'
import { randomUUID } from 'node:crypto'

export function addMessage(data: {
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tokenCount?: number
}) {
  const db = getDb()
  const id = randomUUID()
  db.insert(messages).values({ id, ...data }).run()
  return id
}

export function getSessionMessages(sessionId: string) {
  const db = getDb()
  return db.select().from(messages).where(eq(messages.sessionId, sessionId)).all()
}

export function addToolExecution(data: {
  messageId: string
  toolName: string
  input: string
  output: string
  isError: boolean
  durationMs: number
}) {
  const db = getDb()
  const id = randomUUID()
  db.insert(toolExecutions).values({ id, ...data }).run()
}
```

- [ ] **Step 6: Create barrel export**

```typescript
// packages/db/src/index.ts

export { getDb } from './client.js'
export * as schema from './schema.js'
export * as agentRepo from './repository/agents.js'
export * as sessionRepo from './repository/sessions.js'
export * as messageRepo from './repository/messages.js'
```

- [ ] **Step 7: Create drizzle config**

```typescript
// packages/db/drizzle.config.ts

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: 'data.db',
  },
})
```

- [ ] **Step 8: Commit**

```bash
git add packages/db/
git commit -m "feat(db): add SQLite schema, client, and repository layer"
```

---

### Task 7: Next.js Web App — Skeleton + API

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/api/chat/route.ts`

- [ ] **Step 1: Create apps/web/package.json**

```json
{
  "name": "@mas/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@mas/core": "*",
    "@mas/db": "*",
    "drizzle-orm": "^0.44.2",
    "next": "^15.3.2",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Create apps/web/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "next-env.d.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create next.config.ts**

```typescript
// apps/web/next.config.ts

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
}

export default nextConfig
```

- [ ] **Step 4: Create root layout**

```tsx
// apps/web/src/app/layout.tsx

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Multi-Agent System',
  description: 'AI Virtual Persona Management',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 5: Create minimal globals.css**

```css
/* apps/web/src/app/globals.css */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0a0a0a;
  color: #ededed;
}
```

- [ ] **Step 6: Create SSE chat API route**

This is the core API — receives a message, runs the agent loop, streams events back via SSE.

```typescript
// apps/web/src/app/api/chat/route.ts

import { runAgent, AnthropicProvider, BashTool } from '@mas/core'
import type { AgentConfig } from '@mas/core'
import { getDb, agentRepo, sessionRepo, messageRepo, schema } from '@mas/db'
import { eq } from 'drizzle-orm'
import type { Message } from '@mas/core'

// Initialize DB tables on first import via raw SQL (simple bootstrap, no migrations needed)
function initDb() {
  const db = getDb()
  const sqlite = (db as any)._.session.client as import('better-sqlite3').Database
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      personality TEXT,
      skills TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      model TEXT NOT NULL,
      config TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS tool_executions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id),
      tool_name TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      is_error INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
  `)
}

// Ensure a default agent + session exist
function ensureDefaults() {
  initDb()

  let agent = agentRepo.listAgents()[0]
  if (!agent) {
    agent = agentRepo.createAgent({
      name: 'Default Agent',
      description: 'A helpful AI assistant that can execute bash commands.',
      model: 'claude-sonnet-4-20250514',
    })!
  }

  const db = getDb()
  const existingSession = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.agentId, agent.id))
    .get()

  if (existingSession) return existingSession

  return sessionRepo.createSession(agent.id, 'Default Chat')
}

let defaultSessionId: string | null = null

function getDefaultSessionId(): string {
  if (!defaultSessionId) {
    const session = ensureDefaults()
    defaultSessionId = session.id
  }
  return defaultSessionId
}

export async function POST(request: Request) {
  const body = await request.json()
  const userMessage = body.message as string
  const sessionId = (body.sessionId as string) || getDefaultSessionId()

  // Save user message
  messageRepo.addMessage({
    sessionId,
    role: 'user',
    content: JSON.stringify([{ type: 'text', text: userMessage }]),
  })

  // Load conversation history
  const dbMessages = messageRepo.getSessionMessages(sessionId)
  const messages: Message[] = dbMessages.map((m) => ({
    role: m.role as Message['role'],
    content: JSON.parse(m.content),
  }))

  const provider = new AnthropicProvider()
  const config: AgentConfig = {
    id: 'default',
    model: 'claude-sonnet-4-20250514',
    systemPrompt: 'You are a helpful AI assistant. You can execute bash commands to help the user. Be concise.',
    tools: [BashTool],
    maxTurns: 10,
  }

  // Create SSE stream
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgent(config, messages, provider)) {
          const data = JSON.stringify(event)
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))

          // Save assistant message on complete
          if (event.type === 'complete') {
            messageRepo.addMessage({
              sessionId,
              role: 'assistant',
              content: JSON.stringify(event.response.content),
              tokenCount: event.response.usage.outputTokens,
            })
          }
        }
      } catch (err) {
        const errorEvent = JSON.stringify({
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
        controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`))
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/
git commit -m "feat(web): add Next.js skeleton with SSE chat API route"
```

---

### Task 8: Chat UI

**Files:**
- Create: `apps/web/src/app/chat/page.tsx`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Create chat page component**

```tsx
// apps/web/src/app/chat/page.tsx

'use client'

import { useState, useRef, useEffect } from 'react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ToolExecution {
  toolName: string
  input: Record<string, unknown>
  output?: string
  isError?: boolean
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentTools, setCurrentTools] = useState<ToolExecution[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentTools])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isStreaming) return

    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsStreaming(true)
    setCurrentTools([])

    let assistantText = ''

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break

          try {
            const event = JSON.parse(data)

            switch (event.type) {
              case 'text_delta':
                assistantText += event.text
                setMessages((prev) => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: assistantText }
                  } else {
                    updated.push({ role: 'assistant', content: assistantText })
                  }
                  return updated
                })
                break

              case 'tool_start':
                setCurrentTools((prev) => [
                  ...prev,
                  { toolName: event.toolName, input: event.input },
                ])
                break

              case 'tool_result':
                setCurrentTools((prev) =>
                  prev.map((t) =>
                    t.toolName === event.toolName && !t.output
                      ? { ...t, output: event.result.output, isError: event.result.isError }
                      : t,
                  ),
                )
                break

              case 'complete':
                // Reset for potential next text after tool results
                assistantText = ''
                break

              case 'error':
                setMessages((prev) => [
                  ...prev,
                  { role: 'assistant', content: `Error: ${event.error}` },
                ])
                break
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Connection error: ${err}` },
      ])
    } finally {
      setIsStreaming(false)
      setCurrentTools([])
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 800, margin: '0 auto' }}>
      <header style={{ padding: '16px 20px', borderBottom: '1px solid #222', flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>Multi-Agent System</h1>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {messages.length === 0 && (
          <p style={{ color: '#666', textAlign: 'center', marginTop: 100 }}>
            Send a message to start chatting.
          </p>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              marginBottom: 16,
              padding: '12px 16px',
              borderRadius: 8,
              background: msg.role === 'user' ? '#1a1a2e' : '#111',
              borderLeft: msg.role === 'assistant' ? '3px solid #4a9eff' : 'none',
            }}
          >
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
              {msg.role === 'user' ? 'You' : 'Agent'}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{msg.content}</div>
          </div>
        ))}

        {currentTools.map((tool, i) => (
          <div
            key={i}
            style={{
              marginBottom: 8,
              padding: '8px 12px',
              borderRadius: 6,
              background: '#0d1117',
              border: '1px solid #30363d',
              fontSize: 13,
            }}
          >
            <div style={{ color: '#f0883e' }}>
              $ {tool.toolName}: {JSON.stringify(tool.input)}
            </div>
            {tool.output && (
              <pre style={{ color: tool.isError ? '#f85149' : '#7ee787', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                {tool.output}
              </pre>
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} style={{ padding: '16px 20px', borderTop: '1px solid #222', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={isStreaming}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid #333',
              background: '#111',
              color: '#ededed',
              fontSize: 14,
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: isStreaming ? '#333' : '#4a9eff',
              color: '#fff',
              fontSize: 14,
              cursor: isStreaming ? 'not-allowed' : 'pointer',
            }}
          >
            {isStreaming ? '...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Create redirect page**

```tsx
// apps/web/src/app/page.tsx

import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/chat')
}
```

- [ ] **Step 3: Run npm install and verify dev server starts**

Run: `cd /home/wjj/Project/multi-agent-system/multi-agent-system && npm install && cd apps/web && npx next dev --turbopack`
Expected: Dev server starts on http://localhost:3000, navigates to /chat

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/chat/ apps/web/src/app/page.tsx
git commit -m "feat(web): add chat UI with SSE streaming"
```

---

### Task 9: Integration Test — Manual Smoke Test

- [ ] **Step 1: Ensure .env is configured**

Run: `cp .env.example .env` and set a valid `ANTHROPIC_API_KEY`

- [ ] **Step 2: Start the dev server**

Run: `cd apps/web && npx next dev --turbopack`

- [ ] **Step 3: Open http://localhost:3000 in browser**

Expected:
1. Redirects to /chat
2. Chat interface appears with dark theme
3. Type "what is 2+2?" → agent responds with text (streaming)
4. Type "run `ls -la`" → agent calls BashTool, shows tool execution, then responds with summary
5. Conversation persists in SQLite (data.db file appears)

---

## Execution Notes

- The chat API route in Task 7 uses inline SQL for table creation as a simple bootstrap. This will be replaced with proper Drizzle migrations when the schema stabilizes.
- The `ensureDefaults()` function auto-creates a default agent + session on first request so there's zero setup needed.
- All workspace packages use `src/index.ts` as entry points with TypeScript source directly (no build step needed for dev — Next.js handles transpilation).
