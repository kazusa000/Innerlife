# B2 Observer 调试面板 — 设计文档

日期：2026-04-14
归属：DESIGN.md 模块 B 基础设施补全 / B2
状态：设计完成，待实现

---

## 1. 目标

观测每轮 AI 实际收到的"原材料"（完整 prompt、工具 schema 等）和内部循环结构，支持实时跟踪和事后回放。

**解决的问题**：当 AI 回答不对、工具调用奇怪时，能看清它到底收到了什么 context、循环了几轮、每一步发生了什么。

**明确非目标**：
- 不做性能 profiling、token 统计图表（可后续加）
- 不做干预/暂停/编辑 prompt（调试器级别的功能留给未来）
- skill / MCP 清单展示待 D、G 模块落地后再接入，本期不做

---

## 2. 使用体验

1. 开发者在 `.env` 设 `OBSERVER_ENABLED=1` → 启动后每次 LLM 调用自动记录到 DB
2. 网页聊天时，顶栏点 🔍 按钮 → 右侧滑出观测抽屉，实时显示当前 turn 每次 LLM 调用的 system / tools / messages / response
3. 想回翻历史 → 打开 `/observer` 页，三栏布局：会话列表 / turn 树 / 详情 pane
4. 观测数据膨胀了 → `/observer` 页左下"🗑 清空全部观测数据"一键清掉

`OBSERVER_ENABLED` 未设或为 0 时，runAgent 不传 observer，性能零开销；前端按钮仍可点但面板空。

---

## 3. 架构

```
runAgent (@mas/core)
    │  新增可选参数 observer?: Observer
    │  调 provider.complete() 前后调用 hook
    ▼
@mas/observer (新包)
    ├─ createDbObserver({ sessionId, userMessageId, onEvent })
    │     enabled=false → no-op observer
    │     enabled=true  → 写 llm_calls + 通过 onEvent 回调推 SSE
    └─ 查询函数：listCallsByUserMessage, getCall, clearAll
    
/api/chat (apps/web)
    │  若 OBSERVER_ENABLED=1，写入 user message 后创建 observer
    │  SSE 流新增事件：llm_call_start / llm_call_end
    ▼
前端
    ├─ /chat 内联抽屉：顶栏 🔍 按钮切换，实时接 SSE 事件
    └─ /observer 页：独立回放，三栏（sessions / turns / detail）
```

Observer 是**旁路**。不改 runAgent 核心循环，不传 observer 时完全无感知。

---

## 4. 数据模型

新表 `llm_calls`（drizzle schema 放在 `@mas/db`）：

```ts
llm_calls {
  id: text PK                            // uuid
  session_id: text FK → sessions.id
  user_message_id: text FK → messages.id  // 外层分组 key
  turn_index: int                         // 同一 user_message 下第几次 LLM 调用
  
  model: text
  system_prompt: text
  tools_json: text       // tool schema 数组 JSON
  messages_json: text    // 发给 LLM 的完整 messages 数组 JSON
  
  response_json: text    // LLM 返回的 content blocks JSON（含 tool_use）
  stop_reason: text
  input_tokens: int
  output_tokens: int
  
  started_at: int (ms)
  finished_at: int (ms)
  error: text nullable
}
```

索引：`(session_id, created_at)`、`(user_message_id, turn_index)`。

**级联删除**：`DELETE /api/sessions/:id` 同时清该会话的 `llm_calls` 记录。

---

## 5. 后端组件

### 5.1 `@mas/core` 改动

`runAgent` 签名增加可选 observer：

```ts
interface Observer {
  onLLMCallStart(payload: {
    model: string
    systemPrompt: string
    tools: ToolSchema[]
    messages: Message[]
  }): string  // 返回 callId
  
  onLLMCallEnd(callId: string, result: {
    response: ContentBlock[]
    stopReason: string
    usage: { inputTokens: number; outputTokens: number }
    error?: string
  }): void
}

function runAgent(
  config: AgentConfig,
  messages: Message[],
  provider: Provider,
  observer?: Observer,
): AsyncGenerator<AgentEvent>
```

内部循环中，每次调用 `provider.complete()` 前 `onLLMCallStart`，后 `onLLMCallEnd`。

### 5.2 新包 `packages/observer`

导出：
```ts
createDbObserver(opts: {
  sessionId: string
  userMessageId: string
  onEvent?: (event: { type: 'llm_call_start' | 'llm_call_end'; ... }) => void
}): Observer

createNoopObserver(): Observer  // 全部方法空实现

// 查询
listTurnsBySession(sessionId): TurnTree  // 外层 user message，内嵌 LLM calls 摘要
getCall(callId): LLMCall                  // 完整记录
clearAllCalls(): void
deleteCallsBySession(sessionId): void
```

### 5.3 API 路由

- `GET /api/observer/sessions/:id` — 返回 turn 树（供 /observer 页）
- `GET /api/observer/calls/:callId` — 返回单条 LLM call 完整内容
- `DELETE /api/observer/all` — 清空所有 llm_calls

### 5.4 `/api/chat` 改动

