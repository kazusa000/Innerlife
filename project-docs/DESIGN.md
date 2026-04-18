# Multi-Agent Virtual Persona System — Design Spec

## 1. Vision

构建一个**多 AI 虚拟人构建管理系统**，注重人性的构建。每个虚拟人拥有独特的性格、持久记忆、情感状态、社会关系，能自主行为并随时间成长进化。

系统参考两个顶级开源项目：
- **claude-code** — agent 内部架构（async generator 循环、工具系统、子代理）
- **openclaw** — agent 管理层（gateway 控制面、插件系统、cron/heartbeat、多渠道路由）

最终目标不是复制它们，而是在它们的成熟方案基础上构建一个面向虚拟人人格的独特系统。

---

## 2. 技术决策汇总

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 数据模型 | Agent = 虚拟人（人格与运行时合一） | 虚拟人是独一无二的个体，不存在"同一人格多实例"需求 |
| 语言/运行时 | TypeScript + Node.js | 生态成熟 |
| 包管理器 | npm | 最通用，零额外安装 |
| 项目结构 | Monorepo（npm workspaces） | 核心与 UI 解耦，渐进扩展 |
| Web UI | Next.js（App Router） | 全栈框架，SSR + API Routes，未来可打包桌面应用 |
| LLM 接入 | Provider 抽象层，Phase 1 实现 Anthropic，Phase 2 加 OpenAI/Ollama | 不过度工程，渐进扩展 |
| 数据持久化 | SQLite + Drizzle ORM（业务数据）| 轻量嵌入，查询能力强，未来可迁移 PostgreSQL |
| 记忆存储 | Python + ChromaDB（独立服务）| 借鉴 MemPalace 思路：向量检索交给专业库，主项目通过 HTTP/MCP 调用 |
| 记忆组织 | 宫殿隐喻：Wing（人/项目）→ Room（时间/话题）→ Drawer（原文） | 按实体组织比按类型分更实用，参考 MemPalace |
| 记忆加载 | 4 层渐进（L0 身份 → L1 精华 → L2 按需 → L3 深搜） | 启动只花 ~600 token，不一次全塞 context |
| 模块化架构 | System Registry + Lifecycle Hooks，共享 TurnContext | 可插拔系统（感知/内在/行为/表达），每个虚拟人独立配置方案 |
| 感知层设计 | 子模型预处理管线，主模型只收文本 | 主模型不需要多模态能力，子模型可独立选型 |
| Agent 间通信 | 消息总线接口，先内存实现，后升级 SQLite | 渐进式 |
| Daemon 管理 | Phase 1 不需要（Next.js 即长驻进程），Phase 5 加独立 daemon | 避免过早复杂化 |
| 进程模型 | 单进程 async 起步，预留 AgentRunner 接口支持 worker 子进程 | 渐进式 |
| 用户模型 | 单用户 | 个人虚拟人管理系统 |
| 开源许可 | MIT | 开源 |

---

## 3. 项目结构

```
multi-agent-system/
├── packages/
│   ├── core/                    # agent 运行时（零 UI 依赖）
│   │   └── src/
│   │       ├── agent/           # agent 循环（async generator）
│   │       │   ├── runner.ts    # runAgent() — 核心循环
│   │       │   └── types.ts     # AgentConfig, AgentEvent
│   │       ├── tools/           # 工具接口 + 实现
│   │       │   ├── types.ts     # Tool, ToolResult 接口
│   │       │   └── bash.ts      # BashTool 实现
│   │       ├── provider/        # LLM provider 抽象层
│   │       │   ├── types.ts     # LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent
│   │       │   └── anthropic.ts # AnthropicProvider 实现
│   │       ├── message-bus/     # 消息总线
│   │       │   ├── types.ts     # MessageBus 接口（send, subscribe, query）
│   │       │   └── memory.ts    # 内存实现
│   │       └── types/           # 共享类型（Message, ContentBlock 等）
│   │
│   ├── systems/                 # 模块化系统（AgentSystem 实现）
│   │   └── src/
│   │       ├── types.ts         # AgentSystem 接口、TurnContext 类型
│   │       ├── registry.ts      # systemRegistry（手动注册）
│   │       ├── personality/     # 性格系统（big-five / mbti / freeform）
│   │       ├── emotion/         # 情感系统（basic / dimensional / appraisal）
│   │       ├── relationship/    # 关系系统（simple / multi-dim）
│   │       ├── memory/          # 记忆系统（sqlite 方案）
│   │       ├── values/          # 价值观系统（priority-list）
│   │       ├── perception/      # 感知系统（vision / hearing）
│   │       ├── compaction/      # 上下文压缩（summary / sliding-window）
│   │       ├── safety/          # 安全策略（confirm-dangerous / read-only）
│   │       └── expression/      # 表达系统（tts）
│   │
│   ├── observer/                # Observer 调试系统（已完成）
│   │   └── src/
│   │       ├── types.ts         # Observer 接口
│   │       ├── db-observer.ts   # DB 持久化实现
│   │       └── noop-observer.ts # 空实现
│   │
│   ├── memory-service/          # 记忆服务（Python + ChromaDB，独立进程）
│   │   ├── server.py            # HTTP/MCP 服务入口
│   │   ├── palace.py            # 宫殿操作（Wing/Room/Drawer）
│   │   ├── searcher.py          # 语义搜索（向量 + BM25 混合）
│   │   ├── layers.py            # 4 层记忆栈（L0-L3）
│   │   └── requirements.txt     # Python 依赖（chromadb 等）
│   │
│   └── db/                      # 数据层
│       └── src/
│           ├── schema/          # SQLite 表定义（Drizzle ORM）
│           ├── migrations/      # 数据库迁移
│           └── repository/      # 数据访问层
│
├── apps/
│   └── web/                     # Next.js 应用
│       └── src/
│           ├── app/
│           │   ├── page.tsx                    # 首页 — 虚拟人列表/仪表盘
│           │   ├── agent/
│           │   │   ├── [id]/page.tsx           # 虚拟人详情
│           │   │   └── new/page.tsx            # 创建虚拟人
│           │   └── chat/
│           │       └── [sessionId]/page.tsx    # 对话界面
│           ├── components/
│           │   ├── chat/                       # 消息气泡、输入框、工具执行展示
│           │   └── agent/                      # 虚拟人卡片、配置表单
│           └── app/api/
│               ├── agents/                     # CRUD + 启动/停止
│               ├── sessions/                   # 会话管理
│               └── chat/route.ts               # 流式对话端点
│
├── package.json                 # npm workspaces 根配置
├── tsconfig.json                # 基础 TypeScript 配置
└── CLAUDE.md
```

