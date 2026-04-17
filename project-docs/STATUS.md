# 当前功能状态

> 这个文件用大白话记录系统**目前能做什么**。每次写代码后必须更新。
> 不写未来计划（计划见 `docs/superpowers/plans/`）。

最后更新：2026-04-17

---

## 一句话总结

一个能在网页上聊天的 AI agent，支持**创建多个虚拟人**（各有独立名称、描述、模型），会执行 shell 命令，对话自动存档。

---

## 你现在能做的事

- **首页是虚拟人列表**：新建、编辑、删除虚拟人，每个虚拟人可设名称、描述、模型
- 点 "Chat" 进入该虚拟人的聊天页，会话按虚拟人隔离
- 聊天页侧边栏显示当前虚拟人名称 + 返回按钮
- 打开网页就能和 AI 对话
- AI 能流式回复（边生成边显示，不用等完）
- AI 可以执行 shell 命令来帮你（比如查看文件、跑程序），命令和结果会显示在对话里
- 关掉浏览器再回来，历史对话还在
- **左侧边栏管理多个会话**：新建、切换、删除，切换时会自动加载该会话的历史消息
- 默认会自动创建一个虚拟人，无会话时自动建一个
- **开启 `OBSERVER_ENABLED=1` 后可观测 AI 每轮内部**：聊天页 观测抽屉实时看完整 prompt / 工具 schema / LLM 响应；独立 `/observer` 页事后回放 + 清空

---

## 系统由几块组成

### 🧠 Agent 内核
agent 的"大脑"。负责和 LLM 对话、决定何时调用工具、把工具结果喂回 LLM、循环直到回答完成。

- 支持流式输出
- 支持调用 bash 工具
- 已对接 Anthropic Claude（默认 Sonnet 4.6）
- 工具系统是开放的，将来加新工具不用改内核

### 💾 数据存档
用 SQLite 存东西，文件固定在**项目根目录** `data.db`（不管从哪个子目录启动都是同一份）。

目前存了：
- **虚拟人**（agent）—— 名字、描述、性格、技能、用哪个 model
- **会话** —— 一次完整的对话上下文
- **消息** —— 每条对话内容
- **工具执行记录** —— agent 调用过哪些命令、结果是什么
- **LLM 调用快照** (`llm_calls`) —— 每次发给 LLM 的完整 prompt + tools + messages + response，env `OBSERVER_ENABLED=1` 启用

直接看里面的数据：`sqlite3 data.db` 或用 DB Browser for SQLite 打开。

### 🌐 网页入口
基于 Next.js 的网页 app，**Modern Dark Cinema 视觉风格**（2026-04-17 重新设计）。

- 设计系统：`globals.css` 集中 token（配色 / 半径 / 动效缓动 / 阴影），字体用 Fraunces（标题 SOFT/opsz 可变轴）+ Plus Jakarta Sans（正文）
- 首页"Virtual Personas"：按虚拟人 ID 生成稳定 HSL 渐变头像 + 首字母缩写、型号徽章、空状态配玻璃态光晕
- 聊天页：左侧玻璃态边栏（虚拟人渐变头像 + 会话条目 indigo 激活条 + 时间戳 + 悬停删除），右侧消息区（玻璃态顶栏 + 绿点状态 + "Say hello" 空状态 + 信使式气泡，用户气泡 indigo→紫线性渐变，助手气泡玻璃卡，工具调用 orange 重点卡 + 等宽输入输出）
- 输入栏为药丸形 composer，聚焦态 indigo 光晕环，36px 渐变发送按钮（SVG paper plane，**无 emoji**）
- 会话列表实时刷新，支持新建 / 切换 / 删除
- 实时显示 AI 流式回复（配 pulse 指示 + 气泡进入动画）
- 工具调用和结果用单独的卡片展示（错误红色，成功绿色）
- 后端通过 SSE 把 agent 事件推给前端
- Agent API：`GET/POST /api/agents`、`GET/PATCH/DELETE /api/agents/[id]`（删除级联清理会话和消息）
- Session API：`GET/POST /api/sessions`、`DELETE /api/sessions/[id]`、`GET /api/sessions/[id]/messages`
- 新增 `/observer` 调试页（三栏：会话 / turn 树 / 详情），`/chat` 页加观测按钮切换观测抽屉
- Observer API：`GET /api/observer/sessions/:id`、`GET /api/observer/calls/:callId`、`DELETE /api/observer/all`

---

## 怎么跑起来

```bash
# 1. 配 API key（在项目根目录）
cp .env.example .env
# 编辑 .env 填入真实的 ANTHROPIC_API_KEY

# 2. 启动
cd apps/web && npx next dev --turbopack

# 3. 浏览器打开 http://localhost:3000
```

第一次发消息会自动建表、自动创建一个默认 agent 和默认会话。
`apps/web/.env` 是项目根 `.env` 的软链，Next 从那里读 API key。

---

## 还没有的东西（重要）

为了避免误解，列一下"看起来该有但其实还没做"的：

- ❌ 没有模块化系统（性格 / 记忆 / 情绪 / 感知等，schema 和架构已设计，代码未实现）
- ❌ 没有除 bash 之外的工具
- ❌ 没有中断 / 取消正在进行的回复
- ❌ 没有上下文压缩，对话长了会爆 token
- ❌ 没有 daemon 后台常驻，关掉 dev server 就停了
