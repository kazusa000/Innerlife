# Multi-Agent Virtual Persona System — Design Spec

> 最后校准：2026-04-20（单线程聊天、模块管理页、OpenRouter provider、values 移除）
>
> `STATUS.md` 记录“当前已经实现了什么”；本文件记录长期架构与路线图。两者冲突时，以 `STATUS.md` 作为现状，以本文件作为结构原则和后续方向。

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
| LLM 接入 | Provider 抽象层；当前已实现 Anthropic + OpenRouter | 聊天模型与模块子模型可独立配置，后续仍可继续扩展 |
| 数据持久化 | SQLite + Drizzle ORM（业务数据）| 轻量嵌入，查询能力强，未来可迁移 PostgreSQL |
| 记忆存储 | 当前 `sqlite` 本地记忆；未来可选 Python + ChromaDB 独立服务 | 先把轻量本地记忆打磨稳定，再引入独立向量服务 |
| 记忆组织 | 宫殿隐喻：Wing（人/项目）→ Room（时间/话题）→ Drawer（原文） | 按实体组织比按类型分更实用，参考 MemPalace |
| 记忆加载 | 4 层渐进（L0 身份 → L1 精华 → L2 按需 → L3 深搜） | 启动只花 ~600 token，不一次全塞 context |
| 模块化架构 | System Registry + Lifecycle Hooks，共享 TurnContext | 可插拔系统（感知/内在/行为/表达），每个虚拟人独立配置方案 |
| 感知层设计 | 子模型预处理管线，主模型只收文本 | 主模型不需要多模态能力，子模型可独立选型 |
| Agent 间通信 | 消息总线接口，先内存实现，后升级 SQLite | 渐进式 |
| Daemon 管理 | Phase 1 不需要；Phase 4 引入本地 Daemon v1 | 先把后台长期运行与记忆演化做起来，暂不提前服务化 |
| 进程模型 | 单进程 async 起步，预留 AgentRunner 接口支持 worker 子进程 | 渐进式 |
| 图灵测试 | 外部优先的异步评测任务系统，页面仅作工作台 | 先把可被 Codex/其他 AI 调用的 run/job 系统做稳，再提供页面控制台 |
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
│   │       │   ├── anthropic.ts # AnthropicProvider 实现
│   │       │   ├── openrouter.ts# OpenRouterProvider 实现
│   │       │   └── factory.ts   # 按 agent provider 解析 provider
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
│   ├── turing/                  # 图灵测试系统（外部优先评测任务）
│   │   ├── src/
│   │   │   ├── types.ts         # run / report / transcript / judge event 类型
│   │   │   ├── suite.ts         # 固定 6 段测试套件
│   │   │   ├── temp-agent.ts    # 临时测试 agent 复制与清理
│   │   │   ├── chat-executor.ts # 复用真实 runAgent 聊天链路
│   │   │   ├── runner.ts        # 图灵测试 runner（后台消费 queued run）
│   │   │   └── report.ts        # 报告整形与建议聚合
│   │   └── markdown/
│   │       ├── judge-rulebook.md
│   │       ├── suite-definition.md
│   │       ├── abort-criteria.md
│   │       └── report-rubric.md
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
│           └── repository/      # 数据访问层（含 turing run / event repo）
│
├── apps/
│   └── web/                     # Next.js 应用
│       └── src/
│           ├── app/
│           │   ├── page.tsx                    # 首页 — persona 列表 + 创建/编辑
│           │   ├── chat/page.tsx               # 对话界面（按 agent 进入，单线程心智）
│           │   ├── observer/page.tsx           # Observer 历史回放
│           │   └── agent/[id]/
│           │       ├── personality/page.tsx    # personality 管理入口
│           │       ├── emotion/page.tsx        # emotion 管理入口
│           │       ├── relationships/page.tsx  # relationship 管理入口
│           │       ├── memory/page.tsx         # memory 管理入口
│           │       └── turing/page.tsx         # 图灵测试工作台
│           └── app/api/
│               ├── agents/                     # CRUD + active-session + 模块管理 API
│               ├── sessions/                   # 会话历史/调试读取
│               ├── turing/                     # 图灵测试 run / events / cleanup API
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