---

## 4. Agent 核心循环

参考 claude-code 的 `query()` async generator 模式。

### 4.1 数据流

```
用户/系统消息 → runAgent()
                    │
                    ▼
              ┌─────────────┐
              │ 构建 messages │
              │ + system prompt│
              └──────┬──────┘
                     │
                     ▼
              ┌─────────────┐
              │ 调用 LLM API │◄─────────────────┐
              │  (streaming)  │                   │
              └──────┬──────┘                   │
                     │                           │
                     ▼                           │
              ┌─────────────┐                   │
              │ 解析响应      │                   │
              │ stop_reason? │                   │
              └──┬───────┬──┘                   │
                 │       │                       │
            tool_use   end_turn                 │
                 │       │                       │
                 ▼       ▼                       │
          ┌──────────┐  返回文本                 │
          │ 执行工具   │                         │
          │ 收集结果   │                         │
          └─────┬────┘                          │
                │                                │
                │  追加 tool_result 到 messages   │
                └────────────────────────────────┘
```

### 4.2 核心接口

```typescript
// packages/core/src/agent/types.ts

interface AgentConfig {
  id: string
  model: string
  systemPrompt: string
  tools: Tool[]
  maxTurns?: number               // 安全上限，防止无限循环
}

type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; result: ToolResult }
  | { type: 'complete'; message: LLMResponse }
  | { type: 'error'; error: Error }
```

### 4.3 核心循环

```typescript
// packages/core/src/agent/runner.ts

async function* runAgent(
  config: AgentConfig,
  messages: Message[],
  provider: LLMProvider,
): AsyncGenerator<AgentEvent> {
  let turns = 0
  
  while (true) {
    if (config.maxTurns && ++turns > config.maxTurns) {
      yield { type: 'error', error: new Error('Max turns exceeded') }
      return
    }
    
    // 流式调用 LLM
    const response = yield* streamLLMCall(provider, messages, config)
    
    if (response.stopReason !== 'tool_use') {
      yield { type: 'complete', message: response }
      return
    }
    
    // 执行工具
    for (const toolCall of response.toolCalls) {
      yield { type: 'tool_start', toolName: toolCall.name, input: toolCall.input }
      const result = await executeTool(config.tools, toolCall)
      yield { type: 'tool_result', toolName: toolCall.name, result }
      messages.push(/* tool_result message */)
    }
  }
}
```

### 4.4 模块化系统生命周期

agent 循环不再只是"调 LLM + 执行工具"，而是在每个阶段让已注册的 AgentSystem 参与处理。

#### TurnContext（共享黑板）

每轮对话创建一个 TurnContext，所有系统通过它交换数据：

```typescript
interface TurnContext {
  // 基本信息（runner 填）
  agentId: string
  sessionId: string
  userId: string

  // 用户输入（感知系统填）
  input: {
    raw: string  // Phase 2 基座只做文本；Phase 3 起拓宽为 string | Buffer 接入多模态
    text: string
    modality: 'text' | 'image' | 'audio'
    perception?: Record<string, unknown>
  }

  // 各系统写入的状态
  state: {
    emotion?: unknown
    relationship?: unknown
    personality?: unknown
    memory?: unknown
    [key: string]: unknown
  }

  // 各系统注入 prompt 的片段（runner 按 priority 排序拼接）
  promptFragments: Array<{
    source: string
    priority: number
    content: string
  }>

  // LLM 回复后填入
  response?: {
    content: unknown[]  // Phase 2 保持宽松（兼容 provider 原生形状）；Phase 3 起收紧为 ContentBlock[]
    stopReason: string
    usage: { inputTokens: number; outputTokens: number }
  }
}
```

#### AgentSystem 接口

每个可插拔系统实现此接口，通过生命周期钩子参与 agent 循环：

```typescript
interface AgentSystem {
  name: string
  type: string   // 同类系统的分类键，如 'emotion'

  // 生命周期钩子（全部可选）
  beforeTurn?(ctx: TurnContext): Promise<void>   // 准备：加载状态、分析输入
  beforeLLM?(ctx: TurnContext): Promise<void>    // 注入：往 promptFragments 写内容
  afterLLM?(ctx: TurnContext): Promise<void>     // 反应：根据 LLM 输出更新状态
  afterTurn?(ctx: TurnContext): Promise<void>    // 善后：持久化状态到 DB

  init?(agentId: string): Promise<void>
  destroy?(): Promise<void>
}
```

#### 带系统生命周期的数据流

```
用户消息 → 创建 TurnContext
               │
               ▼ ─── beforeTurn ────────────────────
               │   感知系统：子模型处理 → 写 ctx.input
               │   情感系统：从 DB 读当前心情 → 写 ctx.state.emotion
               │   关系系统：从 DB 读关系 → 写 ctx.state.relationship
               │   性格系统：读 agent 配置 → 写 ctx.state.personality
               │
               ▼ ─── beforeLLM ─────────────────────
               │   各系统根据 ctx.state → push promptFragment
               │
               ▼ ─── 拼 system prompt ──────────────
               │   基础 prompt + promptFragments（按 priority 排序）
               │
               ▼ ─── 调 LLM（工具循环照旧）────────
               │
               ▼ ─── afterLLM ──────────────────────
               │   情感系统：分析回复 → 更新 ctx.state
               │   关系系统：分析交互质量 → 更新 ctx.state
               │
               ▼ ─── afterTurn ─────────────────────
               │   各系统持久化状态到各自的 DB 表
               │
               ▼
          返回回复
```

