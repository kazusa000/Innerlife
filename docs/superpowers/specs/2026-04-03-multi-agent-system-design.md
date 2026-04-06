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
| 数据持久化 | SQLite + Drizzle ORM | 轻量嵌入，查询能力强，未来可迁移 PostgreSQL |
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
│   ├── persona/                 # 人格系统（Phase 2+ 实现，挂载于 agent）
│   │   └── src/
│   │       ├── personality/     # 性格模型、说话风格、价值观
│   │       ├── memory/          # 长期记忆（对话摘要、语义检索）
│   │       ├── emotion/         # 情感状态机
│   │       ├── relationship/    # 关系图谱
│   │       ├── growth/          # 成长/进化系统
│   │       └── autonomy/        # 自主行为引擎
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

### 4.4 与 claude-code 的简化对比

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

### 7.3 Phase 2+ Schema 扩展

```
memories                              -- Phase 2: 长期记忆
  id          TEXT PRIMARY KEY
  agentId     TEXT FK → agents.id
  type        TEXT ('fact' | 'episode' | 'preference' | 'summary')
  content     TEXT
  embedding   BLOB                    -- 向量，语义检索用
  importance  REAL                    -- 重要性评分（衰减）
  sourceSessionId TEXT FK → sessions.id
  createdAt   INTEGER
  lastAccessedAt INTEGER

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

## 10. 人格系统设计（Phase 2+）

### 10.1 性格模型

```typescript
interface Personality {
  // Big Five 人格特质（0-1 范围）
  traits: {
    openness: number         // 开放性
    conscientiousness: number // 尽责性
    extraversion: number     // 外向性
    agreeableness: number    // 宜人性
    neuroticism: number      // 神经质
  }
  
  speakingStyle: {
    formality: number        // 正式程度
    verbosity: number        // 话多程度
    humor: number            // 幽默感
    emotionality: number     // 情感表达程度
    languagePatterns: string[] // 口头禅、常用表达
  }
  
  values: string[]           // 核心价值观
  background: string         // 背景故事
  quirks: string[]           // 独特小习惯
}
```

### 10.2 记忆系统

参考 openclaw 的 memory-core/memory-lancedb：

```
对话消息 → 摘要提取（LLM）→ 记忆条目 → 向量嵌入 → 存入 memories 表
                                                          │
查询时：用户新消息 → 嵌入 → 语义检索 top-k 记忆 → 注入 system prompt
```

记忆类型：
- **事实记忆**（fact）：用户偏好、个人信息
- **情景记忆**（episode）：重要对话片段
- **偏好记忆**（preference）：用户的喜好和习惯
- **摘要记忆**（summary）：长对话的浓缩

### 10.3 情感状态机

```
事件触发 → 情感更新函数 → 新状态
             │
             ├── 用户消息情感分析（LLM 判断）
             ├── 工具执行结果（成功/失败影响心情）
             └── 时间衰减（心情自然回归基线）

状态维度：
  mood:     -1.0 (悲伤) ─── 0 (平静) ─── 1.0 (快乐)
  energy:    0.0 (疲惫) ─── 1.0 (充沛)
  stress:    0.0 (放松) ─── 1.0 (焦虑)
```

情感影响回应方式：注入 system prompt 中的情感描述段，LLM 据此调整语气和用词。

### 10.4 关系图谱（Phase 3）

```
节点：虚拟人、用户
边：关系维度

关系维度（0-1）：
  trust       信任度
  affinity    亲密度
  familiarity 熟悉度
  respect     尊重度

更新机制：
  每次交互后 → 根据交互质量/内容 → 微调关系分数
  长期无交互 → 熟悉度自然衰减
```

### 10.5 自主行为引擎（Phase 4）

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

### 10.6 成长/进化系统（Phase 4）

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

### 10.7 System Prompt 动态组装

所有人格模块最终汇聚到 system prompt 的动态构建：

```
system prompt = 基础指令
              + 性格描述（来自 Personality 配置）
              + 当前情感状态（来自 emotion 状态机）
              + 相关记忆（来自语义检索的 top-k 记忆）
              + 关系上下文（与当前对话者的关系描述）
              + 成长状态（近期变化的自我认知）