| Provider | 当前状态 | 说明 |
|----------|---------|------|
| AnthropicProvider | 已实现 | @anthropic-ai/sdk，流式调用 |
| OpenRouterProvider | 已实现 | OpenAI-compatible chat completions；支持工具调用与 reasoning 参数 |
| OpenAIProvider | 未来可选 | 如需直连 OpenAI，再单独增加 |
| OllamaProvider | 未来可选 | 本地模型支持，HTTP API |
| Model fallback 链 | 未来可选 | 参考 openclaw runWithModelFallback() |
| Token 计数与成本追踪 | 未来可选 | 按 provider 计费规则 |

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
  personality TEXT (legacy)          -- 早期字段；当前模块配置统一收敛到 modules JSON
  skills      TEXT (JSON)            -- 技能文件路径列表，如 ["skills/cooking.md", "skills/finance.md"]
  status      TEXT ('idle' | 'running' | 'error')
  model       TEXT NOT NULL
  modules     TEXT (JSON)            -- 模块配置与方案（如 personality/emotion/relationship/memory）
  config      TEXT (JSON)            -- 运行时配置（当前主要存 provider，后续可扩工具/上限等）
  createdAt   INTEGER
  updatedAt   INTEGER

sessions                             -- 内部对话章节边界；不再作为前端主操作对象
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

### 7.3 可选 chromadb 记忆方案（未来，独立于 SQLite）

当前默认记忆方案是 `memory:sqlite`，真实数据仍落在主库 `memories` 表中。下面这套 ChromaDB 方案是**后续可选扩展**，不是当前默认实现。

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

### 7.4 当前已落地 / 计划中的 SQLite Schema 扩展

```
memories                              -- 当前 sqlite 记忆方案
  id          TEXT PRIMARY KEY
  agentId     TEXT FK → agents.id
  sessionId   TEXT FK → sessions.id
  content     TEXT
  summary     TEXT
  tags        TEXT (JSON)
  importance  REAL
  createdAt   INTEGER

llm_calls                             -- Observer 快照
  id          TEXT PRIMARY KEY
  sessionId   TEXT FK → sessions.id
  userMessageId TEXT FK → messages.id
  turnIndex   INTEGER
  kind        TEXT ('turn' | 'compaction' | 'memory' | 'emotion' | 'relationship')
  model       TEXT
  systemPrompt TEXT
  toolsJson   TEXT
  messagesJson TEXT
  metadataJson TEXT
  responseJson TEXT
  stopReason  TEXT
  inputTokens INTEGER
  outputTokens INTEGER
  startedAt   INTEGER
  finishedAt  INTEGER
  error       TEXT

emotion_states                         -- 当前情绪状态持久化
  id          TEXT PRIMARY KEY
  agentId     TEXT FK → agents.id
  sessionId   TEXT FK → sessions.id
  state       TEXT (JSON)             -- { mood, energy, valence, arousal, ... }
  delta       TEXT (JSON)
  trigger     TEXT                    -- 触发原因
  createdAt   INTEGER

relationships                         -- 当前 user ↔ agent 关系状态
  id          TEXT PRIMARY KEY
  agentId     TEXT FK → agents.id
  counterpartType TEXT                -- 当前只支持 'user'
  counterpartId TEXT                  -- 当前默认 'default-user'
  dimensions  TEXT (JSON)             -- { trust, affinity, familiarity, respect }
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
| `/chat?agent=<id>` | 对话界面 — 始终代表“我和这个 persona 的当前对话” | 1 |
| `/observer` | Observer 历史回放与调试页 | 1 |
| `/agent/[id]/personality` | personality 管理统一入口 | 2 |
| `/agent/[id]/emotion` | emotion 管理统一入口 | 2 |
| `/agent/[id]/memory` | 记忆管理统一入口（按当前 scheme 进入对应管理子系统） | Phase 2 |
| `/agent/[id]/relationships` | 关系管理统一入口（按当前 scheme 进入对应管理子系统 / 图谱视图） | Phase 3 |
| `/agent/[id]/turing` | 图灵测试工作台（报告 / 运行控制台 / 回放） | Phase 4 |
| `/dashboard` | 仪表盘（运行状态、统计、成本） | Phase 5 |

### 8.2 API 端点

```
# Phase 1
POST   /api/agents                创建虚拟人（agent = 虚拟人）
GET    /api/agents                列出所有虚拟人
GET    /api/agents/:id            获取详情
PATCH  /api/agents/:id            更新配置/人格
DELETE /api/agents/:id            删除虚拟人

