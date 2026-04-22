# 当前功能状态

> 这个文件用大白话记录系统**目前能做什么**。由 Coordinator 在 TASK 归档到 `TASKS/done/` 之后统一更新。
> 不写未来计划（路线图见 `DESIGN.md §11`）。

最后更新：2026-04-22（Daemon 工作台并入）

---

## 一句话总结

一个能在网页上聊天、并带**本地 daemon 常驻与分层记忆流水线**的 AI agent，支持**创建多个虚拟人**（各有独立名称、描述、模型），当前默认可抓取网页内容，对话自动存档。

---

## 你现在能做的事

- **首页是虚拟人列表**：新建、编辑、删除虚拟人，每个虚拟人可设名称、描述、模型
- 点 `Chat` 进入该虚拟人的聊天页，前端按**单 persona 单线程对话**组织；底层 `session` 仍保留为内部章节边界
- 聊天页侧边栏显示当前虚拟人名称 + 返回按钮
- 打开网页就能和 AI 对话
- AI 能流式回复（边生成边显示，不用等完）
- AI 当前默认可用 `web_fetch` 抓取网页内容，结果会显示在对话里
- 关掉浏览器再回来，历史对话还在
- 默认会自动创建一个虚拟人；进入聊天页时会自动解析或创建该 persona 的 active session
- **回复可随时中断**：流式回复途中点"停止"按钮立即取消这一轮，正在跑的 `web_fetch` / LLM stream 会被一起终止；已流出来的文本保留并尾部标记 `—（中断）`
- **当前默认只启用 `web_fetch` 工具**：30s 超时、HTML 去噪转纯文本；`bash` / `file_read` / `file_write` 实现仍在仓库里，但不再默认注册到 chat route
- **本地 daemon v1 已可独立启动**：根目录可执行 `npm run daemon:start` 启动单进程常驻后台；daemon 会写文件锁，拒绝重复启动，并把 `pid / status / startedAt / lastHeartbeatAt / stoppedAt / lastError` 持久化到 `daemon_state`
- **全局 `/daemon` 工作台已上线**：首页新增 `Daemon` 入口；页面采用左侧章节导航 + 右侧内容区，集中展示 daemon 概览、图灵测试、记忆 Flush、睡眠与后台事件流，并支持按行安全触发 `立即 flush` / `立即睡觉`
- **创建/编辑虚拟人表单已收敛为 scheme 选择器**：首页只保留 provider / model 和 `personality / emotion / relationship / memory` 四个模块的 scheme 选择；Big Five、emotion baseline、relationship baseline、memory model override 都迁到了各自管理页；`values` 已从表单和 runtime 移除
- **首页 persona 卡片现在是 Control Deck 风格**：保留主 `Chat` CTA，并提供进入 `Personality / Emotion / Relationship / Memory` 四个管理页的统一入口
- **开启 `OBSERVER_ENABLED=1` 后可观测 AI 每轮内部**：聊天页观测抽屉现在是 4 个 tab（**主对话 / 记忆 / 情绪 / 关系**）。主对话 tab 按当前 turn 聚合主对话 llm call，并支持在同一轮多个 call 之间切换；展开后可按锚点查看性格 / 情绪 / 记忆 / 关系 fragments、messages 时间线（含 compaction 内联）、tools schema 和 final system prompt。记忆 / 情绪 / 关系 tab 会按当前 agent 的 scheme 渲染系统内部 call：当前已支持 `memory:sqlite` 的 `retrieve` / `summarize` / `consolidate`、`emotion:dimensional` 的 `delta`、`relationship:multi-dim` 的 `delta`；本轮没触发时 tab 保留但显示空状态。独立 `/observer` 页事后回放也能识别 `relationship` call
- **工具自动注册**：`packages/core/src/tools/*.ts` 里导出 `export const XxxTool: Tool = {...}`，启动前（`predev/prebuild/prestart`）扫描生成 `generated.ts`，`registry.getDefaultTools()` 统一供给 chat 路由；加新工具只需加文件，不再改注册数组
- **模块化 AgentSystem 基座**：`@mas/systems` 包定义 `TurnContext` + `AgentSystem` 接口与四个生命周期钩子（`beforeTurn` / `beforeLLM` / `afterLLM` / `afterTurn`）；runner 按 `priority` 拼接各系统 prompt fragments；系统抛错只 yield `system_error`、不中断主流程
- **角色与性格 prompt 已分层**：首页 persona 编辑层现在除了 `provider / model / 模块方案`，还支持直接编辑角色级 `System Prompt` 和 `角色 Prompt`；这两层会先进入主对话的基础 prompt。`personality:big-five` 模块则只负责 5 维 Big Five、说话风格和背景故事，并在 `beforeLLM` 以 `priority: 10` 注入性格 fragment；固定管理入口 `/agent/[id]/personality` 现在只维护真正属于性格模块的字段，不再承载角色级 prompt
- **上下文压缩（compaction:summary）**：消息数 > 40 或粗略 token 估算超阈值时，runner 调一次 LLM 把早期消息摘要成一条 `system` message，保留最近 20 条原文；DB 不删原消息。摘要 prompt 强制包含关键事实 / 用户偏好 / 未解决任务；连续多轮压缩会保留之前的 summary 作为下一轮输入。Observer 用 `kind: 'compaction'` 标记并展示 trigger / before / after 对比
- **情绪系统（emotion:dimensional）**：mood / energy / stress 三轴；运行时状态现在**按 agent 持续**，不再因新 session 重置。`beforeTurn` 读取该 agent 最近一条情绪状态，`beforeLLM` 注入"当前情绪"段落（priority 20），`afterLLM` 让同一 LLM 分析本轮情绪变化产 delta，`afterTurn` 衰减后写入新的 `emotion_states`。固定管理入口 `/agent/[id]/emotion` 现在主控的是 `Current emotion`，手动保存会写一条 `trigger = manual_override` 的情绪记录；`decayPerTurn / analysisModel` 仍可配置。Observer 用 `kind: 'emotion'` 标记，详情页显示最新状态 + delta + trigger
- **关系系统（relationship:multi-dim）**：trust / affinity / familiarity / respect 四轴；`beforeTurn` 读取该 agent 对默认用户的最新关系，没有就用 baseline；`beforeLLM` 注入关系 prompt fragment（priority 40）；`afterLLM` 走 pending-analysis；`afterTurn` 衰减回 baseline、clip 到 `0..1` 后写入 `relationships` 表并追加 history。Observer 现在会把关系分析单独记成 `kind: 'relationship'`，metadata 含 `before / after / delta / trigger`，聊天抽屉和 `/observer` 回放都能看到。现在也有固定管理入口 `/agent/[id]/relationships`，可查看当前状态 / history，并编辑 baseline / decayPerTurn / analysisModel。当前只支持 `user ↔ agent`，还没有图谱 UI
- **记忆系统（memory:sqlite）**：现在已经按 **context / short_term / long_term / fixed** 四层运作。`context` 只是当前 session 的活跃上下文窗口，不参与检索；原始消息仍保留在 `messages` 表里，通过 `session_context_state` 记录当前活跃窗口起点、最近 flush 时间和空闲状态。每轮 `beforeTurn` 会先做双分析：时间识别不再走 LLM，而是本地 parser（Recognizers-Text）只产出 `time_range`；`semantic analyzer` 继续由 LLM 产出 `retrieval_query + focus`。随后系统前置检索 `short_term + fixed` 两层；命中结果注入主 prompt 时会带上 `layer + 本地时间` 前缀，没命中时也会明确写出“未搜索到相关记忆”。`long_term` 不前置注入，而是由主模型在必要时通过 `search_long_term_memory` tool 继续深搜，且每轮最多 1 次。daemon 现在会处理两条后台链路：`context -> short_term`（空闲或超窗时，把最早完整回合块提炼成最多 3 条 STM，写入成功后才把它们从活跃窗口移出）和 `short_term -> long_term`（每天一次“睡眠”沉淀）；`fixed` 仍是从 LTM 手动提升。记忆数据继续落独立的 `memory.db`，layer 只允许 `short_term / long_term / fixed`。固定 `/agent/[id]/memory` 入口现在是完整工作台：左侧章节导航，右侧分成 **Context 控制区 / 记忆表格 / 睡眠区 / Prompt Lab**；可查看活跃窗口、配置上下文阈值和 idle flush、手动整理旧上下文、手动触发睡眠、搜索/筛选/删除记忆、单条改 layer，并编辑 `Memory model override`、`Embedding model`、`Semantic Analyzer Prompt`、`Summarize Prompt`、`Fragment Prompt`、`Consolidate Prompt`。Observer 继续用 `kind: 'memory'` 标记，`metadata.phase` 区分 `retrieve` / `summarize` / `consolidate`；其中 `retrieve` 会显示 parser 产出的 `timeAnalyzer`、LLM 产出的 `semanticAnalyzer`、`mergedQuery`、最终 `hits` 以及各命中的 layer
- **图灵测试系统（Turing test v1）**：每个 persona 现在都有固定入口 `/agent/[id]/turing`。页面不是聊天页变种，而是图灵测试工作台：可发起一次**外部优先的异步评测 run**，后台会复制当前 persona 为临时测试 agent、强制开启全部模块，并由固定 7 段测试套件（自然开场 / 日常延续 / 记忆追问 / 记忆拟人性 / 情绪合理性 / 关系边界 / 不确定性与露馅处理）自动对话。右侧有命令行风格的后台日志台，主区显示报告，底部保留完整对话回放。测试结果默认保留，并支持一键清理本次 run 产生的临时 agent、会话、记忆、关系/情绪状态和事件日志
- **daemon 事件流已独立落库**：新增 `daemon_events`，统一记录 daemon 生命周期、图灵测试消费、记忆 Flush、睡眠沉淀等结构化后台事件；`/daemon` 页的只读命令行状态台读的就是这条全局事件流

