# B2 Observer 调试面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an observability panel that captures every LLM call made during agent runs, exposes both a live inline drawer in the chat page and a standalone `/observer` replay page, with an env-toggled capture layer and per-session cascade delete.

**Architecture:** Add a sidecar `@mas/observer` package containing a pluggable `Observer` interface (noop + DB-backed implementations). Extend `runAgent` with an optional `observer` parameter — when absent, zero overhead. The `/api/chat` route creates a DB observer per user message when `OBSERVER_ENABLED=1`, forwarding events to the SSE stream for real-time UI. A new `llm_calls` table stores full request/response snapshots. The frontend gets two entry points: a right-hand drawer inside `/chat` (push SSE events) and a dedicated `/observer` page (queries history).

**Tech Stack:** TypeScript, Next.js 15 App Router, drizzle-orm, better-sqlite3, React.

**Spec:** `docs/superpowers/specs/2026-04-14-b2-observer-panel.md`

---

## File Structure

Created:
- `packages/db/src/repository/llm-calls.ts` — repository for the new table
- `packages/observer/package.json`
- `packages/observer/tsconfig.json`
- `packages/observer/src/index.ts`
- `packages/observer/src/types.ts` — Observer interface
- `packages/observer/src/noop-observer.ts`
- `packages/observer/src/db-observer.ts`
- `apps/web/src/app/api/observer/sessions/[id]/route.ts`
- `apps/web/src/app/api/observer/calls/[callId]/route.ts`
- `apps/web/src/app/api/observer/all/route.ts`
- `apps/web/src/app/chat/ObserverDrawer.tsx`
- `apps/web/src/app/observer/page.tsx`
- `apps/web/src/app/observer/SessionsList.tsx`
- `apps/web/src/app/observer/TurnTree.tsx`
- `apps/web/src/app/observer/DetailPane.tsx`

Modified:
- `packages/db/src/schema.ts` — add `llmCalls` table
- `packages/db/src/index.ts` — export `llmCallsRepo`
- `packages/core/src/provider/types.ts` — (nothing; read only)
- `packages/core/src/agent/types.ts` — re-export `Observer` type
- `packages/core/src/agent/runner.ts` — accept observer arg, call hooks
- `packages/core/src/index.ts` — re-export Observer types
- `apps/web/src/lib/db-init.ts` — add `llm_calls` CREATE TABLE
- `apps/web/src/app/api/chat/route.ts` — construct observer, emit SSE events
- `apps/web/src/app/api/sessions/[id]/route.ts` — cascade delete llm_calls
- `apps/web/src/app/chat/ChatArea.tsx` — 🔍 toggle + handle new SSE events
- `apps/web/package.json` — depend on `@mas/observer`
- `multi-agent-system/package.json` — (npm workspaces already globs `packages/*`, no change needed; verify)
- `STATUS.md` — note Observer feature available

---

## Task 1: DB schema + llm_calls repository

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repository/llm-calls.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/web/src/lib/db-init.ts`

- [ ] **Step 1: Add `llmCalls` table to schema**

Modify `packages/db/src/schema.ts` — append after `toolExecutions`:

```ts
export const llmCalls = sqliteTable('llm_calls', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  userMessageId: text('user_message_id')
    .notNull()
    .references(() => messages.id),
  turnIndex: integer('turn_index').notNull(),
  model: text('model').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  toolsJson: text('tools_json').notNull(),
  messagesJson: text('messages_json').notNull(),
  responseJson: text('response_json'),
  stopReason: text('stop_reason'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  error: text('error'),
})
```

- [ ] **Step 2: Create `llm-calls` repository**

Create `packages/db/src/repository/llm-calls.ts`:

```ts
import { eq, and, asc, desc } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { getDb } from '../client'
import { llmCalls, messages } from '../schema'

export interface StartCallInput {
  sessionId: string
  userMessageId: string
  turnIndex: number
  model: string
  systemPrompt: string
  toolsJson: string
  messagesJson: string
}

export interface FinishCallInput {
  responseJson: string
  stopReason: string
  inputTokens: number
  outputTokens: number
  error?: string
}

export function startCall(input: StartCallInput): string {
  const db = getDb()
  const id = randomUUID()
  db.insert(llmCalls)
    .values({ id, ...input, startedAt: Date.now() })
    .run()
  return id
}

export function finishCall(id: string, input: FinishCallInput): void {
  const db = getDb()
  db.update(llmCalls)
    .set({ ...input, finishedAt: Date.now() })
    .where(eq(llmCalls.id, id))
    .run()
}

export function listCallsBySession(sessionId: string) {
  const db = getDb()
  return db
    .select()
    .from(llmCalls)
    .where(eq(llmCalls.sessionId, sessionId))
    .orderBy(asc(llmCalls.startedAt))
    .all()
}

export function getCall(id: string) {
  const db = getDb()
  return db.select().from(llmCalls).where(eq(llmCalls.id, id)).get()
}