GET    /api/sessions              列出会话（当前主要供 Observer/调试使用）
DELETE /api/sessions/:id          删除会话（维护/调试接口）

POST   /api/agents/:id/active-session
       解析该 persona 当前 active session；如果没有则内部创建一个

POST   /api/chat                  发送消息
       Body: { sessionId, message }
       Response: SSE stream（逐事件推送 AgentEvent）

# Phase 2+
GET    /api/agents/:id/memory                     记忆管理入口元信息（当前 scheme / 可用能力）
GET    /api/agents/:id/memory/sqlite             sqlite 记忆列表 / 搜索
DELETE /api/agents/:id/memory/sqlite/:memoryId   删除 sqlite 记忆
POST   /api/agents/:id/memory/sqlite/consolidate 手动整理 sqlite 记忆
GET    /api/agents/:id/emotion                   情感管理入口元信息（当前 scheme / 可用能力）
GET    /api/agents/:id/emotion/dimensional       dimensional 情绪详情 / 历史 / 参数
GET    /api/agents/:id/personality               personality 管理入口元信息（当前 scheme / 可用能力）
GET    /api/agents/:id/personality/big-five      big-five 性格详情 / 参数

# Phase 3+
POST   /api/agents/:id/start         启动 agent
POST   /api/agents/:id/stop          停止 agent
GET    /api/agents/:id/relationships                 关系管理入口元信息（当前 scheme / 可用能力）
GET    /api/agents/:id/relationships/multi-dim      multi-dim 关系详情 / 历史 / 图谱数据

# Phase 4+
POST   /api/scheduled-tasks           创建定时任务
GET    /api/scheduled-tasks           列出定时任务
PATCH  /api/scheduled-tasks/:id       更新/暂停任务

POST   /api/turing/runs               创建图灵测试 run
GET    /api/turing/runs/:id           获取 run 状态 / 报告 / transcript
GET    /api/turing/runs/:id/events    获取结构化事件流（供工作台只读控制台使用）
POST   /api/turing/runs/:id/cleanup   一键清理本次测试全部数据

# Phase 5+
GET    /api/dashboard/stats           运行统计
GET    /api/dashboard/costs           成本追踪
WebSocket /ws                         实时通信（agent 主动推送）
```

### 8.3 流式对话数据流

```

### 8.4 图灵测试工作台

图灵测试页不是聊天页变种，而是一个评测工作台。它只负责：

- 发起一次图灵测试 run
- 查看 run 当前状态
- 阅读报告
- 观察后台执行日志
- 回看完整对话与 Observer 证据
- 一键清理本次 run

页面布局固定为四区：

- 顶部：来源 persona、run 状态、开始测试、清理 run
- 左侧：评测报告
- 右侧：只读后台“命令行状态台”
- 底部：完整对话回放与证据入口

右侧“命令行状态台”不是网页 shell，也不允许输入命令。它只是把结构化 runner 事件按日志形式实时渲染出来，帮助用户判断：

- 当前进行到哪一段测试
- 是否插入了测试记忆 / 情绪状态 / 关系状态
- 是否触发可疑项或红线
- 是否正在生成报告

### 8.5 图灵测试 API 语义

图灵测试系统遵循“外部优先”的原则：核心是异步 run/job 系统，页面只是这些接口的可视化壳。

一次 run 的流程是：

1. 调用 `POST /api/turing/runs`
2. 系统创建 `queued` run
3. 后台 runner 消费该 run，复制 persona 并创建临时测试 agent
4. 按固定 6 段测试套件执行
5. 若触发红线，立即中断
6. 写入 report / transcript / events
7. 页面与外部 AI 通过 detail / events 接口读取结果
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