---

## 系统由几块组成

### 🧠 Agent 内核
agent 的"大脑"。负责和 LLM 对话、决定何时调用工具、把工具结果喂回 LLM、循环直到回答完成。

- 支持流式输出
- 当前默认只注册 `web_fetch` 工具（支持 `AbortSignal` 取消）
- `runAgent` 贯穿 `AbortSignal`：每次 LLM 调用前 / stream 中 / 工具调用前都检查，取消时 yield 新的 `{type: 'aborted'}` 事件
- 已对接 Anthropic 及其兼容 endpoint（默认 Claude Sonnet 4.6；通过 `ANTHROPIC_BASE_URL` 可切到 DeepSeek 等兼容服务），provider 也穿透 signal
- 工具系统是开放的，将来加新工具不用改内核

### 💾 数据存档
用 SQLite 存东西，文件固定在**项目根目录** `data.db`（不管从哪个子目录启动都是同一份）。

目前存了：
- **虚拟人**（agent）—— 名字、描述、用哪个 provider / model，以及 `modules` JSON（当前已实际使用 personality / emotion / relationship / memory）
- **会话** —— 一次完整的对话上下文
- **消息** —— 每条对话内容
- **工具执行记录** —— agent 调用过哪些命令、结果是什么
- **LLM 调用快照** (`llm_calls`) —— 每次发给 LLM 的完整 prompt + tools + messages + response，env `OBSERVER_ENABLED=1` 启用
- **daemon 状态** (`daemon_state`) —— 本地后台进程的 `pid / status / heartbeat / lastError`
- **daemon 事件** (`daemon_events`) —— daemon 全局事件流，覆盖生命周期、图灵测试消费、记忆 flush 与睡眠作业
- **上下文窗口状态** (`session_context_state`) —— 每个 session 当前活跃 context 的起点、最近 flush 信息与空闲状态
- **记忆睡眠状态** (`agent_memory_sleep_state`) —— 每个 agent 最近一次 sleep 的时间、计划时间与运行状态
- **图灵测试 run** (`turing_test_runs`) —— 一次图灵测试任务的状态、临时测试 agent/session、报告、回放、错误与清理时间
- **图灵测试事件** (`turing_test_events`) —— 图灵测试 runner 的阶段事件流，给页面右侧后台命令行状态区和外部 AI 读取