#### 系统注册（手动 registry）

```typescript
const systemRegistry: Record<string, Record<string, () => AgentSystem>> = {
  emotion: {
    'noop':        () => new NoopSystem('emotion'),
    'basic':       () => new BasicEmotion(),
    'dimensional': () => new DimensionalEmotion(),
    'appraisal':   () => new AppraisalEmotion(),
  },
  personality: { ... },
  memory: { ... },
  // 加新系统类型 → 加一个 key
  // 加新方案 → 对应类型下加一行
}

// 启动时按 agent 配置实例化
function createSystems(modules: AgentModules): AgentSystem[] {
  return Object.entries(modules)
    .filter(([_, impl]) => impl !== 'noop')
    .map(([type, impl]) => systemRegistry[type][impl]())
}
```

### 4.5 与 claude-code 的简化对比

| claude-code 特性 | Phase 1 状态 | 加入阶段 |
|---|---|---|
| Async generator 循环 | 保留 | Phase 1 |
| Context compaction（三层压缩） | 去掉 | Phase 4 |
| Permission 系统 | 去掉 | Phase 3 |
| Subagent spawning | 去掉 | Phase 3 |
| Tool 并发执行 | 去掉（串行） | Phase 4 |
| Message compaction | 去掉 | Phase 4 |
| Feature flag 系统 | 去掉 | Phase 5 |

---

## 5. 工具系统

### 5.1 工具接口

```typescript
// packages/core/src/tools/types.ts

interface Tool {
  name: string
  description: string                     // 给 LLM 看的工具描述
  inputSchema: JSONSchema                 // 参数定义
  
  call(input: Record<string, unknown>): Promise<ToolResult>
  
  // --- Phase 2+ 可选方法 ---
  isEnabled?(): boolean                   // 动态启用/禁用
  checkPermissions?(input): Promise<PermissionResult>   // Phase 3: 权限校验
  validateInput?(input): Promise<ValidationResult>      // Phase 3: 输入校验
  isConcurrencySafe?(input): boolean                    // Phase 4: 并发安全标记
  isReadOnly?(input): boolean                           // Phase 3: 只读标记
  isDestructive?(input): boolean                        // Phase 3: 破坏性标记
}

interface ToolResult {
  output: string                          // 返回给 LLM 的文本
  isError?: boolean                       // 标记执行失败
  metadata?: Record<string, unknown>      // 供 UI/日志使用，不发给 LLM
}
```

### 5.2 Phase 1 实现 — BashTool

```typescript
// packages/core/src/tools/bash.ts

const BashTool: Tool = {
  name: 'bash',
  description: 'Execute a shell command and return its output',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in ms', default: 30000 },
    },
    required: ['command'],
  },
  async call(input) {
    // child_process.exec with timeout protection
    // capture stdout + stderr
    // return { output, isError }
  }
}
```

### 5.3 未来工具清单

| 工具 | 加入阶段 |
|------|---------|
| BashTool | Phase 1 |
| FileReadTool | Phase 2 |
| FileWriteTool | Phase 2 |
| WebFetchTool | Phase 2 |
| MemorySearchTool | Phase 2（语义检索记忆） |
| ScheduleTaskTool | Phase 4（虚拟人自主安排任务） |
| SendMessageTool | Phase 3（agent 间通信） |
| SpawnAgentTool | Phase 3（子代理生成） |

---

## 6. LLM Provider 抽象层

### 6.1 接口定义

```typescript
// packages/core/src/provider/types.ts

interface LLMProvider {
  name: string
  streamMessage(params: LLMRequest): AsyncGenerator<LLMStreamEvent>
  sendMessage(params: LLMRequest): Promise<LLMResponse>
}

interface LLMRequest {
  model: string
  systemPrompt: string
  messages: Message[]
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
}

interface LLMResponse {
  content: ContentBlock[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  usage: { inputTokens: number; outputTokens: number }
}

type LLMStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; input: string }
  | { type: 'message_complete'; response: LLMResponse }
```

### 6.2 实现计划

| Provider | 加入阶段 | 说明 |
|----------|---------|------|
| AnthropicProvider | Phase 1 | @anthropic-ai/sdk，流式调用 |
| OpenAIProvider | Phase 2 | openai SDK，兼容 GPT-4/o1 等 |
| OllamaProvider | Phase 2 | 本地模型支持，HTTP API |
| Model fallback 链 | Phase 2 | 参考 openclaw runWithModelFallback() |
| Token 计数与成本追踪 | Phase 2 | 按 provider 计费规则 |

---

## 7. 数据层

### 7.1 技术选型
- **ORM**: Drizzle ORM（类型安全，支持 SQLite → PostgreSQL 迁移）
- **Driver**: better-sqlite3（同步 API，性能好）
- **迁移**: Drizzle Kit

### 7.2 Phase 1 Schema

```
agents                               -- 虚拟人 = agent（人格与运行时合一）
  id          TEXT PRIMARY KEY
  name        TEXT NOT NULL
  description TEXT
  personality TEXT (JSON)            -- 人格配置（Big Five traits, speakingStyle, values, background, quirks）
  skills      TEXT (JSON)            -- 技能文件路径列表，如 ["skills/cooking.md", "skills/finance.md"]
  status      TEXT ('idle' | 'running' | 'error')
  model       TEXT NOT NULL
  modules     TEXT (JSON)            -- 模块方案选择（如 {"emotion":"dimensional","memory":"chromadb",...}）
  config      TEXT (JSON)            -- 运行时配置（tools, maxTurns 等）
  createdAt   INTEGER
  updatedAt   INTEGER

sessions
  id          TEXT PRIMARY KEY
  agentId     TEXT FK → agents.id
  title       TEXT
  status      TEXT ('active' | 'archived')
  createdAt   INTEGER
  updatedAt   INTEGER

messages
  id          TEXT PRIMARY KEY
  sessionId   TEXT FK → sessions.id
  role        TEXT ('user' | 'assistant' | 'system')
  content     TEXT (JSON)         -- ContentBlock[]
  tokenCount  INTEGER
  createdAt   INTEGER

toolExecutions
  id          TEXT PRIMARY KEY
  messageId   TEXT FK → messages.id
  toolName    TEXT
  input       TEXT (JSON)
  output      TEXT
  isError     INTEGER (boolean)
  durationMs  INTEGER
  createdAt   INTEGER
```