### 10.2.1 模块管理入口与 scheme 分发规则

所有模块的**管理 UI 入口只有一个**，但入口后面的管理系统按 `scheme` 严格分流：

- `memory` 固定入口：`/agent/[id]/memory`
- `relationship` 固定入口：`/agent/[id]/relationships`
- 未来其他模块也遵守同样模式（如 `/agent/[id]/emotion`）

入口层只负责三件事：

1. 读取 `agents.modules.<type>.scheme`
2. 渲染当前 scheme 对应的管理子系统，或在 `noop` / 未配置 / 未支持时显示空状态
3. 提供稳定 URL，让用户始终从同一个位置进入该模块

**不做**：

- 不在入口层混用不同 scheme 的数据
- 不定义“跨 scheme 通用记忆池 / 通用关系池”
- 不要求不同 scheme 共享同一套 CRUD 语义或同一份展示组件

也就是说：**统一的是入口，不是内部实现。**

后端 API 也遵循同样原则：可以共享前缀，但真正的数据操作走各自 scheme 的子路由，例如：

- `/api/agents/:id/memory/sqlite/*`
- `/api/agents/:id/memory/chromadb/*`
- `/api/agents/:id/relationships/multi-dim/*`

不同 scheme 的存储、查询、管理 UI、操作按钮、字段形状都允许完全不同；只要求入口层和 `modules.<type>.scheme` 配置保持稳定。

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

当前 big-five 参数直接放在 `agents.modules.personality` 里，与 scheme 一起持久化；不再单独维护 `agents.personality` 作为主入口。

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

持久化：`emotion_states` 表（agentId, sessionId, state JSON, delta, trigger, createdAt）

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

持久化：`relationships` 表（agentId, counterpartType, counterpartId, dimensions JSON, history JSON, updatedAt）

关系系统的管理入口固定为 `/agent/[id]/relationships`。入口页只负责根据 `agents.modules.relationship.scheme` 分发到对应管理子系统；`simple`、`multi-dim`、未来的新方案彼此独立，不共享同一套管理视图或数据语义。

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

记忆系统的管理入口固定为 `/agent/[id]/memory`。D4 第一版只实现 `memory:sqlite` 的管理子系统，但入口路径和分发方式从第一天就按多架构设计：

- 入口页读取 `agents.modules.memory.scheme`
- `scheme = "sqlite"` → 进入 sqlite 记忆管理子系统
- `scheme = "chromadb"` → 将来进入 chromadb 记忆管理子系统
- `scheme = "noop"` 或未配置 → 显示空状态 / 引导启用

不同记忆方案的数据、浏览方式、搜索方式、清理方式完全独立；**不会**把 sqlite 记忆和 chromadb 记忆混在一起显示或互相复用管理逻辑。

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

#### 记忆生命周期（三层）

记忆在长期设计上不再只看作“一张 memories 表”，而是拆成三条职责明确的路径：

- **Context**：当前回合直接进入 prompt 的活上下文。它服务当下回答，生命周期最短，不追求长期持久化语义。
- **Short-term memory（STM）**：由最近若干轮对话、章节压缩、短期印象组成。它比 context 稳定，但仍允许被合并、重写、淘汰。
- **Long-term memory（LTM）**：经过筛选和整理后沉淀下来的长期记忆。它服务“这个虚拟人长期记得什么”，而不是“这几轮刚聊了什么”。

这三层的核心不是一次请求内同步完成，而是通过后台长期运行逐步搬运：

```
当前对话/上下文
      │
      ▼
Context（即时使用）
      │
      ▼
STM（章节/近期压缩）
      │
      ▼
LTM（长期沉淀）
```

当前主线已经把这条链路的第一版落地：

- `context` 只作为 session 活跃消息窗口存在，不进入 memory 表，也不参与检索
- `context -> STM` 由 daemon 在空闲或超窗时后台搬运，从最早完整回合块中提炼最多 N 条 `short_term`
- `STM -> LTM` 由 daemon 每日一次“睡眠”任务沉淀
- `fixed` 第一版仍通过后台手动从 `long_term` 提升
- 主对话每轮只前置检索 `short_term + fixed`；`long_term` 改为按需 tool 深搜