- 读 `process.env.OBSERVER_ENABLED === '1'`
- 写入 user message → 拿到 `userMessageId`
- `enabled` 为真时 `createDbObserver({ sessionId, userMessageId, onEvent: sse })`，否则 `createNoopObserver()`
- 传给 `runAgent`
- SSE 流新增两种事件：`llm_call_start`（带 callId + request 摘要）、`llm_call_end`（带 callId + response 摘要）。前端面板关闭时忽略

### 5.5 `/api/sessions/[id]` DELETE 改动

增加 `observerRepo.deleteCallsBySession(id)`。

---

## 6. 前端组件

### 6.1 `/chat` 内联观测抽屉

- 顶栏右侧 🔍 按钮，`useState` 控制 `observerOpen`
- 打开 → 聊天区右侧滑出 420px 宽抽屉，挤压聊天区（不浮层遮挡）
- 抽屉显示"当前 turn"：默认最新用户消息对应的所有 LLM 调用
- 接 SSE 的 `llm_call_start` / `llm_call_end`，实时追加/更新
- 抽屉内顶部 4 个 tab：`System` / `Tools` / `Messages` / `Response`
- 抽屉内上方一个 turn 选择器（下拉或左右箭头），可回看同会话内历史 turn

组件：
- `apps/web/src/app/chat/ObserverDrawer.tsx`
- `apps/web/src/app/chat/observer-tabs/*.tsx`（4 个 tab 内容）

### 6.2 `/observer` 独立页

三栏布局：
```
Sessions list (260px)  │  Turn tree (320px)  │  Detail pane (flex 1)
─────────────────────  │  ───────────────    │  ──────────────────
- Chat A               │  User: "hi"         │  [System][Tools]
- Chat B ←             │   └ call #0 (text)  │  [Messages][Rsp]
- Chat C               │   └ call #1 (tool)  │
                       │  User: "..."        │  <json pretty view>
[🗑 Clear all]         │   └ call #0         │
```

- 左栏：复用 `/api/sessions`
- 中栏：调 `/api/observer/sessions/:id` 取 turn 树
- 右栏：选中某个 call 后调 `/api/observer/calls/:callId`，4 tab 显示
- 左栏底部「🗑 清空全部观测数据」按钮 → 确认后 `DELETE /api/observer/all`

组件：
- `apps/web/src/app/observer/page.tsx`
- `apps/web/src/app/observer/SessionsList.tsx`
- `apps/web/src/app/observer/TurnTree.tsx`
- `apps/web/src/app/observer/DetailPane.tsx`

---

## 7. 开关行为

| 环境 | `OBSERVER_ENABLED` | UI 按钮 | 结果 |
| --- | --- | --- | --- |
| 开发 | `1` | 开 | 实时观测，数据入库，可回放 |
| 开发 | `1` | 关 | 数据仍入库，只是不显示面板 |
| 开发 | 未设/`0` | 开 | 面板显示但无实时数据（runAgent 不传 observer） |
| 开发 | 未设/`0` | 关 | 完全关闭 |
| 生产 | 默认未设 | — | 零开销 |

---

## 8. 文件结构增量

```
multi-agent-system/
├── packages/
│   ├── core/
│   │   └── src/agent/run-agent.ts           # 增加 observer 参数
│   ├── db/
│   │   └── src/
│   │       ├── schema.ts                    # + llm_calls 表
│   │       └── repository/llm-calls.ts      # 新增
│   └── observer/                            # 新包
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── db-observer.ts
│           └── noop-observer.ts
└── apps/web/src/
    ├── app/
    │   ├── api/
    │   │   ├── chat/route.ts                # 注入 observer
    │   │   └── observer/
    │   │       ├── sessions/[id]/route.ts
    │   │       ├── calls/[callId]/route.ts
    │   │       └── all/route.ts             # DELETE
    │   ├── chat/
    │   │   ├── ChatArea.tsx                 # 增加 🔍 按钮 + SSE 新事件
    │   │   └── ObserverDrawer.tsx           # 新增
    │   └── observer/                        # 新页面
    │       ├── page.tsx
    │       ├── SessionsList.tsx
    │       ├── TurnTree.tsx
    │       └── DetailPane.tsx
```

---

## 9. 测试与验收

1. `.env` 不设 `OBSERVER_ENABLED` → 聊天正常；`llm_calls` 表无新增行
2. `.env` 设 `OBSERVER_ENABLED=1` → 发一句带工具调用的消息（例 "ls"），`llm_calls` 表应有 ≥ 2 条记录（首次 LLM 决定调工具，工具返回后二次 LLM 生成回答）
3. 聊天页点 🔍 → 抽屉滑出，实时显示两次 LLM 调用；切 tab 能看到完整 system / tools / messages / response
4. 打开 `/observer` 页 → 能看到刚才那会话，展开后看到 turn 树，点 call 右边显示 JSON
5. 点「🗑 清空全部观测数据」→ 确认后列表清空
6. 删除某会话 → 该会话的 llm_calls 记录一起被清

---

## 10. 后续扩展（不在本期）

- Token / 成本图表
- skill / MCP 清单字段（等模块 D、G 落地）
- 干预式调试（暂停、改 prompt、重放）
- Call 对比视图（diff 两次 call 的 messages 差异）