### 7.3 Phase 2+ 记忆存储（ChromaDB，独立于 SQLite）

记忆不再存 SQLite，改用 Python + ChromaDB 独立服务，借鉴 MemPalace 的宫殿隐喻。

```
ChromaDB Collection: palace_drawers
  id          TEXT                    -- drawer ID
  document    TEXT                    -- 原文（逐字存储，不摘要）
  embedding   自动生成                -- ChromaDB 内置向量化
  metadata:
    agent_id  TEXT                    -- 所属虚拟人
    wing      TEXT                    -- 人/项目名（按实体组织）
    room      TEXT                    -- 时间段/话题
    summary   TEXT                    -- LLM 生成的摘要（辅助检索，非替代原文）
    source_session_id TEXT
    created_at INTEGER
    last_accessed_at INTEGER
```

4 层加载策略：
- **L0 身份**（~100 token）：虚拟人的"我是谁"，永远在 system prompt
- **L1 精华**（~500-800 token）：最重要的记忆片段，永远在 system prompt
- **L2 按需**（~200-500/次）：提到某人/某项目时加载对应 Wing
- **L3 深搜**（无上限）：ChromaDB 全量语义检索

主项目通过 HTTP/MCP 调用记忆服务，不直接操作 ChromaDB。

### 7.4 Phase 2+ Schema 扩展（SQLite，业务数据）

```

emotions                              -- Phase 2: 情感状态
  id          TEXT PRIMARY KEY
  agentId     TEXT FK → agents.id
  state       TEXT (JSON)             -- { mood, energy, valence, arousal, ... }
  trigger     TEXT                    -- 触发原因
  createdAt   INTEGER

relationships                         -- Phase 3: 关系图谱
  id          TEXT PRIMARY KEY
  fromId      TEXT                    -- agent 或 user
  toId        TEXT                    -- agent 或 user
  type        TEXT ('trust' | 'affinity' | 'familiarity' | ...)
  score       REAL
  history     TEXT (JSON)             -- 关系变化日志
  updatedAt   INTEGER

scheduled_tasks                       -- Phase 4: 自主行为任务
  id          TEXT PRIMARY KEY
  agentId     TEXT FK → agents.id
  schedule    TEXT                    -- cron 表达式
  action      TEXT (JSON)             -- 要执行的动作
  status      TEXT ('active' | 'paused' | 'completed')
  lastRunAt   INTEGER
  nextRunAt   INTEGER
  createdAt   INTEGER

growth_logs                           -- Phase 4: 成长记录
  id          TEXT PRIMARY KEY
  agentId     TEXT FK → agents.id
  dimension   TEXT                    -- 哪个维度变化（性格特征、技能等）
  oldValue    TEXT (JSON)
  newValue    TEXT (JSON)
  reason      TEXT                    -- 变化原因
  createdAt   INTEGER
```

---

## 8. Web UI 与 API

### 8.1 页面结构

| 路由 | 功能 | Phase |
|------|------|-------|
| `/` | 首页 — 虚拟人列表/仪表盘 | 1 |
| `/agent/new` | 创建虚拟人 | 1 |
| `/agent/[id]` | 虚拟人详情 — 配置、状态、会话列表 | 1 |
| `/chat/[sessionId]` | 对话界面 — 流式消息渲染 | 1 |
| `/agent/[id]/edit` | 人格编辑器（性格滑块、价值观配置） | Phase 2 |
| `/agent/[id]/memory` | 记忆管理界面 | Phase 2 |
| `/agent/[id]/relationships` | 关系图谱可视化 | Phase 3 |
| `/dashboard` | 仪表盘（运行状态、统计、成本） | Phase 5 |

### 8.2 API 端点

```
# Phase 1
POST   /api/agents                创建虚拟人（agent = 虚拟人）
GET    /api/agents                列出所有虚拟人
GET    /api/agents/:id            获取详情
PATCH  /api/agents/:id            更新配置/人格
DELETE /api/agents/:id            删除虚拟人

POST   /api/sessions              创建会话（指定 agentId）
GET    /api/sessions?agentId=x    列出会话
DELETE /api/sessions/:id          删除会话

POST   /api/chat                  发送消息
       Body: { sessionId, content }
       Response: SSE stream（逐事件推送 AgentEvent）

# Phase 2+
GET    /api/agents/:id/memories       查询记忆
POST   /api/agents/:id/memories       手动添加记忆
GET    /api/agents/:id/emotions       情感状态历史

# Phase 3+
POST   /api/agents/:id/start         启动 agent
POST   /api/agents/:id/stop          停止 agent
GET    /api/relationships             关系图谱

# Phase 4+
POST   /api/scheduled-tasks           创建定时任务
GET    /api/scheduled-tasks           列出定时任务
PATCH  /api/scheduled-tasks/:id       更新/暂停任务

# Phase 5+
GET    /api/dashboard/stats           运行统计
GET    /api/dashboard/costs           成本追踪
WebSocket /ws                         实时通信（agent 主动推送）
```

### 8.3 流式对话数据流

