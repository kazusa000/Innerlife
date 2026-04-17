# B1 多会话支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 左侧边栏显示会话列表，可新建/切换/删除会话，切换时加载历史消息。

**Architecture:** 后端加 3 个 API route（sessions CRUD、消息加载），前端把单栏布局改成侧边栏+聊天区。去掉 route.ts 里的 ensureDefaults 自动创建逻辑，由前端在没有会话时调 API 创建。

**Tech Stack:** Next.js App Router API Routes, Drizzle ORM, React state

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `packages/db/src/repository/sessions.ts` | 修改 | 加 listAllSessions、deleteSession |
| `packages/db/src/repository/messages.ts` | 修改 | 加 deleteSessionMessages |
| `apps/web/src/app/api/sessions/route.ts` | 新建 | GET（列出会话）+ POST（创建会话） |
| `apps/web/src/app/api/sessions/[id]/route.ts` | 新建 | DELETE（删除会话） |
| `apps/web/src/app/api/sessions/[id]/messages/route.ts` | 新建 | GET（加载会话历史消息） |
| `apps/web/src/app/api/chat/route.ts` | 修改 | 去掉 ensureDefaults，要求前端传 sessionId |
| `apps/web/src/app/chat/page.tsx` | 重写 | 侧边栏+聊天区布局 |

---

### Task 1: DB repository 扩展

**Files:**
- Modify: `packages/db/src/repository/sessions.ts`
- Modify: `packages/db/src/repository/messages.ts`

- [ ] **Step 1: 给 sessions.ts 加 listAllSessions 和 deleteSession**

```typescript
// 在 sessions.ts 末尾追加

import { desc } from 'drizzle-orm'

export function listAllSessions() {
  const db = getDb()
  return db.select().from(sessions).orderBy(desc(sessions.updatedAt)).all()
}

export function deleteSession(id: string) {
  const db = getDb()
  db.delete(sessions).where(eq(sessions.id, id)).run()
}
```

注意：需要在文件顶部的 import 里加上 `desc`：

```typescript
import { eq, desc } from 'drizzle-orm'
```

- [ ] **Step 2: 给 messages.ts 加 deleteSessionMessages**

```typescript
// 在 messages.ts 末尾追加

export function deleteSessionMessages(sessionId: string) {
  const db = getDb()
  // 先删 toolExecutions（外键依赖 messages）
  const msgs = db.select({ id: messages.id }).from(messages).where(eq(messages.sessionId, sessionId)).all()
  for (const msg of msgs) {
    db.delete(toolExecutions).where(eq(toolExecutions.messageId, msg.id)).run()
  }
  db.delete(messages).where(eq(messages.sessionId, sessionId)).run()
}
```

- [ ] **Step 3: 验证编译通过**

Run: `cd /home/wjj/Project/multi-agent-system/multi-agent-system && npx tsc --noEmit -p packages/db/tsconfig.json`

如果 packages/db 没有独立 tsconfig，改用：
```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system/apps/web && npx next build
```
Expected: 无编译错误

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/repository/sessions.ts packages/db/src/repository/messages.ts
git commit -m "feat(db): add listAllSessions, deleteSession, deleteSessionMessages"
```

---

### Task 2: Sessions API routes

**Files:**
- Create: `apps/web/src/app/api/sessions/route.ts`
- Create: `apps/web/src/app/api/sessions/[id]/route.ts`
- Create: `apps/web/src/app/api/sessions/[id]/messages/route.ts`

- [ ] **Step 1: 创建 GET/POST /api/sessions**

创建 `apps/web/src/app/api/sessions/route.ts`：

```typescript
import path from 'node:path'
import { getDb, getRawSqlite, agentRepo, sessionRepo } from '@mas/db'

const DB_PATH = path.resolve(process.cwd(), '..', '..', 'data.db')

function ensureDb() {
  getDb(DB_PATH)
  // initDb 已在 chat/route.ts 里做过，这里只确保连接
}

export async function GET() {
  ensureDb()
  const sessions = sessionRepo.listAllSessions()
  return Response.json(sessions)
}

export async function POST(request: Request) {
  ensureDb()
  const body = await request.json()
  const title = (body.title as string) || 'New Chat'

  // 确保有默认 agent
  let agent = agentRepo.listAgents()[0]
  if (!agent) {
    agent = agentRepo.createAgent({
      name: 'Default Agent',
      description: 'A helpful AI assistant that can execute bash commands.',
      model: 'claude-sonnet-4-6',
    })
  }

  const session = sessionRepo.createSession(agent.id, title)
  return Response.json(session, { status: 201 })
}
```

- [ ] **Step 2: 创建 DELETE /api/sessions/[id]**

创建 `apps/web/src/app/api/sessions/[id]/route.ts`：

```typescript
import path from 'node:path'
import { getDb, sessionRepo, messageRepo } from '@mas/db'

const DB_PATH = path.resolve(process.cwd(), '..', '..', 'data.db')

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  getDb(DB_PATH)
  const { id } = await params
  messageRepo.deleteSessionMessages(id)
  sessionRepo.deleteSession(id)
  return new Response(null, { status: 204 })
}
```

- [ ] **Step 3: 创建 GET /api/sessions/[id]/messages**

创建 `apps/web/src/app/api/sessions/[id]/messages/route.ts`：

```typescript
import path from 'node:path'
import { getDb, messageRepo } from '@mas/db'