也就是说，sqlite 记忆现在已经不是“一张 memories 表 + 每轮 afterTurn 直接写入”的形态，而是进入了后台持续搬运的分层流水线阶段。

### 10.8 后台层 — Daemon 与记忆演化（Phase 4）

模块 G 的核心不再是先做“主动行为”，而是先建立一个**本地长期运行的后台 Daemon**。这个 Daemon 的第一职责不是主动找人聊天，而是持续处理记忆演化和后台任务。

Daemon v1 的目标：

- 本地单进程常驻
- heartbeat / status / 最近错误
- 固定 tick loop
- 扫描并执行后台任务
- 为记忆分层搬运提供长期运行环境

Phase 4 的第一版里，daemon 优先服务：

- Context → STM 的压缩与归档
- STM → LTM 的筛选、整理、沉淀
- 计划任务 / 定时触发的后台执行

它之后才承载更强的自主行为。

### 10.9 后台层 — 自主行为引擎（Phase 4+）

参考 openclaw 的 Cron + Heartbeat 模式，但把它放在 daemon 建好之后：

```
Daemon tick → 检查后台任务 / 计划任务 → 符合条件？
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

自主行为是 daemon 的上层能力，不再是 Phase 4 的第一落点。第一批自主行为可以包括：
- 主动问候（检测到用户长时间未互动）
- 自我反思（定期回顾记忆，更新自我认知）
- 关系维护（主动联络关系中的其他虚拟人）
- 日程执行（用户或虚拟人自己安排的任务）

### 10.10 行为层 — 成长/进化系统（Phase 4+）

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

### 10.11 System Prompt 动态组装

runner 在 `beforeLLM` 阶段收集所有系统的 promptFragments，按 priority 排序拼接：

```
system prompt = 基础指令（priority: 0）
              + 性格描述（priority: 10, personality 系统写入）
              + 当前情感（priority: 20, emotion 系统写入）
              + 相关记忆（priority: 30, memory 系统写入）
              + 关系上下文（priority: 40, relationship 系统写入）
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
              模块 G（Daemon 与后台记忆演化）← 依赖 F
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

- [x] **B1 Session 持久化与章节边界** — 底层保留 session，前端主聊天收敛为单 persona 单对话
  - 后端：`GET /api/sessions`、`DELETE /api/sessions/:id`、`POST /api/agents/:id/active-session`
  - 效果：session 仍作为内部章节边界存在，但网页端不再提供新建/切换/删除 session 的主交互
- [x] **B2 Observer 调试面板** — 观测每轮 AI 实际收到的输入、工具循环、token 等
  - 新表 `llm_calls`：存每次 provider.complete 前后的完整 request/response 快照
  - runAgent 增加 observer hook，可按开关启用（默认关，`OBSERVER_ENABLED=1` 启用）
  - 前端：聊天页内联抽屉看当前轮 + 独立 `/observer` 页做历史回放
  - 两层嵌套：用户消息 → 内部多次 LLM 调用 → 每次调用的 system/tools/messages/response
  - 效果：能看清 AI 每一步到底收到了什么、循环了几轮
- [x] **B3 虚拟人管理** — 创建/编辑/删除虚拟人的界面和 API
  - 后端：`POST/GET/PATCH/DELETE /api/agents`
  - 前端：虚拟人列表页 + 创建/编辑表单（含模块选择面板）
  - agents 表新增 `modules` JSON 字段，存储每个虚拟人的模块方案选择
  - 效果：首页能看到所有虚拟人，创建时可配置模块，点进去能聊天
- [x] **B4 中断机制** — 用户能取消正在进行的回复
  - AbortController 贯穿 agent 循环 + 工具执行
  - 前端加"停止"按钮
  - 参考：claude-code `src/utils/abortController.ts`
  - 效果：长回复或卡住时可以随时喊停