```
浏览器                    Next.js API Route              core
  │                            │                          │
  │  POST /api/chat ──────►   │                          │
  │                            │  runAgent() ──────────► │
  │                            │                          │ LLM streaming
  │  ◄── SSE: text_delta ──── │ ◄── yield AgentEvent ── │
  │  ◄── SSE: text_delta ──── │ ◄── yield AgentEvent ── │
  │  ◄── SSE: tool_start ──── │ ◄── yield AgentEvent ── │
  │  ◄── SSE: tool_result ─── │ ◄── yield AgentEvent ── │
  │  ◄── SSE: text_delta ──── │ ◄── yield AgentEvent ── │
  │  ◄── SSE: complete ────── │ ◄── yield AgentEvent ── │
  │                            │                          │
  │                            │  写入 db (messages,      │
  │                            │   toolExecutions)        │
```

---

## 9. 消息总线（Agent 间通信）

### 9.1 接口

```typescript
// packages/core/src/message-bus/types.ts

interface MessageBus {
  send(to: string, message: BusMessage): Promise<void>
  subscribe(agentId: string, handler: (msg: BusMessage) => void): Unsubscribe
  query(agentId: string, filter?: MessageFilter): Promise<BusMessage[]>
}

interface BusMessage {
  id: string
  from: string              // 发送者 agent ID
  to: string                // 接收者 agent ID
  type: string              // 消息类型
  payload: unknown
  timestamp: number
}
```

### 9.2 实现路线

| 阶段 | 实现 | 特性 |
|------|------|------|
| Phase 1 | InMemoryMessageBus | 进程内 Map + EventEmitter，够用 |
| Phase 3 | SQLiteMessageBus | 持久化，支持历史查询，crash 恢复 |
| Phase 5 | 可选 Redis/外部 MQ | 跨进程、跨机器（如果需要） |

---

## 10. 模块化系统架构

所有虚拟人共享同一个 agent 循环（引擎），但每个虚拟人可以独立配置使用哪些系统、每个系统使用哪种方案。系统通过 TurnContext（共享黑板）交换数据，通过 promptFragments 注入 system prompt（详见 4.4 节）。

### 10.1 系统分层总览

```
┌─ 感知层 PERCEPTION ────────────────────────┐
│  子模型预处理，把原始输入转成文本给主模型     │
│  Vision: noop / claude-vision / local-vlm   │
│  Hearing: noop / whisper / local-stt        │
└─────────────────────────────────────────────┘
┌─ 内在系统 INNER SYSTEMS ───────────────────┐
│  各有独立 DB 表，决定虚拟人"怎么想"          │
│  Personality: noop / big-five / mbti / freeform │
│  Emotion: noop / basic / dimensional / appraisal │
│  Relationship: noop / simple / multi-dim    │
│  Memory: noop / sqlite / chromadb           │
│  Values: noop / priority-list               │
└─────────────────────────────────────────────┘
┌─ 行为层 BEHAVIOR ──────────────────────────┐
│  决定虚拟人"能做什么"                        │
│  Tool Set: 勾选制                           │
│  Compaction: noop / summary / sliding-window │
│  Safety: noop / confirm-dangerous / read-only │
└─────────────────────────────────────────────┘
┌─ 表达层 EXPRESSION ────────────────────────┐
│  子模型后处理，丰富输出形式                   │
│  Voice: noop / tts                          │
└─────────────────────────────────────────────┘
```

每个系统都有 `noop`（关闭）选项。创建虚拟人时，在 `agents.modules` JSON 字段中存储方案选择。

### 10.2 可扩展性设计

| 想做什么 | 改哪里 | 不改哪里 |
|---|---|---|
| 加新系统类型 | 新文件 + registry 一行 | runner / 其他系统 / 前端 |
| 加新方案 | 新文件 + registry 一行 | 同类型其他方案 / runner |
| 改某个方案内部逻辑 | 只改那一个文件 | 其他所有文件 |
| 前端显示可选方案 | 不改（从 registry 动态读） | — |

### 10.3 内在系统 — 性格（Personality）

#### big-five 方案

```typescript
interface BigFiveParams {
  traits: {
    openness: number         // 开放性 (0-1)
    conscientiousness: number // 尽责性
    extraversion: number     // 外向性
    agreeableness: number    // 宜人性
    neuroticism: number      // 神经质
  }
  speakingStyle: {
    formality: number
    verbosity: number
    humor: number
    emotionality: number
    languagePatterns: string[]
  }
  background: string
  quirks: string[]
}
```

参数存在 `agents.personality` JSON 字段（与方案选择 `agents.modules.personality` 分开存储）。

#### mbti 方案

基于 16 型人格（INTJ / ENFP 等），从 MBTI 类型推导出说话风格和决策偏好。

#### freeform 方案

纯文本描述，直接作为 prompt 注入，不做结构化解析。最灵活但最不可控。

### 10.4 内在系统 — 情感（Emotion）

#### basic 方案

三种离散状态：happy / sad / angry，LLM 判断用户消息后切换。

#### dimensional 方案

```
状态维度：
  mood:     -1.0 (悲伤) ─── 0 (平静) ─── 1.0 (快乐)
  energy:    0.0 (疲惫) ─── 1.0 (充沛)
  stress:    0.0 (放松) ─── 1.0 (焦虑)
```

更新机制：
- 用户消息情感分析（LLM 判断）→ 调整维度值
- 工具执行结果（成功/失败影响心情）
- 时间衰减：心情自然回归基线

持久化：`emotion_states` 表（agentId, state JSON, trigger, createdAt）

#### appraisal 方案

基于 OCC 认知评价理论，根据事件对虚拟人目标的影响程度计算情绪反应。更复杂但更"类人"。

### 10.5 内在系统 — 关系（Relationship）

#### simple 方案

单一信任分数（0-1），每次交互后微调。

#### multi-dim 方案

```
关系维度（0-1）：
  trust       信任度
  affinity    亲密度
  familiarity 熟悉度
  respect     尊重度

更新机制：
  每次交互后 → 根据交互质量/内容 → 微调关系分数
  长期无交互 → 熟悉度自然衰减
```