Drizzle migration 位于 `packages/db/migrations/`；`db-init.ts` 在启动时会兜底 `ALTER TABLE` 保障老库兼容。

直接看里面的数据：`sqlite3 data.db` 或用 DB Browser for SQLite 打开。

### 🌐 网页入口
基于 Next.js 的网页 app，**Modern Dark Cinema 视觉风格**（2026-04-17 重新设计）。

- 设计系统：`globals.css` 集中 token（配色 / 半径 / 动效缓动 / 阴影），字体用 Fraunces（标题 SOFT/opsz 可变轴）+ Plus Jakarta Sans（正文）
- 首页"Virtual Personas"：按虚拟人 ID 生成稳定 HSL 渐变头像 + 首字母缩写、型号徽章、空状态配玻璃态光晕；persona 卡片现在是 `Control Deck` 风格，顶部展示身份和模型，中部展示各模块 scheme，底部统一进入 Personality / Emotion / Relationship / Memory 四个管理页
- 首页顶部新增全局 `Daemon` 入口，进入 `/daemon` 后可统一查看后台系统是否在线、最近图灵测试 run、记忆 flush / 睡眠候选和全局后台事件流
- 聊天页：左侧玻璃态边栏（虚拟人渐变头像 + 会话条目 indigo 激活条 + 时间戳 + 悬停删除），右侧消息区（玻璃态顶栏 + 绿点状态 + "Say hello" 空状态 + 信使式气泡，用户气泡 indigo→紫线性渐变，助手气泡玻璃卡，工具调用 orange 重点卡 + 等宽输入输出）
- 输入栏为药丸形 composer，聚焦态 indigo 光晕环，36px 渐变发送按钮（SVG paper plane，**无 emoji**）
- 聊天页不再暴露新建 / 切换 / 删除 session；用户心智上始终是“和这个 persona 的一条持续对话”
- 实时显示 AI 流式回复（配 pulse 指示 + 气泡进入动画）
- 工具调用和结果用单独的卡片展示（错误红色，成功绿色）
- 后端通过 SSE 把 agent 事件推给前端
- Agent API：`GET/POST /api/agents`、`GET/PATCH/DELETE /api/agents/[id]`（删除级联清理会话和消息），以及 `POST /api/agents/[id]/active-session`
- Session API：仍保留历史/调试读取，但网页端不再提供公开新建 session 入口
- 新增 `/observer` 调试页（三栏：会话 / turn 树 / 详情），`/chat` 页加观测按钮切换**tab 化**观测抽屉
- Observer API：`GET /api/observer/sessions/:id`、`GET /api/observer/calls/:callId`、`DELETE /api/observer/all`

---

## 怎么跑起来

```bash
# 1. 配 API key（在项目根目录）
cp .env.example .env
# 编辑 .env 填入真实的 ANTHROPIC_API_KEY

# 2. 启动
cd apps/web && npx next dev --turbopack

# 3. 可选：启动本地 daemon v1
cd ../..
npm run daemon:start

# 4. 浏览器打开 http://localhost:3000
#    需要图灵测试时，从某个 persona 卡片进入「图灵测试」
#    需要看后台系统时，从首页顶部进入「Daemon」
```

第一次发消息会自动建表、自动创建一个默认 agent 和默认会话。
`apps/web/.env` 是项目根 `.env` 的软链，Next 从那里读 API key。

---

## 还没有的东西（重要）

为了避免误解，列一下"看起来该有但其实还没做"的：

- ❌ **性格 / 情绪 / 关系 / 记忆已接入**；感知系统尚未实现，`relationship` 也还没有图谱 UI
- ❌ daemon 目前已经能消费图灵测试 queued run，也已经接上 Context → STM → LTM 的分层记忆搬运；但 `scheduled_tasks` 与更高阶自主行为仍未实现
- ❌ 图灵测试官规则书目前是**系统固定内置** markdown；还不支持运行时切换不同评测官版本