```

---

## 11. 分阶段路线图

### Phase 1 — 最小可运行

**目标**：一个能对话、能执行 bash 的 Web agent

- [ ] Monorepo 骨架（npm workspaces, tsconfig, eslint）
- [ ] `packages/core`：agent 循环（async generator）+ BashTool + AnthropicProvider
- [ ] `packages/db`：SQLite + Drizzle ORM + 基础 schema（agents, sessions, messages, toolExecutions）
- [ ] `packages/persona`：空包占位，目录结构就位
- [ ] `apps/web`：Next.js App Router
  - [ ] 首页：虚拟人列表
  - [ ] 创建虚拟人页面
  - [ ] 对话界面（SSE 流式渲染）
  - [ ] API Routes（agents CRUD, sessions, chat）

### Phase 2 — 人格系统 + 多 Provider

**目标**：虚拟人有性格、有记忆、有情感；支持多种 LLM

- [ ] 性格模型实现（Personality 配置 → system prompt 注入）
- [ ] 长期记忆系统（对话摘要提取 → 向量嵌入 → 语义检索）
- [ ] 情感状态机（状态更新 → 时间衰减 → 影响回应）
- [ ] System prompt 动态组装（性格 + 情感 + 记忆）
- [ ] OpenAIProvider 实现
- [ ] OllamaProvider 实现（本地模型）
- [ ] Model fallback 链（参考 openclaw runWithModelFallback()）
- [ ] Token 计数与成本追踪
- [ ] 更多工具：FileReadTool, FileWriteTool, WebFetchTool, MemorySearchTool
- [ ] 上下文压缩（参考 claude-code 四层 compaction：auto 87%触发 → reactive API错误重试 → snip 截断中间 → micro 清理旧工具输出）
- [ ] 中断/取消机制（AbortController 贯穿 agent 循环 + 工具执行，用户可随时终止）
- [ ] 人格编辑器 UI（性格滑块、背景故事编辑）
- [ ] 记忆管理 UI
- [ ] memories / emotions schema 迁移

### Phase 3 — 多 Agent、关系与 Daemon

**目标**：多个虚拟人共存、交互、建立关系；agent 脱离 Web 独立运行

- [ ] Daemon 独立进程（主进程 + worker 子进程架构，脱离 Next.js）
- [ ] 多 agent 实例管理（AgentRunner 接口实现）
- [ ] 进程模型升级（单进程 → 可选 worker 子进程隔离）
- [ ] 消息总线升级（InMemoryMessageBus → SQLiteMessageBus）
- [ ] Agent 间通信（SendMessageTool, SpawnAgentTool）
- [ ] 关系图谱（relationships schema + 关系更新机制）
- [ ] Hooks 系统（PreToolUse/PostToolUse 钩子，可拦截/修改/阻止工具执行，参考 claude-code toolHooks.ts）
- [ ] 权限系统（Tool.checkPermissions, isReadOnly, isDestructive）
- [ ] 输入校验（Tool.validateInput）
- [ ] 关系图谱可视化 UI
- [ ] Agent 管理 UI（启动/停止/监控）

### Phase 4 — 自主行为与成长

**目标**：虚拟人能自主行动、随时间进化

- [ ] Cron/定时任务系统（参考 openclaw CronService）
- [ ] Heartbeat 机制（定期唤醒检查任务）
- [ ] 自主行为引擎（主动问候、自我反思、关系维护）
- [ ] 成长/进化系统（交互分析 → 性格微调 → growth_logs）
- [ ] 工具并发执行（isConcurrencySafe 标记 + 并行调度）
- [ ] ScheduleTaskTool（虚拟人自主安排任务）
- [ ] scheduled_tasks / growth_logs schema 迁移

### Phase 5 — 平台化

**目标**：完整的虚拟人管理平台

- [ ] 插件/扩展系统（参考 openclaw manifest + loader + SDK 边界）
- [ ] Feature flag 系统（动态启用/禁用功能）
- [ ] WebSocket 实时通信（agent 主动推送消息、状态变更）
- [ ] Electron/Tauri 桌面应用打包
- [ ] 仪表盘 UI（运行状态、工具统计、成本追踪、agent 活动日志）
- [ ] 数据导入/导出
- [ ] 可选 PostgreSQL 支持（Drizzle 切换 driver）

---

## 12. 参考来源

| 机制 | 参考项目 | 关键文件 |
|------|---------|---------|
| Agent 循环（async generator） | claude-code | `src/query.ts` — query() |
| 工具接口与调度 | claude-code | `src/Tool.ts`, `src/tools/` |
| 子代理生成 | claude-code | `src/tools/AgentTool/runAgent.ts` |
| Context compaction（四层） | claude-code | `src/services/compact/` (auto/reactive/snip/micro) |
| 中断/取消（AbortController） | claude-code | `src/utils/abortController.ts`, ToolUseContext |
| Hooks 系统 | claude-code | `src/services/tools/toolHooks.ts` (650+ 行) |
| Feature flags | claude-code | `bun:bundle` feature() 系统 |
| Gateway 控制面 | openclaw | `src/gateway/server.impl.ts` |
| 插件系统 | openclaw | `src/plugins/loader.ts`, `src/plugin-sdk/` |
| Cron/Heartbeat | openclaw | `src/cron/`, `src/infra/heartbeat-runner.ts` |
| 记忆系统 | openclaw | `extensions/memory-core/`, `extensions/memory-lancedb/` |
| Session 管理 | openclaw | `src/config/sessions/store.ts` |
| Agent 路由 | openclaw | `src/routing/resolve-route.ts` |
| Model fallback | openclaw | `src/agents/model-fallback.ts` |
| 消息总线模式 | learn-claude-code | s09-s10 JSONL mailbox protocol |
| 自主行为 | learn-claude-code | s11 autonomous agents (idle cycle + auto-claim) |