持久化：`relationships` 表（fromId, toId, dimensions JSON, history JSON, updatedAt）

### 10.6 内在系统 — 记忆（Memory）

#### sqlite 方案

本地关键词搜索，简单轻量，无需额外服务。

#### chromadb 方案

借鉴 MemPalace 的宫殿隐喻 + ChromaDB 向量检索，作为独立 Python 服务运行。

存储结构：
```
Palace（宫殿）= 一个虚拟人的全部记忆
  └── Wing（翼）= 一个人 / 一个项目 / 一个话题领域
        └── Room（房间）= 某一天 / 某次对话 / 某个子话题
              └── Drawer（抽屉）= 一段原始对话文本
```

4 层渐进加载：
- **L0 身份**（~100 token）：虚拟人的"我是谁"，永远在 system prompt
- **L1 精华**（~500-800 token）：最重要的记忆片段，永远在 system prompt
- **L2 按需**（~200-500/次）：提到某人/项目时加载对应 Wing
- **L3 深搜**（无上限）：ChromaDB 全量语义检索

通信方式：主项目通过 HTTP/MCP 调用记忆服务。

参考项目：MemPalace（`reference-project/mempalace/`）

### 10.7 感知层

感知系统通过子模型将非文本输入转为文本描述，主模型只接收文本。

```typescript
interface PerceptionResult {
  description: string              // 给主模型的文本描述
  metadata: Record<string, unknown> // 给记忆/情感系统的结构化数据
  confidence: number
}
```

- **Vision**：图片 → 子模型（Claude Vision / GPT-4V / 本地 VLM）→ 文字描述
- **Hearing**：音频 → 子模型（Whisper / 本地 STT）→ 转写文本 + 语气分析

感知结果写入 `ctx.input`，可同时存入记忆系统。

### 10.8 行为层 — 自主行为引擎（Phase 4）

参考 openclaw 的 Cron + Heartbeat 模式：

```
定时器 tick → 检查 scheduled_tasks → 符合条件？
                                        │
                                       yes
                                        │
                                        ▼
                                  启动 agent turn
                                  （自主行为上下文）
                                        │
                                        ▼
                                  执行动作 → 结果
                                  （发消息、更新记忆等）
```

自主行为类型：
- 主动问候（检测到用户长时间未互动）
- 自我反思（定期回顾记忆，更新自我认知）
- 关系维护（主动联络关系中的其他虚拟人）
- 日程执行（用户或虚拟人自己安排的任务）

### 10.9 行为层 — 成长/进化系统（Phase 4）

```
交互累积 → 触发成长检查点（每 N 次对话 / 每周）
              │
              ▼
        LLM 分析交互历史 → 判断性格是否应该变化
              │
              ▼
        微调 Personality traits → 记录 growth_logs
              │
              ▼
        通知用户（可选）："我觉得我最近变得更 XXX 了"
```

### 10.10 System Prompt 动态组装

runner 在 `beforeLLM` 阶段收集所有系统的 promptFragments，按 priority 排序拼接：

```
system prompt = 基础指令（priority: 0）
              + 性格描述（priority: 10, personality 系统写入）
              + 当前情感（priority: 20, emotion 系统写入）
              + 相关记忆（priority: 30, memory 系统写入）
              + 关系上下文（priority: 40, relationship 系统写入）
              + 价值观（priority: 50, values 系统写入）
```

每个系统只管自己那段，互不干涉。priority 值越小越靠前。

---

## 11. 分阶段路线图

每个 Phase 内按模块拆分，每个模块下有编号小步骤。每步大约半天到一天工作量，做完即可看到效果。

### 依赖关系总览

```
Phase 1（已完成）
    ↓
  模块 A（工具扩展）    模块 B（基础设施）  ← 可穿插做，互不依赖
                           ↓
                     B3（虚拟人管理）+ B6（模块化系统基座）
                           ↓
              模块 C（内在系统实现）← 依赖 B3 + B6
              模块 D（记忆系统实现）← 建议 C 之后做
                    ↓
              模块 E（多 Agent + 感知层）← 依赖 D
              模块 F（关系与权限）← 依赖 E
                    ↓
              模块 G（自主行为与成长 + 表达层）← 依赖 F
                    ↓
              Phase 5（平台化）← 到时再细拆
```

---

### Phase 1 — 最小可运行 ✅ 已完成

一个能对话、能执行 bash 的 Web agent。

- [x] Monorepo 骨架（npm workspaces, tsconfig）
- [x] `packages/core`：agent 循环（async generator）+ BashTool + AnthropicProvider
- [x] `packages/db`：SQLite + Drizzle ORM + 基础 schema
- [x] `apps/web`：Next.js App Router + SSE 流式对话

---

### Phase 2 — 工具 + 基础设施 + 性格 + 记忆

#### 模块 A：工具扩展

> 无依赖，立刻可做。每加一个工具，agent 就多一项能力。

- [ ] **A1 FileReadTool** — agent 能读取指定文件内容
  - 效果：聊天里让 agent 读文件，它会用这个工具而不是 bash cat
- [ ] **A2 FileWriteTool** — agent 能创建/写入文件
  - 效果：让 agent 帮你写个文件，它直接写而不是 echo >
- [ ] **A3 WebFetchTool** — agent 能抓取网页内容
  - 效果：给 agent 一个 URL，它能读取网页正文
- [ ] **A4 工具自动发现** — 新工具文件放进 tools/ 即自动注册，不用手动传数组
  - 参考：hermes-agent `tools/registry.py` 自注册模式
  - 效果：以后加工具只写一个文件，不改任何其他代码

#### 模块 B：基础设施补全

> 无依赖，和模块 A 可穿插做。补全 Phase 1 缺的基础功能。

- [x] **B1 多会话支持** — 前端侧边栏显示会话列表，可新建/切换/删除会话
  - 后端：`GET /api/sessions`、`POST /api/sessions`、`DELETE /api/sessions/:id`
  - 效果：不再只有一个写死的 Default Chat