- [x] **B5 上下文压缩** — 对话太长时自动压缩历史消息，不爆 token
  - 作为 compaction 系统的 `summary` 方案实现（实现 AgentSystem 接口）
  - 先实现最简单的一层：消息数超过阈值 → LLM 摘要压缩旧消息
  - 参考：claude-code 四层 compaction（auto/reactive/snip/micro），先只做 auto
  - 效果：长对话不再报错
- [x] **B6 模块化系统基座** — TurnContext + AgentSystem 接口 + Registry + Runner 改造
  - 新包 `packages/systems/`：AgentSystem 接口、TurnContext 类型、systemRegistry
  - 改造 `runAgent()`：在 LLM 调用前后插入生命周期钩子（beforeTurn/beforeLLM/afterLLM/afterTurn）
  - 每个系统类型先实现 `noop` 方案（关闭态）
  - 前端：虚拟人创建/编辑页加模块选择面板（下拉选方案）
  - 效果：agent 循环支持可插拔系统，加新系统只需新文件 + registry 一行

#### 模块 C：内在系统实现

> 依赖 B3（虚拟人管理）+ B6（模块化基座）。每个系统实现 AgentSystem 接口。

- [x] **C1 Personality — big-five 方案** — Big Five 五大特质 + 说话风格 + 背景故事
  - 实现 AgentSystem 接口，beforeLLM 阶段注入性格描述到 promptFragments
  - 参数现存 `agents.modules.personality`
  - 前端：性格编辑器（5 个 Big Five 滑块 + 说话风格 + 背景故事）
  - 效果：同样的问题，不同性格的虚拟人回答风格不同
- [x] **C2 Emotion — dimensional 方案** — 维度模型（mood/energy/stress）
  - 实现 AgentSystem 接口，beforeTurn 读状态 → afterLLM 分析更新 → afterTurn 持久化
  - emotion_states 表（agentId, sessionId, state JSON, delta, trigger, createdAt）
  - 时间衰减：心情自然回归基线
  - 效果：骂它会不开心，夸它会开心，过一阵自己恢复
- [x] **C3 Relationship — multi-dim 方案** — 多维关系（trust/affinity/familiarity/respect）
  - 实现 AgentSystem 接口，beforeTurn 加载关系 → afterTurn 更新
  - relationships 表（agentId, counterpartType, counterpartId, dimensions JSON, history JSON）
  - 本 task 只做 `relationship:multi-dim` 方案本身；统一入口 `/agent/[id]/relationships` 与其他 scheme 的管理子系统后续独立落地
  - 效果：虚拟人对"老朋友"和"陌生人"说话语气不同
- [removed] **C4 Values — priority-list 方案**
  - values 系统已从当前产品方向移除，不再作为 active runtime 模块推进

#### 模块 D：记忆系统实现

> 独立模块，建议在 C 之后做（这样性格+记忆可以同时注入 system prompt）。

- [x] **D1 Memory — sqlite 方案** — 本地关键词搜索记忆
  - 实现 AgentSystem 接口，afterTurn 存对话 → beforeTurn 检索相关记忆
  - memories 表（agentId, content, summary, tags, importance, createdAt）
  - 效果：虚拟人能记住聊过的事，简单版
- [removed] **D1a Memory tags 中英双语**
  - 当前方向已改为“按当前对话语言生成 tags”，不再走中英双语 tags 路线
- [x] **D1b Memory 检索 query 扩展** — LLM 替代简单 tokenizer
  - 检索前一次轻量 LLM call（走 pending-X pattern，runner 执行），输出 `{"keywords":[...], "time_range": ... | null}`
  - query 失败时直接跳过本轮记忆注入，不再回退本地 tokenizer；Observer 复用 `kind: 'memory'`，`metadata.phase: 'retrieve'` 区分 summarize / retrieve
- [x] **D1c Memory 记忆整理** — 手动触发清洗 + 去重 + 重估 importance
  - **仅针对 sqlite scheme**，URL 显式写死：`POST /api/agents/:id/memory/sqlite/consolidate`
  - 逻辑全在 `MemorySqliteSystem` 内，不抽跨 scheme 接口；D2 上线时完全独立（自己开 `/memory/chromadb/consolidate` 或不做）
  - 整理范围：该 agent 全部 memories 一次过，上限默认 100（超了 400 拒绝提示用户手动分批）
  - 写回语义：单条 rewrite → `UPDATE` 保留 `id` + `createdAt`；多条合并 → `INSERT` 新条目（`createdAt` 取源中最早的）+ `DELETE` 源条目
  - 不限成本；无 cron / 自动触发；UI 按钮等 D4 再挂