const DB_PATH = path.resolve(process.cwd(), '..', '..', 'data.db')

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  getDb(DB_PATH)
  const { id } = await params
  const messages = messageRepo.getSessionMessages(id)
  return Response.json(messages)
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/sessions/
git commit -m "feat(api): add sessions CRUD and message history endpoints"
```

---

### Task 3: 简化 chat/route.ts

**Files:**
- Modify: `apps/web/src/app/api/chat/route.ts`

- [ ] **Step 1: 去掉 ensureDefaults 和 defaultSessionId 逻辑**

把 `route.ts` 里的 `ensureDefaults()` 函数、`defaultSessionId` 变量、`getDefaultSessionId()` 函数全部删掉。

修改 POST handler，要求前端必须传 sessionId：

```typescript
export async function POST(request: Request) {
  const body = await request.json()
  const userMessage = body.message as string
  const sessionId = body.sessionId as string

  if (!sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 })
  }

  initDb()

  messageRepo.addMessage({
    sessionId,
    role: 'user',
    content: JSON.stringify([{ type: 'text', text: userMessage }]),
  })

  // ... 后面的 messages 加载、provider 创建、stream 逻辑不变
```

保留 `initDb()` 函数不变（它负责建表），只删掉 `ensureDefaults`、`defaultSessionId`、`getDefaultSessionId`。

- [ ] **Step 2: 验证编译**

Run: `cd /home/wjj/Project/multi-agent-system/multi-agent-system/apps/web && npx next build`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/chat/route.ts
git commit -m "refactor(api): require sessionId in chat route, remove auto-create defaults"
```

---

### Task 4: 前端侧边栏+聊天区

**Files:**
- Rewrite: `apps/web/src/app/chat/page.tsx`

- [ ] **Step 1: 重写 chat/page.tsx**

完整替换文件内容：

```tsx
'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

// --- Types ---

interface Session {
  id: string
  title: string | null
  created_at: number
  updated_at: number
}

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

// --- Sidebar ---

function Sidebar({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: {
  sessions: Session[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}) {
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
      <div style={{ padding: '16px', borderBottom: '1px solid #222' }}>
        <button
          onClick={onCreate}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: 8,
            border: '1px solid #333',
            background: '#1a1a2e',
            color: '#ededed',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          + New Chat
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              padding: '12px 16px',
              cursor: 'pointer',
              background: s.id === activeId ? '#1a1a2e' : 'transparent',
              borderBottom: '1px solid #111',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: 14,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {s.title || 'Untitled'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(s.id)
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
                fontSize: 16,
                padding: '0 4px',
                flexShrink: 0,
              }}
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Chat Area ---

function ChatArea({
  sessionId,
  messages,
  setMessages,
}: {
  sessionId: string | null
  messages: ChatMessage[]
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
}) {
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentTools, setCurrentTools] = useState<ToolExecution[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentTools])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isStreaming || !sessionId) return

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

  if (!sessionId) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#666' }}>Create or select a chat to start.</p>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
  )
}

// --- Main Page ---

export default function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])

  // Load sessions on mount
  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((data: Session[]) => {
        setSessions(data)
        if (data.length > 0) {
          setActiveSessionId(data[0].id)
        }
      })
  }, [])

  // Load messages when active session changes
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([])
      return
    }
    fetch(`/api/sessions/${activeSessionId}/messages`)
      .then((r) => r.json())
      .then((data) => {
        const parsed: ChatMessage[] = data.map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: (() => {
            try {
              const blocks = JSON.parse(m.content)
              if (Array.isArray(blocks)) {
                return blocks
                  .filter((b: { type: string }) => b.type === 'text')
                  .map((b: { text: string }) => b.text)
                  .join('')
              }
              return m.content
            } catch {
              return m.content
            }
          })(),
        }))
        setMessages(parsed)
      })
  }, [activeSessionId])

  const handleCreate = useCallback(async () => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Chat' }),
    })
    const session: Session = await res.json()
    setSessions((prev) => [session, ...prev])
    setActiveSessionId(session.id)
    setMessages([])
  }, [])

  const handleDelete = useCallback(
    async (id: string) => {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (activeSessionId === id) {
        setSessions((prev) => {
          const remaining = prev.filter((s) => s.id !== id)
          setActiveSessionId(remaining.length > 0 ? remaining[0].id : null)
          return remaining
        })
      }
    },
    [activeSessionId],
  )

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <Sidebar
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={setActiveSessionId}
        onCreate={handleCreate}
        onDelete={handleDelete}
      />
      <ChatArea sessionId={activeSessionId} messages={messages} setMessages={setMessages} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/chat/page.tsx
git commit -m "feat(ui): add sidebar with multi-session support"
```

---

### Task 5: 端到端验证

- [ ] **Step 1: 启动 dev server**

```bash
cd /home/wjj/Project/multi-agent-system/multi-agent-system/apps/web && npx next dev --turbopack
```

- [ ] **Step 2: 打开浏览器测试以下场景**

打开 http://localhost:3000

1. 首次打开 — 侧边栏为空，聊天区提示"Create or select a chat to start"
2. 点「+ New Chat」— 侧边栏出现新会话，聊天区可以输入
3. 发一条消息 — AI 正常流式回复
4. 再点「+ New Chat」— 新会话出现在最上面，聊天区清空
5. 点回第一个会话 — 历史消息加载回来
6. 删除一个会话 — 从列表消失，自动切到另一个
7. 删除所有会话 — 回到"Create or select"状态

- [ ] **Step 3: 更新 STATUS.md**

在 STATUS.md 的「你现在能做的事」部分加上多会话相关描述。

- [ ] **Step 4: Commit**

```bash
git add multi-agent-system/STATUS.md
git commit -m "docs: update STATUS.md with multi-session support"
```