- [x] **B2 Observer 调试面板** — 观测每轮 AI 实际收到的输入、工具循环、token 等
  - 新表 `llm_calls`：存每次 provider.complete 前后的完整 request/response 快照
  - runAgent 增加 observer hook，可按开关启用（默认关，`OBSERVER_ENABLED=1` 启用）
  - 前端：聊天页内联抽屉看当前轮 + 独立 `/observer` 页做历史回放
  - 两层嵌套：用户消息 → 内部多次 LLM 调用 → 每次调用的 system/tools/messages/response
  - 效果：能看清 AI 每一步到底收到了什么、循环了几轮
- [ ] **B3 虚拟人管理** — 创建/编辑/删除虚拟人的界面和 API
  - 后端：`POST/GET/PATCH/DELETE /api/agents`
  - 前端：虚拟人列表页 + 创建/编辑表单（含模块选择面板）
  - agents 表新增 `modules` JSON 字段，存储每个虚拟人的模块方案选择
  - 效果：首页能看到所有虚拟人，创建时可配置模块，点进去能聊天
- [ ] **B4 中断机制** — 用户能取消正在进行的回复
  - AbortController 贯穿 agent 循环 + 工具执行
  - 前端加"停止"按钮
  - 参考：claude-code `src/utils/abortController.ts`
  - 效果：长回复或卡住时可以随时喊停
- [ ] **B5 上下文压缩** — 对话太长时自动压缩历史消息，不爆 token
  - 作为 compaction 系统的 `summary` 方案实现（实现 AgentSystem 接口）
  - 先实现最简单的一层：消息数超过阈值 → LLM 摘要压缩旧消息
  - 参考：claude-code 四层 compaction（auto/reactive/snip/micro），先只做 auto
  - 效果：长对话不再报错
- [ ] **B6 模块化系统基座** — TurnContext + AgentSystem 接口 + Registry + Runner 改造
  - 新包 `packages/systems/`：AgentSystem 接口、TurnContext 类型、systemRegistry
  - 改造 `runAgent()`：在 LLM 调用前后插入生命周期钩子（beforeTurn/beforeLLM/afterLLM/afterTurn）
  - 每个系统类型先实现 `noop` 方案（关闭态）
  - 前端：虚拟人创建/编辑页加模块选择面板（下拉选方案）
  - 效果：agent 循环支持可插拔系统，加新系统只需新文件 + registry 一行

#### 模块 C：内在系统实现

> 依赖 B3（虚拟人管理）+ B6（模块化基座）。每个系统实现 AgentSystem 接口。

- [ ] **C1 Personality — big-five 方案** — Big Five 五大特质 + 说话风格 + 背景故事
  - 实现 AgentSystem 接口，beforeLLM 阶段注入性格描述到 promptFragments
  - 参数存 agents.personality JSON 字段
  - 前端：性格编辑器（5 个 Big Five 滑块 + 说话风格 + 背景故事）
  - 效果：同样的问题，不同性格的虚拟人回答风格不同
- [ ] **C2 Emotion — dimensional 方案** — 维度模型（mood/energy/stress）
  - 实现 AgentSystem 接口，beforeTurn 读状态 → afterLLM 分析更新 → afterTurn 持久化
  - emotion_states 表（agentId, state JSON, trigger, createdAt）
  - 时间衰减：心情自然回归基线
  - 效果：骂它会不开心，夸它会开心，过一阵自己恢复
- [ ] **C3 Relationship — multi-dim 方案** — 多维关系（trust/affinity/familiarity/respect）
  - 实现 AgentSystem 接口，beforeTurn 加载关系 → afterTurn 更新
  - relationships 表（fromId, toId, dimensions JSON, history JSON）
  - 效果：虚拟人对"老朋友"和"陌生人"说话语气不同
- [ ] **C4 Values — priority-list 方案** — 价值观优先级列表
  - 实现 AgentSystem 接口，beforeLLM 注入价值观描述
  - 效果：虚拟人在冲突场景下按价值观排序做决策

#### 模块 D：记忆系统实现

> 独立模块，建议在 C 之后做（这样性格+记忆可以同时注入 system prompt）。

- [ ] **D1 Memory — sqlite 方案** — 本地关键词搜索记忆
  - 实现 AgentSystem 接口，afterTurn 存对话 → beforeTurn 检索相关记忆
  - memories 表（agentId, content, summary, tags, createdAt）
  - 效果：虚拟人能记住聊过的事，简单版
- [ ] **D2 Memory — chromadb 方案** — 向量语义检索记忆
  - Python + ChromaDB 独立服务，主项目通过 HTTP/MCP 调用
  - 宫殿结构：Wing（人/项目）→ Room（时间/话题）→ Drawer（原文）
  - 4 层渐进加载（L0 身份 → L1 精华 → L2 按需 → L3 深搜）
  - 参考：mempalace `palace.py`、`searcher.py`
  - 效果：虚拟人"记住"你是谁，语义检索找到相关记忆
- [ ] **D3 MemorySearchTool** — agent 主动搜索自己的记忆
  - agent 在对话中可以调用这个工具检索过去的对话
  - 效果：问"我之前跟你说过什么"，agent 能搜到
- [ ] **D4 记忆管理 UI** — 网页上查看/搜索/删除虚拟人的记忆
  - 按 Wing/Room 浏览，支持关键词搜索
  - 效果：你能看到虚拟人记住了什么，删掉不想要的

---

### Phase 3 — 多 Agent + 关系

#### 模块 E：多 Agent 运行

> 依赖模块 D（记忆系统）。让多个虚拟人共存并支持不同 LLM。

- [ ] **E1 OpenAI Provider** — 支持 GPT-4o 等 OpenAI 模型
  - 实现 LLMProvider 接口的 OpenAI 版本
  - 效果：创建虚拟人时可以选 Claude 或 GPT