- [ ] **D2 Memory — chromadb 方案** — 向量语义检索记忆
  - Python + ChromaDB 独立服务，主项目通过 HTTP/MCP 调用
  - 宫殿结构：Wing（人/项目）→ Room（时间/话题）→ Drawer（原文）
  - 4 层渐进加载（L0 身份 → L1 精华 → L2 按需 → L3 深搜）
  - 参考：mempalace `palace.py`、`searcher.py`
  - 效果：虚拟人"记住"你是谁，语义检索找到相关记忆
- [ ] **D3 MemorySearchTool** — agent 主动搜索自己的记忆
  - agent 在对话中可以调用这个工具检索过去的对话
  - 效果：问"我之前跟你说过什么"，agent 能搜到
- [x] **D4 记忆管理 UI** — 统一入口 + `sqlite` 记忆管理子系统
  - 路由固定为 `/agent/[id]/memory`，入口层按当前 `memory.scheme` 分发
  - 第一版只实现 `memory:sqlite` 的查看 / 搜索 / 删除 / consolidate 触发；`chromadb` 以后单独接到同一个入口下
  - 不同 scheme 记忆不互通、不混显、不抽统一 CRUD 语义
  - 效果：你能从固定入口进入当前记忆架构对应的管理界面，看到虚拟人记住了什么，并执行该架构自己的管理动作

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

### Phase 4 — Daemon 与后台记忆演化

#### 模块 G：Daemon 与后台记忆演化

> 依赖模块 F（需要关系系统和权限系统）。

- [x] **G1 Daemon v1** — 本地独立常驻进程
  - 单进程 daemon + heartbeat + status + tick loop
  - 负责后台任务执行，不依赖浏览器页面存活
  - 效果：关掉网页后，后台记忆搬运与计划任务仍能继续
- [ ] **G2 Scheduler / 后台任务循环** — daemon 能定时扫描并执行任务
  - scheduled_tasks 表 + next_run_at / backoff / enabled
  - 参考：hermes-agent `cron/scheduler.py`、openclaw CronService
  - 效果：后台任务有统一调度入口，而不是零散挂在请求链路里
- [x] **G3 记忆三层演化** — Context / STM / LTM 后台搬运
  - Context → STM：章节压缩、近期对话归档、短期印象形成
  - STM → LTM：筛选高价值记忆、合并重复片段、沉淀长期事实
  - 效果：虚拟人逐步“消化经历”，而不是只靠当前上下文硬撑
- [ ] **G4 自主行为 v1** — daemon 上承载第一批主动行为
  - 主动问候（检测到用户长时间未互动）
  - 自我反思（定期回顾记忆，更新自我认知）
  - 日程执行（用户或虚拟人自己安排的任务）
  - 效果：你不说话，虚拟人也能在后台决定“现在该做什么”
- [ ] **G5 成长系统** — 虚拟人性格随时间缓慢变化
  - 每 N 次对话触发成长检查 → LLM 分析交互历史 → 微调性格特质
  - growth_logs 表记录每次变化
  - 效果：虚拟人说"我觉得我最近变得更耐心了"
- [ ] **G6 图灵测试系统 v1** — 外部优先的异步拟人感评测
  - `turing_test_runs` + `turing_test_events` 表，支持 queued / running / interrupted / completed / cleaned
  - 复制当前 persona 生成临时测试 agent，强制开启全部模块
  - 固定 6 段测试套件 + 固定 rulebook markdown
  - 后台 runner 逐段执行，允许插入测试记忆 / 情绪状态 / 关系状态
  - 触发红线立即中止并生成报告；同时保留 transcript、Observer 证据与只读事件流
  - 页面工作台挂在 `/agent/[id]/turing`，右侧提供“后台命令行状态台”，并支持一键清理整场测试数据

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
