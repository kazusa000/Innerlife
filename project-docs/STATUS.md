# 当前功能状态

> 这个文件用大白话记录系统**目前能做什么**。由 Coordinator 在 TASK 归档到 `TASKS/done/` 之后统一更新。
> 不写未来计划（路线图见 `DESIGN.md §11`）。

最后更新：2026-05-07（新增 OpenAI-compatible LLM provider）

---

## 一句话总结

一个能在网页上聊天、并带**本地 daemon 常驻、STM 前置记忆、实体图 + 情景记忆长期召回**的 AI agent，支持**创建多个虚拟人**（各有独立名称、描述、模型）、**persona 级工具集**和**命名多对象关系**，对话自动存档。

---

## 你现在能做的事

- **首页是虚拟人列表**：新建、编辑、删除虚拟人，每个虚拟人可设名称、描述、模型
- 点 `Chat` 进入该虚拟人的聊天页，前端按**单 persona 单线程对话**组织；底层 `session` 仍保留为内部章节边界
- 聊天页侧边栏显示当前虚拟人名称 + 返回按钮
- 打开网页就能和 AI 对话
- AI 能流式回复（边生成边显示，不用等完）
- AI 现在按 persona 的 effective tool set 决定能用什么工具：`memory:sqlite` 默认可用 `search_long_term_memory`，`web_fetch` 默认关闭，但可在 Tools 页对单个 persona 手动开启
- 关掉浏览器再回来，历史对话还在
- 默认会自动创建一个虚拟人；进入聊天页时会自动解析或创建该 persona 的 active session
- **聊天页侧栏支持“清除上下文并撰写短期记忆”**：对 `memory:sqlite` persona，会先把当前 active context 手动 flush 成 short-term memory，再切到新的对话章节；没有可搬运内容时也会继续 reset，并明确提示结果。非 sqlite persona 维持原来的单纯清除上下文行为
- **回复可随时中断**：流式回复途中点"停止"按钮立即取消这一轮，正在跑的 `web_fetch` / LLM stream 会被一起终止；已流出来的文本保留并尾部标记 `—（中断）`
- **固定 `/agent/[id]/tools` 工具管理页已上线**：当前至少可管理 `search_long_term_memory` 与 `web_fetch`；工具描述默认是中文，可做 persona 级 override；`memory:sqlite` 时长期记忆搜索默认启用，`web_fetch` 默认关闭
- **本地 daemon v1 已可独立启动**：根目录可执行 `npm run daemon:start` 启动单进程常驻后台；daemon 启动时会自动补读仓库根 `.env`（只补缺失变量，不覆盖显式环境变量），会写文件锁，拒绝重复启动，并把 `pid / status / startedAt / lastHeartbeatAt / stoppedAt / lastError` 持久化到 `daemon_state`
- **全局 `/daemon` 工作台已上线**：首页新增 `Daemon` 入口；页面采用左侧章节导航 + 右侧内容区，集中展示 daemon 概览、记忆 Flush、睡眠与后台事件流，并支持按行安全触发 `立即 flush` / `立即睡觉`
- **创建/编辑虚拟人表单已继续收口**：首页现在只保留 provider / model 与 `emotion / relationship / memory` 三个模块的 scheme 选择；人设文本、工具、情绪、关系、记忆细项都迁到了各自管理页；`values` 与 personality scheme 都已从表单和 runtime 移除
- **首页 persona 卡片现在是 Control Deck 风格**：保留主 `Chat` CTA，并提供进入 `Personality / Emotion / Relationship / Memory / Tools` 等管理入口
- **开启 `OBSERVER_ENABLED=1` 后可观测 AI 每轮内部**：聊天页观测抽屉现在是 4 个 tab（**主对话 / 记忆 / 情绪 / 关系**）。主对话 tab 按当前 turn 聚合主对话 llm call，并支持在同一轮多个 call 之间切换；展开后可按锚点查看性格 / 情绪 / 记忆 / 关系 fragments、messages 时间线（含 compaction 内联）、tools schema 和 final system prompt。记忆 / 情绪 / 关系 tab 会按当前 agent 的 scheme 渲染系统内部 call：当前已支持 `memory:sqlite` 的 `retrieve` / `summarize` / `consolidate`、`emotion:dimensional` 的 `delta`、`relationship:multi-dim` 与 `relationship:named-multi-dim` 的 `delta`；本轮没触发时 tab 保留但显示空状态。独立 `/observer` 页事后回放也能识别 `relationship` call；`named-multi-dim` 还会额外展示 `counterpartId / counterpartName`
- **工具自动注册**：`packages/core/src/tools/*.ts` 里导出 `export const XxxTool: Tool = {...}`，启动前（`predev/prebuild/prestart`）扫描生成 `generated.ts`，`registry.getDefaultTools()` 统一供给 chat 路由；加新工具只需加文件，不再改注册数组
- **模块化 AgentSystem 基座**：`@mas/systems` 包定义 `TurnContext` + `AgentSystem` 接口与四个生命周期钩子（`beforeTurn` / `beforeLLM` / `afterLLM` / `afterTurn`）；runner 按 `priority` 拼接各系统 prompt fragments；系统抛错只 yield `system_error`、不中断主流程
- **人设系统已改成双 Prompt**：固定入口 `/agent/[id]/personality` 现在只编辑 `systemPrompt + personaPrompt` 两段文本，并统一落到 `modules.personality`；旧 `agents.config.systemPrompt / personaPrompt` 会在读取时迁入，人设不再作为 `AgentSystem` 注入，也不再有 Big Five runtime / API / 管理页
- **各管理页 Prompt Lab 现在直接编辑生效文本**：`memory / emotion / relationships / tools` 的 prompt/描述编辑器保存后就是当前生效内容；清空后保存才回退系统默认，不再需要单独的“恢复默认”按钮
- **上下文压缩（compaction:summary）**：消息数 > 40 或粗略 token 估算超阈值时，runner 调一次 LLM 把早期消息摘要成一条 `system` message，保留最近 20 条原文；DB 不删原消息。摘要 prompt 强制包含关键事实 / 用户偏好 / 未解决任务；连续多轮压缩会保留之前的 summary 作为下一轮输入。Observer 用 `kind: 'compaction'` 标记并展示 trigger / before / after 对比
- **情绪系统（emotion:dimensional）**：mood / energy / stress 三轴；运行时状态现在**按 agent 持续**，不再因新 session 重置。`beforeTurn` 读取该 agent 最近一条情绪状态，`beforeLLM` 注入"当前情绪"段落（priority 20），`afterLLM` 让同一 LLM 分析本轮情绪变化产 delta，`afterTurn` 衰减后写入新的 `emotion_states`。固定管理入口 `/agent/[id]/emotion` 现在主控的是 `Current emotion`，手动保存会写一条 `trigger = manual_override` 的情绪记录；`decayPerTurn / analysisModel` 仍可配置。Observer 用 `kind: 'emotion'` 标记，详情页显示最新状态 + delta + trigger
- **关系系统（relationship:multi-dim / relationship:named-multi-dim）**：trust / affinity / familiarity / respect 四轴。旧 `multi-dim` 仍然代表 `default-user ↔ agent`：`beforeTurn` 读取默认用户的最新关系，没有就用 baseline；`beforeLLM` 注入关系 prompt fragment（priority 40）；`afterLLM` 走 pending-analysis；`afterTurn` 衰减回 baseline、clip 到 `0..1` 后写入 `relationships` 表并追加 history。新的 `named-multi-dim` 允许同一个 agent 手动维护多个命名对象，并让每条 session 绑定其中一个对象：未绑定时该 session 上的关系系统不启用；绑定后，关系读取 / fragment 注入 / history 演化都只作用于当前对象，并且不同对象彼此隔离。持久化新增 `relationship_counterparts`（对象列表）与 `session_relationship_bindings`（session 当前绑定对象）。固定入口仍是 `/agent/[id]/relationships`：`multi-dim` 继续显示单对象状态，`named-multi-dim` 切成“左侧对象列表 + 右侧详情”工作台；聊天页侧栏也能为当前 session 绑定关系对象。Observer 继续把关系分析记成 `kind: 'relationship'`，metadata 含 `before / after / delta / trigger`，`named-multi-dim` 额外包含对象 id / 名称
- **记忆系统（memory:sqlite）**：现在已经落地 **context -> short_term -> entity graph + episodic memory**。`context` 只是当前 session 的活跃上下文窗口，不参与长期检索；原始消息仍保留在 `messages` 表里，通过 `session_context_state` 记录当前活跃窗口起点、最近 flush 时间和空闲状态。每轮 `beforeTurn` 仍会为 STM 前置检索做时间识别和语义识别：时间识别走本地 parser（Recognizers-Text），语义识别吃短历史窗口 + 当前用户消息并产出 `retrieval_query`；随后系统前置检索 `short_term`，STM 命中仍带 layer + 时间前缀注入主 prompt。daemon 现在处理两条后台链路：`context -> short_term` 会把最早完整回合块提炼成最多 3 条 STM，并写入 observed 时间范围；`short_term -> episodic` 会循环每批最多 3 条 STM，Stage A 抽取 local entities + episodic drafts，Stage B 每批最多 5 个 local entity、每个最多 5 个候选，候选先按同 type 的实体卡片 embedding 排序，再由 LLM 判断 `merge` 或 `create_new`。实体类型收窄为 `person / place / object / event`；alias 只允许在 Stage B merge 时建立；实体边是无类型权重边，由同一条情景记忆的实体共现增量更新。长期情景记忆存 `summary / detail / importance / observed range / entity links / summary embedding`，不再持久化单独的 `retrieval_text`；旧库会迁移移除 legacy episodic `retrieval_text` 列，缺少 summary embedding 的旧情景记忆会在召回前 backfill。`search_long_term_memory` 现在是长期情景记忆 tool：聊天前不自动跑实体图；只有主模型调用 tool 时，tool 才结合最近上下文和当前问题抽取 entity mentions，按 canonical / alias 命中已有实体，做本次调用内的一跳权重扩散，再把实体图分数和 summary embedding 文本分数混合，最终返回情景记忆 `detail`。tool 召回到的情景记忆会按 agent 级别写入临时激活表，默认保留 20 分钟、最多 5 条；后续聊天前不会把它们直接作为“自然浮现”段落塞进 prompt，而是把未过期激活项当作临时 short-term 候选参与前置检索，命中后进入正常短期记忆区块。这个临时激活不受 session 限制，时间过滤按激活时间判断，配置入口在 `/agent/[id]/tools` 的 `search_long_term_memory` 下。固定 `/agent/[id]/memory` 入口现在可查看活跃窗口、STM/历史 sqlite 行、情景记忆、实体节点和无类型权重边；实体图查询支持分页，不再一次性 dump 全图；同页也能编辑 memory 相关 prompt，并在每个 prompt 下用测试面板跑实际输入样例。Observer / chat 记忆展示已适配新的 tool metadata，能看到 entity mentions、候选节点、激活节点、实体图分数、文本分数和召回的情景记忆；主 prompt 命中的临时激活情景记忆会显示为 `short_term` 命中。
- **daemon 事件流已独立落库**：新增 `daemon_events`，统一记录 daemon 生命周期、记忆 Flush、睡眠沉淀等结构化后台事件；`/daemon` 页的只读命令行状态台读的就是这条全局事件流