- [ ] **E2 Ollama Provider** — 支持本地模型（Llama、Qwen 等）
  - 效果：不联网也能跑虚拟人
- [ ] **E3 Model fallback 链** — 主模型失败自动切备用模型
  - 参考：openclaw `model-fallback.ts`
  - 效果：API 偶尔出错不会直接挂
- [ ] **E4 消息总线** — agent 之间能发消息
  - 先做 InMemoryMessageBus，后面升级 SQLite 持久化
  - 接口：send(to, message)、subscribe(agentId, handler)
  - 效果：两个虚拟人能"对话"
- [ ] **E5 SpawnAgentTool** — 一个 agent 能启动另一个帮忙
  - 深度限制 2 层，子 agent 工具白名单，只返回结果摘要
  - 参考：hermes-agent `delegate_tool.py`
  - 效果：虚拟人A可以叫虚拟人B帮忙查东西

#### 模块 F：关系与权限

> 依赖模块 E（多 Agent 要先跑通）。

- [ ] **F1 Agent 间关系** — 扩展 C3 关系系统，支持虚拟人之间的关系追踪
  - C3 已实现 user↔agent 关系，F1 扩展为 agent↔agent
  - 每次 agent 间交互后自动微调关系分数
  - 效果：两个虚拟人聊得越多越"熟"
- [ ] **F2 关系图谱可视化** — 网页上展示所有虚拟人之间的关系网络
  - 效果：可视化谁和谁关系好/差
- [ ] **F3 Hooks 系统** — 工具执行前后可拦截/修改/阻止
  - PreToolUse / PostToolUse 钩子
  - 参考：claude-code `toolHooks.ts`
  - 效果：可以拦截危险命令（比如 rm -rf）
- [ ] **F4 权限系统** — 工具分级：只读 / 可写 / 破坏性
  - Tool 接口加 isReadOnly()、isDestructive() 方法
  - 效果：可以限制某些虚拟人只能用只读工具

---

### Phase 4 — 自主行为与成长

#### 模块 G：自主行为与成长

> 依赖模块 F（需要关系系统和权限系统）。

- [ ] **G1 Cron 定时任务** — 虚拟人能设定期执行的任务
  - scheduled_tasks 表 + cron 表达式解析 + 定时触发
  - 参考：hermes-agent `cron/scheduler.py`、openclaw CronService
  - 效果：虚拟人每天早上给你发问候
- [ ] **G2 Daemon 独立进程** — agent 脱离 Next.js 独立运行
  - 主进程管理多个 agent worker
  - 效果：关掉网页虚拟人还活着
- [ ] **G3 自主行为引擎** — 虚拟人能主动做事
  - 主动问候（检测到用户长时间未互动）
  - 自我反思（定期回顾记忆，更新自我认知）
  - 关系维护（主动找其他虚拟人聊天）
  - 效果：你不说话，虚拟人也会找你聊
- [ ] **G4 成长系统** — 虚拟人性格随时间缓慢变化
  - 每 N 次对话触发成长检查 → LLM 分析交互历史 → 微调性格特质
  - growth_logs 表记录每次变化
  - 效果：虚拟人说"我觉得我最近变得更耐心了"
- [ ] **G5 技能自动创建** — 虚拟人从经验中学习技能
  - 每完成 N 次工具调用 → 提醒虚拟人"要不要存成技能"
  - 参考：hermes-agent skill nudge 机制
  - 效果：虚拟人越用越聪明

---

### Phase 5 — 平台化（到时再细拆）

**目标**：完整的虚拟人管理平台

- [ ] 插件/扩展系统（参考 openclaw manifest + loader + SDK 边界）
- [ ] 多平台网关（Telegram/Discord/Slack 等，参考 hermes-agent gateway adapter 模式）
- [ ] WebSocket 实时通信（agent 主动推送消息）
- [ ] Electron/Tauri 桌面应用打包
- [ ] 仪表盘 UI（运行状态、统计、成本追踪）
- [ ] 数据导入/导出
- [ ] 可选 PostgreSQL 支持

---

## 12. 参考来源

| 机制 | 参考项目 | 关键文件 |
|------|---------|---------|
| Agent 循环（async generator） | claude-code | `src/query.ts` — query() |
| 工具接口与调度 | claude-code | `src/Tool.ts`, `src/tools/` |
| 工具自注册 | hermes-agent | `tools/registry.py`, `model_tools.py` |
| 子代理生成（深度限制+工具白名单） | hermes-agent | `tools/delegate_tool.py` |
| Context compaction（四层） | claude-code | `src/services/compact/` (auto/reactive/snip/micro) |
| 中断/取消（AbortController） | claude-code | `src/utils/abortController.ts`, ToolUseContext |
| Hooks 系统 | claude-code | `src/services/tools/toolHooks.ts` |
| 技能自动创建（skill nudge） | hermes-agent | `tools/skill_manager_tool.py`, `run_agent.py` |
| 记忆异步预取 | hermes-agent | `agent/memory_manager.py` |
| 记忆系统（宫殿隐喻 + ChromaDB + 4 层加载） | mempalace | `mempalace/palace.py`, `mempalace/layers.py`, `mempalace/searcher.py` |
| 记忆系统（provider 抽象参考） | openclaw | `extensions/memory-core/`, `extensions/memory-lancedb/` |
| Gateway 控制面 | openclaw | `src/gateway/server.impl.ts` |
| 多平台网关（adapter 模式） | hermes-agent | `gateway/platforms/base.py`, 11 个 adapter |
| 插件系统 | openclaw | `src/plugins/loader.ts`, `src/plugin-sdk/` |
| Cron/定时任务 | hermes-agent / openclaw | `cron/scheduler.py` / `src/cron/` |
| Model fallback | openclaw | `src/agents/model-fallback.ts` |
| 消息总线模式 | learn-claude-code | s09-s10 JSONL mailbox protocol |
| 自主行为 | learn-claude-code | s11 autonomous agents (idle cycle + auto-claim) |
