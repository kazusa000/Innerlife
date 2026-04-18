# D1 — Memory（sqlite 方案）

**状态**: pending
**前置依赖**: B6（模块化基座，已完成）
**预计规模**: medium

## 目标

让虚拟人**记住聊过的事**，下次能用上。最简单一层：每轮 `afterTurn` 把这一轮总结成一条记忆存进 sqlite；下一轮 `beforeTurn` 用关键词检索找相关历史记忆，`beforeLLM` 把它们渲染成"相关记忆"段落注入 system prompt。

效果：第一次告诉它"我猫叫橘子"，过几轮再问"我猫叫什么"，它能答上来；不像现在断点之后就忘。

这是 `memory` 系统类型的 `sqlite` 方案，登记到 B6 的 `systemRegistry`。**纯后端 task，不做 UI**（记忆查看/管理 UI 是 D4 单独 task）。参数走 `agents.modules.memory` JSON。记忆条目存**新增 `memories` 表**。

## 涉及文件

- `packages/systems/src/memory/sqlite.ts`（新建，实现 `AgentSystem` 接口）
- `packages/systems/src/memory/index.ts`（新建，barrel 导出）
- `packages/systems/src/registry.ts`（修改，加 `memory.sqlite` 一行；保留 `memory.noop`）
- `packages/systems/src/index.ts`（修改，barrel re-export）
- `packages/db/src/schema.ts`（新增 `memories` 表）
- `packages/db/migrations/<next-num>_*.sql`（用 `npx drizzle-kit generate`）+ meta 文件
- `apps/web/src/lib/db-init.ts`（按需 ALTER 兜底确保 `memories` 存在）

不要碰：`runner.ts` / `chat/route.ts` / `apps/web/src/app/page.tsx`（**这次完全不动 UI**，避免和 C2 撞 page.tsx）

## `modules.memory` JSON 约定

```jsonc
{
  "memory": {
    "scheme": "sqlite",
    "summarizeModel": null,        // 选填；null = 用 agent.model 做"把这轮总结成一条记忆"
    "retrieveTopK": 5,             // 选填，默认 5
    "minTermLength": 2             // 选填，关键词最短长度（避免 "a"/"我" 这种）
  }
}
```

`scheme: "noop"` 或字段缺失 → 不存、不检索。

## 数据库

新增 `memories` 表：

```ts
memories {
  id              text primary key
  agentId         text references(agents.id)
  sessionId       text references(sessions.id)  // 标注来源会话；检索时跨会话
  content         text  // 这条记忆的原始素材（截断后的对话片段）
  summary         text  // LLM 总结的一句话："用户养了一只叫橘子的猫"
  tags            text  // JSON string array：["猫", "橘子", "宠物"]，关键词检索用
  importance      real  // 0..1，LLM 评的重要性，便于排序 / 后续清理
  createdAt       integer (timestamp_ms)
}
```

加索引：`(agentId, createdAt)`、`(agentId)`，方便后续按 agent 拉取 / 时间排序。

## `afterTurn` 的总结调用 + `beforeTurn` 的检索

- **总结**（afterTurn）：复用 B5 的 "system 产意图 / runner 调 LLM" 模式 —— system 在 `ctx.pendingMemoryWrite` 挂上"请用 LLM 把本轮 summarize 成 `{summary, tags, importance}` JSON"的请求；runner 跑完写表。**不要 system 自己持 provider**
- **检索**（beforeTurn）：纯 SQL，**不走 LLM**：
  1. 把 `ctx.input.text` 拆词（简单 split + 滤掉 stopwords，不要上分词器）
  2. SQL：`SELECT * FROM memories WHERE agent_id=? AND (tags LIKE '%term1%' OR tags LIKE '%term2%' OR ...) ORDER BY importance DESC, created_at DESC LIMIT topK`（参数化拼，注意 SQL 注入）
  3. 命中的记忆写到 `ctx.state.memories` 给 beforeLLM 用
- **注入**（beforeLLM）：把检索到的 summary 们渲染成：
  ```
  Relevant memories (most important first):
  - 用户养了一只叫橘子的猫
  - 用户喜欢晚上聊天
  ```
  写入 `ctx.promptFragments`，`priority: 30`（DESIGN §10.10）

- 如果检索结果为空 → **不注入** memory fragment，避免 prompt 出现空段
- LLM 的 summarize call 用 Observer `kind: 'memory'` 标记（参考 B5 的 `kind: 'compaction'`）

## 完成标准

- [ ] `sqlite.ts` 实现 `AgentSystem` 三个钩子（`beforeTurn` 检索 / `beforeLLM` 注入 / `afterTurn` 总结+写表）
- [ ] `registry.ts` 支持字符串 `sqlite` 实例化；`memory.noop` 保留
- [ ] DB 迁移生成 + `db-init.ts` 兜底 + sqlite3 能看到 `memories` 表 + 两个索引
- [ ] Observer 能看到 turn 内的 memory summarize call（`kind: 'memory'`）+ 检索命中数（写到 turn metadata）
- [ ] 端到端手动验证：开新会话告诉 agent "我猫叫橘子"，再开**新会话**问"我猫叫什么"，agent 能答上（跨 session 检索成功）
- [ ] 单测：
  - 给定 mock LLM 返回 `{summary, tags, importance}`，断言 afterTurn 写了一条正确的 memory 行
  - 给定 fixture memories + input text，断言关键词检索命中预期 ID 集合
  - 空 modules / `scheme: noop` → 既不写表也不注入 fragment
- [ ] `npm run typecheck` / `npm test --workspace @mas/systems --workspace @mas/core --workspace @mas/db` 全过
- [ ] 关闭时（`scheme: "noop"` 或字段缺失）行为完全等同 noop，Observer 里没有 memory call

## 备注 / 注意事项

- **不要做**：向量检索（D2 chromadb）、记忆删除/清理 UI（D4）、agent 主动 search 工具（D3）、宫殿结构（Wing/Room/Drawer）
- **不要做**：把整轮对话原文存进 memories.content —— 太大。**只存"摘要+标签"**，原对话本身已经在 messages 表
- 关键词拆分用最简单的：`text.toLowerCase().match(/[\p{L}\p{N}]+/gu)` 然后去重 + 过滤 length < minTermLength + 停用词（中英各几个常见的就行，硬编码）
- **跨 session 检索**是关键 —— 不要按 sessionId 过滤；只按 agentId
- importance 评分让 LLM 在 summarize 时一起给（0=闲聊、0.5=个人偏好、0.9=重要事实），别单独发一次 LLM call
- **TurnContext 扩展**：加 `pendingMemoryWrite?` + `state.memories?` 字段时跟 B5 / C2 协调，三个 task 可能都要扩 TurnContext，**派发顺序：B5 已落、C2 + D1 同期，谁先合并谁定义扩展形状，后合的看 git diff 跟齐**
- **先读** `packages/systems/src/compaction/summary.ts` 学 "system 产 pendingXxx → runner 跑 LLM" 模式
- **先读** `packages/systems/src/values/priority-list.ts` 学最简 AgentSystem 落地形状
- DESIGN §4.4.3 / §7.4 / §10.10 / §11 (D1 行) 为权威；扩 TurnContext 走 Completion Note 披露