---

## 系统由几块组成

### 🧠 Agent 内核
agent 的"大脑"。负责和 LLM 对话、决定何时调用工具、把工具结果喂回 LLM、循环直到回答完成。

- 支持流式输出
- 默认有效工具集按 persona 配置解析：`search_long_term_memory` 会在 `memory:sqlite` 时默认启用，`web_fetch` 只在该 persona 手动开启后才进入 chat route；两者都支持 `AbortSignal` 取消
- `runAgent` 贯穿 `AbortSignal`：每次 LLM 调用前 / stream 中 / 工具调用前都检查，取消时 yield 新的 `{type: 'aborted'}` 事件
- 已对接 Anthropic、OpenRouter 和 OpenAI-compatible provider；Anthropic 默认 Claude Sonnet 4.6，可通过 `ANTHROPIC_BASE_URL` 指向 Anthropic 兼容 endpoint；OpenAI-compatible 通过 `OPENAI_COMPATIBLE_BASE_URL` 指向任意 `/v1/chat/completions` 兼容服务；provider 均穿透 signal
- 工具系统是开放的，将来加新工具不用改内核

### 💾 数据存档
用 SQLite 存东西，默认都放在项目根目录的 `storage/` 下。

目前存了：
- **虚拟人**（agent）—— 名字、描述、用哪个 provider / model，以及 `modules` JSON（当前已实际使用 personality / emotion / relationship / memory）
- **会话** —— 一次完整的对话上下文
- **消息** —— 每条对话内容
- **工具执行记录** —— agent 调用过哪些命令、结果是什么
- **LLM 调用快照** (`llm_calls`) —— 每次发给 LLM 的完整 prompt + tools + messages + response，env `OBSERVER_ENABLED=1` 启用
- **daemon 状态** (`daemon_state`) —— 本地后台进程的 `pid / status / heartbeat / lastError`
- **daemon 事件** (`daemon_events`) —— daemon 全局事件流，覆盖生命周期、记忆 flush 与睡眠作业
- **上下文窗口状态** (`session_context_state`) —— 每个 session 当前活跃 context 的起点、最近 flush 信息与空闲状态
- **记忆睡眠状态** (`agent_memory_sleep_state`) —— 每个 agent 最近一次 sleep 的时间、计划时间与运行状态
- **记忆实体图与情景记忆**（在独立 `storage/memory/memory.db`）—— `memory_entities`、`memory_entity_aliases`、`memory_entity_edges`、`episodic_memories`、`episodic_memory_entities`，用于 persona 级长期情景召回
Drizzle migration 位于 `packages/db/migrations/`；`db-init.ts` 在启动时会兜底 `ALTER TABLE` 保障老库兼容。