export function clearAllCalls(): void {
  const db = getDb()
  db.delete(llmCalls).run()
}

export function deleteCallsBySession(sessionId: string): void {
  const db = getDb()
  db.delete(llmCalls).where(eq(llmCalls.sessionId, sessionId)).run()
}

export interface TurnNode {
  userMessageId: string
  userText: string
  createdAt: number
  calls: Array<{
    id: string
    turnIndex: number
    stopReason: string | null
    startedAt: number
    finishedAt: number | null
  }>
}

export function getSessionTurnTree(sessionId: string): TurnNode[] {
  const db = getDb()
  const userMsgs = db
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
    .orderBy(asc(messages.createdAt))
    .all()

  const allCalls = db
    .select()
    .from(llmCalls)
    .where(eq(llmCalls.sessionId, sessionId))
    .orderBy(asc(llmCalls.startedAt))
    .all()

  return userMsgs.map((m) => {
    let userText = m.content
    try {
      const blocks = JSON.parse(m.content) as Array<{ type: string; text?: string }>
      userText = blocks
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('')
    } catch {
      // fall back to raw content
    }
    const calls = allCalls
      .filter((c) => c.userMessageId === m.id)
      .map((c) => ({
        id: c.id,
        turnIndex: c.turnIndex,
        stopReason: c.stopReason,
        startedAt: c.startedAt,
        finishedAt: c.finishedAt,
      }))
    return {
      userMessageId: m.id,
      userText,
      createdAt: (m.createdAt as unknown as Date).getTime?.() ?? (m.createdAt as unknown as number),
      calls,
    }
  })
}
```

- [ ] **Step 3: Export `llmCallsRepo` from db package**

Modify `packages/db/src/index.ts` — add line:

```ts
export * as llmCallsRepo from './repository/llm-calls'
```

- [ ] **Step 4: Add `llm_calls` bootstrap DDL to db-init**

Modify `apps/web/src/lib/db-init.ts` — inside `sqlite.exec(\`...\`)` append after the `tool_executions` table:

```sql
CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  user_message_id TEXT NOT NULL REFERENCES messages(id),
  turn_index INTEGER NOT NULL,
  model TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  response_json TEXT,
  stop_reason TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_session ON llm_calls(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_user_msg ON llm_calls(user_message_id, turn_index);
```

- [ ] **Step 5: Verify typecheck**

Run: `cd apps/web && npx next build`
Expected: `✓ Compiled successfully`

- [ ] **Step 6: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add packages/db/src/schema.ts packages/db/src/repository/llm-calls.ts packages/db/src/index.ts apps/web/src/lib/db-init.ts
git commit -m "feat(db): add llm_calls table + repository

Task 1 of B2 Observer plan.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: `@mas/observer` package

**Files:**
- Create: `packages/observer/package.json`
- Create: `packages/observer/tsconfig.json`
- Create: `packages/observer/src/index.ts`
- Create: `packages/observer/src/types.ts`
- Create: `packages/observer/src/noop-observer.ts`
- Create: `packages/observer/src/db-observer.ts`

- [ ] **Step 1: Create package manifest**

Create `packages/observer/package.json`:

```json
{
  "name": "@mas/observer",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mas/db": "*",
    "@mas/core": "*"
  }
}
```

- [ ] **Step 2: Create tsconfig**

Create `packages/observer/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Define `Observer` interface**

Create `packages/observer/src/types.ts`:

```ts
import type { Message, ToolDefinition, ContentBlock, LLMResponse } from '@mas/core'

export interface LLMCallStartPayload {
  model: string
  systemPrompt: string
  tools: ToolDefinition[]
  messages: Message[]
}

export interface LLMCallEndPayload {
  response: ContentBlock[]
  stopReason: LLMResponse['stopReason']
  usage: { inputTokens: number; outputTokens: number }
  error?: string
}

export interface Observer {
  onLLMCallStart(payload: LLMCallStartPayload): string
  onLLMCallEnd(callId: string, payload: LLMCallEndPayload): void
}

export interface ObserverEvent {
  type: 'llm_call_start' | 'llm_call_end'
  callId: string
  turnIndex?: number
  payload: LLMCallStartPayload | LLMCallEndPayload
}

export type ObserverEventSink = (event: ObserverEvent) => void
```

- [ ] **Step 4: Noop observer**

Create `packages/observer/src/noop-observer.ts`:

```ts
import type { Observer } from './types'

export function createNoopObserver(): Observer {
  return {
    onLLMCallStart: () => '',
    onLLMCallEnd: () => {},
  }
}
```

- [ ] **Step 5: DB observer**

Create `packages/observer/src/db-observer.ts`:

```ts
import { llmCallsRepo } from '@mas/db'
import type { Observer, ObserverEventSink } from './types'

export interface DbObserverOptions {
  sessionId: string
  userMessageId: string
  model: string
  onEvent?: ObserverEventSink
}

export function createDbObserver(opts: DbObserverOptions): Observer {
  let turnIndex = 0

  return {
    onLLMCallStart(payload) {
      const currentTurn = turnIndex++
      const callId = llmCallsRepo.startCall({
        sessionId: opts.sessionId,
        userMessageId: opts.userMessageId,
        turnIndex: currentTurn,
        model: payload.model,
        systemPrompt: payload.systemPrompt,
        toolsJson: JSON.stringify(payload.tools),
        messagesJson: JSON.stringify(payload.messages),
      })
      opts.onEvent?.({
        type: 'llm_call_start',
        callId,
        turnIndex: currentTurn,
        payload,
      })
      return callId
    },

    onLLMCallEnd(callId, payload) {
      llmCallsRepo.finishCall(callId, {
        responseJson: JSON.stringify(payload.response),
        stopReason: payload.stopReason,
        inputTokens: payload.usage.inputTokens,
        outputTokens: payload.usage.outputTokens,
        error: payload.error,
      })
      opts.onEvent?.({
        type: 'llm_call_end',
        callId,
        payload,
      })
    },
  }
}
```

- [ ] **Step 6: Package index**

Create `packages/observer/src/index.ts`:

```ts
export type {
  Observer,
  LLMCallStartPayload,
  LLMCallEndPayload,
  ObserverEvent,
  ObserverEventSink,
} from './types'
export { createNoopObserver } from './noop-observer'
export { createDbObserver } from './db-observer'
```

- [ ] **Step 7: Install workspace + typecheck**

Run:
```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
npm install
cd packages/observer && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add packages/observer/ package-lock.json
git commit -m "feat(observer): new @mas/observer package with noop + db observers

Task 2 of B2 Observer plan.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `runAgent` observer hook

**Files:**
- Modify: `packages/core/src/agent/runner.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add Observer type to core (local copy, no deps)**

Modify `packages/core/src/agent/runner.ts` — replace whole file:

```ts
import type { AgentConfig, AgentEvent } from './types'
import type { LLMProvider, LLMResponse } from '../provider/types'
import type { Message, ContentBlock, ToolDefinition, ToolUseBlock } from '../types'
import { toolsToDefinitions, executeTool } from '../tools/registry'

export interface RunAgentObserver {
  onLLMCallStart(payload: {
    model: string
    systemPrompt: string
    tools: ToolDefinition[]
    messages: Message[]
  }): string

  onLLMCallEnd(callId: string, payload: {
    response: ContentBlock[]
    stopReason: LLMResponse['stopReason']
    usage: { inputTokens: number; outputTokens: number }
    error?: string
  }): void
}

export async function* runAgent(
  config: AgentConfig,
  messages: Message[],
  provider: LLMProvider,
  observer?: RunAgentObserver,
): AsyncGenerator<AgentEvent> {
  const maxTurns = config.maxTurns ?? 20
  let turns = 0

  while (true) {
    if (++turns > maxTurns) {
      yield { type: 'error', error: new Error(`Max turns (${maxTurns}) exceeded`) }
      return
    }

    const toolDefs = toolsToDefinitions(config.tools)

    const callId = observer?.onLLMCallStart({
      model: config.model,
      systemPrompt: config.systemPrompt,
      tools: toolDefs,
      messages: [...messages],
    })

    let response: LLMResponse | undefined

    try {
      for await (const event of provider.streamMessage({
        model: config.model,
        systemPrompt: config.systemPrompt,
        messages,
        tools: toolDefs,
      })) {
        if (event.type === 'text_delta') {
          yield { type: 'text_delta', text: event.text }
        } else if (event.type === 'message_complete') {
          response = event.response
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (callId !== undefined && observer) {
        observer.onLLMCallEnd(callId, {
          response: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
          error: error.message,
        })
      }
      yield { type: 'error', error }
      return
    }

    if (!response) {
      const error = new Error('No response from LLM')
      if (callId !== undefined && observer) {
        observer.onLLMCallEnd(callId, {
          response: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
          error: error.message,
        })
      }
      yield { type: 'error', error }
      return
    }

    if (callId !== undefined && observer) {
      observer.onLLMCallEnd(callId, {
        response: response.content,
        stopReason: response.stopReason,
        usage: response.usage,
      })
    }

    messages.push({ role: 'assistant', content: response.content })

    if (response.stopReason !== 'tool_use') {
      yield { type: 'complete', response }
      return
    }

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

    messages.push({ role: 'user', content: toolResults })
  }
}
```

- [ ] **Step 2: Export `RunAgentObserver` from core index**

Modify `packages/core/src/index.ts` — add after the existing exports:

```ts
export type { RunAgentObserver } from './agent/runner'
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add packages/core/src/agent/runner.ts packages/core/src/index.ts
git commit -m "feat(core): runAgent observer hook

Task 3 of B2 Observer plan.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Wire observer into `/api/chat` + cascade delete

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/app/api/chat/route.ts`
- Modify: `apps/web/src/app/api/sessions/[id]/route.ts`

- [ ] **Step 1: Depend on `@mas/observer`**

Modify `apps/web/package.json` dependencies — add:

```json
"@mas/observer": "*",
```

Then run:
```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
npm install
```

- [ ] **Step 2: Rewrite `/api/chat` route with observer**

Overwrite `apps/web/src/app/api/chat/route.ts`:

```ts
import { runAgent, AnthropicProvider, BashTool } from '@mas/core'
import type { AgentConfig, Message } from '@mas/core'
import { messageRepo } from '@mas/db'
import { createDbObserver, createNoopObserver } from '@mas/observer'
import { initDb } from '@/lib/db-init'

export async function POST(request: Request) {
  initDb()
  const body = await request.json()
  const userMessage = body.message as string
  const sessionId = body.sessionId as string

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const userMessageId = messageRepo.addMessage({
    sessionId,
    role: 'user',
    content: JSON.stringify([{ type: 'text', text: userMessage }]),
  })

  const dbMessages = messageRepo.getSessionMessages(sessionId)
  const messages: Message[] = dbMessages.map((m) => ({
    role: m.role as Message['role'],
    content: JSON.parse(m.content),
  }))

  const provider = new AnthropicProvider()
  const config: AgentConfig = {
    id: 'default',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'You are a helpful AI assistant. You can execute bash commands to help the user. Be concise.',
    tools: [BashTool],
    maxTurns: 10,
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const push = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      const observer =
        process.env.OBSERVER_ENABLED === '1'
          ? createDbObserver({
              sessionId,
              userMessageId,
              model: config.model,
              onEvent: (event) => push(event),
            })
          : createNoopObserver()

      try {
        for await (const event of runAgent(config, messages, provider, observer)) {
          if (event.type === 'error') {
            console.error('[agent error]', event.error)
          }
          const serializable =
            event.type === 'error'
              ? { type: 'error', error: event.error.message || String(event.error) }
              : event
          push(serializable)

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
        push({
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
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

- [ ] **Step 3: Cascade delete in sessions route**

Overwrite `apps/web/src/app/api/sessions/[id]/route.ts`:

```ts
import { sessionRepo, messageRepo, llmCallsRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  llmCallsRepo.deleteCallsBySession(id)
  messageRepo.deleteSessionMessages(id)
  sessionRepo.deleteSession(id)
  return Response.json({ ok: true })
}
```

- [ ] **Step 4: Verify build**

Run: `cd apps/web && npx next build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Smoke test without observer enabled**

Start dev server: `cd apps/web && npx next dev --turbopack` (background).
Run:
```bash
SID=$(curl -s -X POST http://localhost:3000/api/sessions -H 'Content-Type: application/json' -d '{"title":"noop-test"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["session"]["id"])')
curl -s -N -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d "{\"sessionId\":\"$SID\",\"message\":\"say hi\"}" | head -30
sqlite3 data.db "SELECT COUNT(*) FROM llm_calls WHERE session_id='$SID';"
```
Expected: final sqlite count = `0` (observer disabled).
Kill dev server.

- [ ] **Step 6: Smoke test with observer enabled**

Start dev server with env:
```bash
cd apps/web && OBSERVER_ENABLED=1 npx next dev --turbopack
```
Run:
```bash
SID=$(curl -s -X POST http://localhost:3000/api/sessions -H 'Content-Type: application/json' -d '{"title":"observer-test"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["session"]["id"])')
curl -s -N -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d "{\"sessionId\":\"$SID\",\"message\":\"say hi\"}" | grep -E 'llm_call' | head -4
sqlite3 data.db "SELECT COUNT(*), MAX(turn_index) FROM llm_calls WHERE session_id='$SID';"
```
Expected: SSE lines containing `llm_call_start` and `llm_call_end`; sqlite count ≥ 1.
Kill dev server.

- [ ] **Step 7: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add apps/web/package.json package-lock.json apps/web/src/app/api/chat/route.ts apps/web/src/app/api/sessions/\[id\]/route.ts
git commit -m "feat(api): wire observer into chat route + cascade delete

Task 4 of B2 Observer plan.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: `/api/observer/*` endpoints

**Files:**
- Create: `apps/web/src/app/api/observer/sessions/[id]/route.ts`
- Create: `apps/web/src/app/api/observer/calls/[callId]/route.ts`
- Create: `apps/web/src/app/api/observer/all/route.ts`

- [ ] **Step 1: Session turn tree endpoint**

Create `apps/web/src/app/api/observer/sessions/[id]/route.ts`:

```ts
import { llmCallsRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  initDb()
  const { id } = await params
  const turns = llmCallsRepo.getSessionTurnTree(id)
  return Response.json({ turns })
}
```

- [ ] **Step 2: Single call detail endpoint**

Create `apps/web/src/app/api/observer/calls/[callId]/route.ts`:

```ts
import { llmCallsRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ callId: string }> }
) {
  initDb()
  const { callId } = await params
  const call = llmCallsRepo.getCall(callId)
  if (!call) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  return Response.json({
    ...call,
    tools: JSON.parse(call.toolsJson),
    messages: JSON.parse(call.messagesJson),
    response: call.responseJson ? JSON.parse(call.responseJson) : null,
  })
}
```

- [ ] **Step 3: Clear-all endpoint**

Create `apps/web/src/app/api/observer/all/route.ts`:

```ts
import { llmCallsRepo } from '@mas/db'
import { initDb } from '@/lib/db-init'

export async function DELETE() {
  initDb()
  llmCallsRepo.clearAllCalls()
  return Response.json({ ok: true })
}
```

- [ ] **Step 4: Smoke test**

Start: `cd apps/web && OBSERVER_ENABLED=1 npx next dev --turbopack` (background).
Run (reuses prior observer-test session from Task 4 Step 6, or create a new one and chat first):
```bash
# Use any sessionId that has observations.
SID=$(sqlite3 data.db "SELECT session_id FROM llm_calls LIMIT 1;")
curl -s http://localhost:3000/api/observer/sessions/$SID | python3 -m json.tool | head -30
CID=$(sqlite3 data.db "SELECT id FROM llm_calls LIMIT 1;")
curl -s http://localhost:3000/api/observer/calls/$CID | python3 -m json.tool | head -20
curl -s -X DELETE http://localhost:3000/api/observer/all
sqlite3 data.db "SELECT COUNT(*) FROM llm_calls;"
```
Expected: tree JSON has at least one `turns[]` entry with nested `calls[]`; detail JSON has parsed `tools`/`messages`/`response` fields; final count = `0`.
Kill dev server.

- [ ] **Step 5: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add apps/web/src/app/api/observer/
git commit -m "feat(api): observer query + clear endpoints

Task 5 of B2 Observer plan.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Inline observer drawer in `/chat`

**Files:**
- Create: `apps/web/src/app/chat/ObserverDrawer.tsx`
- Modify: `apps/web/src/app/chat/ChatArea.tsx`

- [ ] **Step 1: Create ObserverDrawer component**

Create `apps/web/src/app/chat/ObserverDrawer.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

export interface LiveCall {
  callId: string
  turnIndex: number
  model: string
  systemPrompt: string
  tools: unknown[]
  messages: unknown[]
  response?: unknown
  stopReason?: string
  usage?: { inputTokens: number; outputTokens: number }
  error?: string
  finished: boolean
}

interface Props {
  calls: LiveCall[]
}

type Tab = 'system' | 'tools' | 'messages' | 'response'

export function ObserverDrawer({ calls }: Props) {
  const [activeCallId, setActiveCallId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('messages')

  useEffect(() => {
    if (!activeCallId && calls.length > 0) {
      setActiveCallId(calls[calls.length - 1].callId)
    }
  }, [calls, activeCallId])

  const active = calls.find((c) => c.callId === activeCallId) ?? calls[calls.length - 1]

  return (
    <div
      style={{
        width: 420,
        borderLeft: '1px solid #222',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: '#0b0b12',
      }}
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #222', fontSize: 13 }}>
        <strong style={{ color: '#ededed' }}>Observer</strong>{' '}
        <span style={{ color: '#666' }}>
          {calls.length === 0 ? 'waiting for next turn…' : `${calls.length} LLM call(s)`}
        </span>
      </div>

      {calls.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '8px 10px',
            borderBottom: '1px solid #222',
            overflowX: 'auto',
          }}
        >
          {calls.map((c) => (
            <button
              key={c.callId}
              onClick={() => setActiveCallId(c.callId)}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                border: '1px solid #333',
                background: c.callId === activeCallId ? '#1a1a2e' : 'transparent',
                color: c.finished ? '#ededed' : '#f0883e',
                fontSize: 12,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              #{c.turnIndex} {c.finished ? '✓' : '…'}
            </button>
          ))}
        </div>
      )}

      {active && (
        <>
          <div
            style={{
              display: 'flex',
              gap: 2,
              padding: '6px 10px',
              borderBottom: '1px solid #222',
              fontSize: 12,
            }}
          >
            {(['system', 'tools', 'messages', 'response'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: 'none',
                  background: tab === t ? '#1a1a2e' : 'transparent',
                  color: tab === t ? '#ededed' : '#888',
                  cursor: 'pointer',
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 12,
              fontSize: 12,
              fontFamily: 'ui-monospace, monospace',
              whiteSpace: 'pre-wrap',
              color: '#cdd9e5',
            }}
          >
            {tab === 'system' && active.systemPrompt}
            {tab === 'tools' && JSON.stringify(active.tools, null, 2)}
            {tab === 'messages' && JSON.stringify(active.messages, null, 2)}
            {tab === 'response' &&
              (active.response
                ? JSON.stringify(
                    {
                      stopReason: active.stopReason,
                      usage: active.usage,
                      response: active.response,
                      error: active.error,
                    },
                    null,
                    2,
                  )
                : active.error
                  ? `Error: ${active.error}`
                  : '(pending)')}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Integrate drawer + SSE events in ChatArea**

Overwrite `apps/web/src/app/chat/ChatArea.tsx`:

```tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { ObserverDrawer, type LiveCall } from './ObserverDrawer'

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

interface DbMessage {
  role: string
  content: string
}

function renderDbMessage(m: DbMessage): ChatMessage | null {
  if (m.role !== 'user' && m.role !== 'assistant') return null
  try {
    const blocks = JSON.parse(m.content) as Array<{ type: string; text?: string }>
    const text = blocks
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('')
    return { role: m.role, content: text }
  } catch {
    return { role: m.role as 'user' | 'assistant', content: m.content }
  }
}

interface Props {
  sessionId: string
  onFirstMessage?: () => void
}

export function ChatArea({ sessionId, onFirstMessage }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentTools, setCurrentTools] = useState<ToolExecution[]>([])
  const [observerOpen, setObserverOpen] = useState(false)
  const [liveCalls, setLiveCalls] = useState<LiveCall[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setMessages([])
    setCurrentTools([])
    setLiveCalls([])
    fetch(`/api/sessions/${sessionId}/messages`)
      .then((r) => r.json())
      .then((data: { messages: DbMessage[] }) => {
        if (cancelled) return
        const rendered = data.messages
          .map(renderDbMessage)
          .filter((m): m is ChatMessage => m !== null)
        setMessages(rendered)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentTools])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isStreaming) return

    const userMessage = input.trim()
    const isFirst = messages.length === 0
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsStreaming(true)
    setCurrentTools([])
    setLiveCalls([])

    let assistantText = ''

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, sessionId }),
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
                assistantText = ''
                break

              case 'error':
                setMessages((prev) => [
                  ...prev,
                  { role: 'assistant', content: `Error: ${event.error}` },
                ])
                break

              case 'llm_call_start':
                setLiveCalls((prev) => [
                  ...prev,
                  {
                    callId: event.callId,
                    turnIndex: event.turnIndex,
                    model: event.payload.model,
                    systemPrompt: event.payload.systemPrompt,
                    tools: event.payload.tools,
                    messages: event.payload.messages,
                    finished: false,
                  },
                ])
                break

              case 'llm_call_end':
                setLiveCalls((prev) =>
                  prev.map((c) =>
                    c.callId === event.callId
                      ? {
                          ...c,
                          response: event.payload.response,
                          stopReason: event.payload.stopReason,
                          usage: event.payload.usage,
                          error: event.payload.error,
                          finished: true,
                        }
                      : c,
                  ),
                )
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
      if (isFirst) onFirstMessage?.()
    }
  }

  return (
    <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <header
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #222',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Multi-Agent System</h1>
          <button
            onClick={() => setObserverOpen((v) => !v)}
            style={{
              background: observerOpen ? '#1a1a2e' : 'transparent',
              border: '1px solid #333',
              borderRadius: 6,
              padding: '4px 10px',
              color: '#ededed',
              cursor: 'pointer',
              fontSize: 14,
            }}
            title="Toggle observer panel"
          >
            🔍
          </button>
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
                <pre
                  style={{
                    color: tool.isError ? '#f85149' : '#7ee787',
                    marginTop: 4,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {tool.output}
                </pre>
              )}
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ padding: '16px 20px', borderTop: '1px solid #222', flexShrink: 0 }}
        >
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

      {observerOpen && <ObserverDrawer calls={liveCalls} />}
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `cd apps/web && npx next build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Manual browser smoke test**

Start: `cd apps/web && OBSERVER_ENABLED=1 npx next dev --turbopack`.
Open http://localhost:3000/chat. Send a message like "ls in current directory". Click 🔍.
Expected: drawer opens on the right; at least one call button `#0 ✓` visible; clicking tabs `system` / `tools` / `messages` / `response` shows JSON content. If `bash` tool fired, turn-index `#1` should appear too.
Kill dev server.

- [ ] **Step 5: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add apps/web/src/app/chat/ObserverDrawer.tsx apps/web/src/app/chat/ChatArea.tsx
git commit -m "feat(web): inline observer drawer in chat page

Task 6 of B2 Observer plan.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Standalone `/observer` page

**Files:**
- Create: `apps/web/src/app/observer/page.tsx`
- Create: `apps/web/src/app/observer/SessionsList.tsx`
- Create: `apps/web/src/app/observer/TurnTree.tsx`
- Create: `apps/web/src/app/observer/DetailPane.tsx`

- [ ] **Step 1: SessionsList component**

Create `apps/web/src/app/observer/SessionsList.tsx`:

```tsx
'use client'

interface Session {
  id: string
  title: string | null
  updatedAt: number
}

interface Props {
  sessions: Session[]
  currentId: string | null
  onSelect: (id: string) => void
  onClearAll: () => void
}

export function SessionsList({ sessions, currentId, onSelect, onClearAll }: Props) {
  return (
    <div
      style={{
        width: 260,
        borderRight: '1px solid #222',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #222' }}>
        <strong style={{ color: '#ededed', fontSize: 14 }}>Sessions</strong>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {sessions.map((s) => {
          const active = s.id === currentId
          return (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                marginBottom: 2,
                background: active ? '#1a1a2e' : 'transparent',
                cursor: 'pointer',
                color: active ? '#ededed' : '#bbb',
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {s.title || 'Untitled'}
            </div>
          )
        })}
      </div>
      <div style={{ padding: 10, borderTop: '1px solid #222' }}>
        <button
          onClick={() => {
            if (confirm('Delete ALL observer data? This cannot be undone.')) onClearAll()
          }}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid #5a2d2d',
            background: '#2d1a1a',
            color: '#f85149',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          🗑 Clear all observer data
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TurnTree component**

Create `apps/web/src/app/observer/TurnTree.tsx`:

```tsx
'use client'

export interface TurnNode {
  userMessageId: string
  userText: string
  createdAt: number
  calls: Array<{
    id: string
    turnIndex: number
    stopReason: string | null
    startedAt: number
    finishedAt: number | null
  }>
}

interface Props {
  turns: TurnNode[]
  currentCallId: string | null
  onSelectCall: (id: string) => void
}

export function TurnTree({ turns, currentCallId, onSelectCall }: Props) {
  return (
    <div
      style={{
        width: 320,
        borderRight: '1px solid #222',
        overflowY: 'auto',
        padding: 8,
        flexShrink: 0,
      }}
    >
      {turns.length === 0 && (
        <p style={{ color: '#666', textAlign: 'center', marginTop: 40, fontSize: 13 }}>
          No observer data for this session.
        </p>
      )}
      {turns.map((turn) => (
        <div key={turn.userMessageId} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 12,
              color: '#888',
              padding: '4px 8px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={turn.userText}
          >
            User: {turn.userText || '(empty)'}
          </div>
          {turn.calls.map((c) => {
            const active = c.id === currentCallId
            return (
              <div
                key={c.id}
                onClick={() => onSelectCall(c.id)}
                style={{
                  padding: '6px 10px 6px 20px',
                  borderRadius: 4,
                  marginTop: 2,
                  background: active ? '#1a1a2e' : 'transparent',
                  color: active ? '#ededed' : '#bbb',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                └ call #{c.turnIndex}{' '}
                <span style={{ color: '#666' }}>
                  {c.stopReason ?? (c.finishedAt ? '?' : '…')}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: DetailPane component**

Create `apps/web/src/app/observer/DetailPane.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

interface CallDetail {
  id: string
  model: string
  systemPrompt: string
  tools: unknown
  messages: unknown
  response: unknown
  stopReason: string | null
  inputTokens: number | null
  outputTokens: number | null
  error: string | null
}

interface Props {
  callId: string | null
}

type Tab = 'system' | 'tools' | 'messages' | 'response'

export function DetailPane({ callId }: Props) {
  const [detail, setDetail] = useState<CallDetail | null>(null)
  const [tab, setTab] = useState<Tab>('messages')

  useEffect(() => {
    if (!callId) {
      setDetail(null)
      return
    }
    let cancelled = false
    fetch(`/api/observer/calls/${callId}`)
      .then((r) => r.json())
      .then((data: CallDetail) => {
        if (!cancelled) setDetail(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [callId])

  if (!callId) {
    return (
      <div style={{ flex: 1, padding: 40, color: '#666', fontSize: 13 }}>
        Select a call to see its details.
      </div>
    )
  }
  if (!detail) {
    return <div style={{ flex: 1, padding: 40, color: '#666' }}>Loading…</div>
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #222', fontSize: 12, color: '#888' }}>
        {detail.model} · in {detail.inputTokens ?? '?'} / out {detail.outputTokens ?? '?'} tokens · {detail.stopReason ?? 'pending'}
      </div>
      <div style={{ display: 'flex', gap: 2, padding: '6px 10px', borderBottom: '1px solid #222' }}>
        {(['system', 'tools', 'messages', 'response'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: 'none',
              background: tab === t ? '#1a1a2e' : 'transparent',
              color: tab === t ? '#ededed' : '#888',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 12,
          fontSize: 12,
          fontFamily: 'ui-monospace, monospace',
          whiteSpace: 'pre-wrap',
          color: '#cdd9e5',
        }}
      >
        {tab === 'system' && detail.systemPrompt}
        {tab === 'tools' && JSON.stringify(detail.tools, null, 2)}
        {tab === 'messages' && JSON.stringify(detail.messages, null, 2)}
        {tab === 'response' &&
          JSON.stringify(
            { response: detail.response, error: detail.error },
            null,
            2,
          )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Observer page**

Create `apps/web/src/app/observer/page.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { SessionsList } from './SessionsList'
import { TurnTree, type TurnNode } from './TurnTree'
import { DetailPane } from './DetailPane'

interface Session {
  id: string
  title: string | null
  updatedAt: number
}

export default function ObserverPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [turns, setTurns] = useState<TurnNode[]>([])
  const [currentCallId, setCurrentCallId] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    const res = await fetch('/api/sessions')
    const data = (await res.json()) as { sessions: Session[] }
    setSessions(data.sessions)
    if (!currentSessionId && data.sessions.length > 0) {
      setCurrentSessionId(data.sessions[0].id)
    }
  }, [currentSessionId])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (!currentSessionId) return
    setCurrentCallId(null)
    fetch(`/api/observer/sessions/${currentSessionId}`)
      .then((r) => r.json())
      .then((data: { turns: TurnNode[] }) => setTurns(data.turns))
      .catch(() => setTurns([]))
  }, [currentSessionId])

  async function handleClearAll() {
    await fetch('/api/observer/all', { method: 'DELETE' })
    setTurns([])
    setCurrentCallId(null)
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <SessionsList
        sessions={sessions}
        currentId={currentSessionId}
        onSelect={setCurrentSessionId}
        onClearAll={handleClearAll}
      />
      <TurnTree turns={turns} currentCallId={currentCallId} onSelectCall={setCurrentCallId} />
      <DetailPane callId={currentCallId} />
    </div>
  )
}
```

- [ ] **Step 5: Verify build**

Run: `cd apps/web && npx next build`
Expected: `✓ Compiled successfully`; routes listing should include `/observer`.

- [ ] **Step 6: Manual browser smoke test**

Start: `cd apps/web && OBSERVER_ENABLED=1 npx next dev --turbopack`.
Open http://localhost:3000/chat, send a couple of messages (at least one with a bash tool call, e.g. "ls"). Then open http://localhost:3000/observer.
Expected: sessions in left rail, turn tree in middle with `User: …` + `└ call #0 end_turn/tool_use`, right pane shows JSON when a call is clicked. Click 🗑 Clear all → confirm → middle and right panes clear.
Kill dev server.

- [ ] **Step 7: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add apps/web/src/app/observer/
git commit -m "feat(web): /observer standalone replay page

Task 7 of B2 Observer plan.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Final verification + STATUS.md

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Full E2E sweep**

Start with observer off: `cd apps/web && npx next dev --turbopack` → send a message at `/chat` → verify `llm_calls` remains empty (`sqlite3 data.db "SELECT COUNT(*) FROM llm_calls;"` = 0). Kill server.

Start with observer on: `cd apps/web && OBSERVER_ENABLED=1 npx next dev --turbopack` → at `/chat` click 🔍 → send "list files in /tmp" → watch drawer populate live with at least two calls (pre-tool + post-tool) → open `/observer` → verify the same session shows the call tree → clear-all → confirm empty. Kill server.

- [ ] **Step 2: Update STATUS.md**

Modify `STATUS.md`:

Replace the date line with `最后更新：2026-04-14`.

In the "你现在能做的事" list, append:

```markdown
- **开启 `OBSERVER_ENABLED=1` 后可观测 AI 每轮内部**：聊天页 🔍 抽屉实时看完整 prompt / 工具 schema / LLM 响应；独立 `/observer` 页事后回放 + 清空
```

In the "🌐 网页入口" section bullets, append:

```markdown
- 新增 `/observer` 调试页（三栏：会话 / turn 树 / 详情），`/chat` 页加 🔍 按钮切换观测抽屉
- Observer API：`GET /api/observer/sessions/:id`、`GET /api/observer/calls/:callId`、`DELETE /api/observer/all`
```

In the "💾 数据存档"目前存了 list, append:

```markdown
- **LLM 调用快照** (`llm_calls`) —— 每次发给 LLM 的完整 prompt + tools + messages + response，env `OBSERVER_ENABLED=1` 启用
```

- [ ] **Step 3: Commit**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add STATUS.md
git commit -m "docs(status): mark B2 Observer panel done

Task 8 of B2 Observer plan.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 4: Mark B2 complete in roadmap**

Modify `DESIGN.md` and `docs/superpowers/specs/2026-04-03-multi-agent-system-design.md`: change `- [ ] **B2 Observer 调试面板**` to `- [x] **B2 Observer 调试面板**` in both files.

Commit:
```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system
git add DESIGN.md docs/superpowers/specs/2026-04-03-multi-agent-system-design.md
git commit -m "docs(roadmap): mark B2 Observer panel done

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