直接看里面的数据：`sqlite3 storage/app/data.db` 或 `sqlite3 storage/memory/memory.db`，也可以用 DB Browser for SQLite 打开。旧根目录 `data.db*` 会在 web / daemon 下次启动时迁到 `storage/app/`。

### 🌐 网页入口
基于 Next.js 的网页 app，**Modern Dark Cinema 视觉风格**（2026-04-17 重新设计）。

- 设计系统：`globals.css` 集中 token（配色 / 半径 / 动效缓动 / 阴影），字体用 Fraunces（标题 SOFT/opsz 可变轴）+ Plus Jakarta Sans（正文）
- 首页"Virtual Personas"：按虚拟人 ID 生成稳定 HSL 渐变头像 + 首字母缩写、型号徽章、空状态配玻璃态光晕；persona 卡片现在是 `Control Deck` 风格，顶部展示身份和模型，中部展示各模块 scheme，底部统一进入 Personality / Emotion / Relationship / Memory 四个管理页
- 首页顶部新增全局 `Daemon` 入口，进入 `/daemon` 后可统一查看后台系统是否在线、记忆 flush / 睡眠候选和全局后台事件流
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
# 编辑 .env 填入真实 API key；至少配置你选择的 provider 对应 key

# 2. 启动
cd apps/web && npx next dev --turbopack

# 3. 可选：启动本地 daemon v1
cd ../..
npm run daemon:start

# 4. 可选：跑浏览器验收（首次机器上可先 npm run playwright:install）
npm run test:e2e

# 5. 浏览器打开 http://localhost:3000
#    需要看后台系统时，从首页顶部进入「Daemon」
```

第一次发消息会自动建表、自动创建一个默认 agent 和默认会话。
`apps/web/.env` 是项目根 `.env` 的软链，Next 从那里读 API key。

---

## 还没有的东西（重要）

为了避免误解，列一下"看起来该有但其实还没做"的：

- ❌ **人设 / 情绪 / 关系 / 记忆已接入**；感知系统尚未实现，`relationship` 也还没有图谱 UI
- ❌ daemon 目前已经接上 Context → STM 与 STM → entity graph + episodic 的记忆搬运；但 `scheduled_tasks` 与更高阶自主行为仍未实现
