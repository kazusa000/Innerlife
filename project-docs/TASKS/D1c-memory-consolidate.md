# D1c — Memory 记忆整理（sqlite 专属）

**状态**: pending
**前置依赖**: D1（已完成）。与 D1a / D1b 独立，可以并行
**预计规模**: medium

## 目标

长期使用后 `memories` 表会变碎、重复、tags 风格不一、importance 估得偏。加一个**手动触发**入口，调 LLM 对该 agent 的**所有现存 memories** 做一次清洗：

- 合并重复 / 相近主题的多条
- 重写 summary 更稳定干净
- 统一 tags 风格（中英双语、同义词）
- 重估 importance（0..1）
- 把结果写回 `memories` 表

**重要：此功能仅服务 `memory:sqlite` scheme，不做跨 scheme 抽象**。D2 chromadb 上线时完全独立，各自管各自。

## 涉及文件

- `packages/systems/src/memory/sqlite.ts`（加 `consolidate()` 方法或 `consolidateMemories()` 辅助函数；system 本身仍不持 provider，consolidate 逻辑照 pending-X 模式）
- `packages/db/src/repository/memories.ts`（加 `listAllByAgent(agentId)` / `updateInPlace(id, ...)` / `deleteByIds(ids[])` 等新方法；`insert` 允许显式 `createdAt`）
- `apps/web/src/app/api/agents/[id]/memory/sqlite/consolidate/route.ts`（**新建**，`POST` handler）
- `packages/systems/src/memory/sqlite.test.ts` 和/或 `packages/db/src/repository/memories.test.ts`（单测）

不要碰：registry、schema.ts / migration（不加列；沿用现有表结构）、UI（D4 再挂按钮）、其他 scheme

## API 约定

```
POST /api/agents/:id/memory/sqlite/consolidate
  → 204 No Content 成功（或 200 + JSON 报告）
  → 400 Bad Request：agent 的 `modules.memory.scheme !== 'sqlite'`，提示"only available for memory:sqlite scheme"
  → 400 Bad Request：memory 条目数 > 100，提示"memory pool too large; manual batching required"
  → 404 agent 不存在
  → 5xx LLM 调用失败（错误信息写 response body）
```

**URL 里显式写死 `sqlite`** —— 这是故意的设计。未来 D2 chromadb 要整理就开 `POST /api/agents/:id/memory/chromadb/consolidate`，互不耦合，不做通用抽象。

## LLM 调用流程

```
1. 读 agent.modules.memory，若 scheme !== 'sqlite' → 400
2. SELECT * FROM memories WHERE agent_id=? ORDER BY created_at ASC
3. 若条数 > 100 → 400 (上限 const MEMORY_CONSOLIDATE_MAX = 100)
4. 构造 consolidate prompt（模板见下），把所有 memories 的 {id, summary, tags, importance, createdAt} 喂进去
5. provider.sendMessage（kind: 'memory', metadata.phase: 'consolidate'；Observer 可见）
6. 解析 LLM 返回的 JSON：
   {
     "actions": [
       { "op": "keep", "id": "uuid-a" },
       { "op": "rewrite", "id": "uuid-b", "summary": "...", "tags": [...], "importance": 0.6 },
       { "op": "merge", "sourceIds": ["uuid-c", "uuid-d"], "summary": "...", "tags": [...], "importance": 0.7 }
     ]
   }
7. 一个事务内按 op 类型执行：
   - keep → no-op
   - rewrite → UPDATE memories SET summary=?, tags=?, importance=? WHERE id=? （保留 id + createdAt）
   - merge → 
       * 查源条目的 createdAt，取最早的一个
       * INSERT 新条目，id=新 UUID，createdAt=那个最早时间
       * DELETE FROM memories WHERE id IN (sourceIds)
8. 响应 200 + JSON 报告：{ before: N, after: M, kept, rewritten, merged }
```

**Prompt 模板要求**（示意）：
```
你是记忆整理助手。以下是虚拟人 {agentName} 的所有记忆（JSON 数组）：
[{id, summary, tags, importance, createdAt}, ...]

请对这批记忆做清洗：
- 合并重复或高度相关的条目（多条关于"用户的猫叫橘子"的，合成一条）
- 重写 summary 更准确简洁
- tags 必须同时包含中英同义词，风格统一
- 重估 importance（0..1，0.9+ 留给身份 / 关键事实，0.3 以下是闲聊）
- 对不需要动的条目用 "keep" op

输出 JSON（示例略）。不要输出其他任何文字。
```

## 写回语义（重要，别搞混）

| 场景 | 怎么写 |
|---|---|
| LLM 决定某条不用动 | `op: "keep"` → no-op |
| LLM 想改某条的 summary / tags / importance | `op: "rewrite"` → **UPDATE in place**，保留 `id` + `createdAt` |
| LLM 想把 N 条（N≥2）合成一条 | `op: "merge"` → **INSERT 新条目**（新 id，**`createdAt = min(sourceIds.createdAt)`**）+ **DELETE 所有 `sourceIds`** |

**为什么保留 id + createdAt**：
- Observer 历史里会显示"第 X turn 检索命中了 memory Y"，引用 id 不能断
- createdAt 代表"何时首次知道这件事"，合并时取最早，不要丢时间信息

## 完成标准

- [ ] API route 存在、对 `scheme !== 'sqlite'` 返回 400、对 >100 条返回 400、对 404 agent 正确响应
- [ ] 三种 op 都正确执行：keep 不动、rewrite 保留 id+createdAt、merge 新 id + 最早 createdAt + 删源
- [ ] 整个写回在**一个事务内**（失败回滚，不能写一半）
- [ ] Observer 能看到 consolidate 这次 LLM call（`kind: 'memory'`, `metadata.phase: 'consolidate'`）
- [ ] 单测：
  - 给 fixture 3 条 memory + mock LLM 返回"把第 1、2 条 merge，第 3 条 rewrite" → 断言表里剩 2 条（1 新 merged + 1 rewritten）、新 merged 条的 createdAt 等于原 1 或 2 的最早
  - agent 不存在 → 404
  - scheme != sqlite → 400
  - 超过 100 条 → 400
  - LLM 返回非法 JSON → 事务回滚，表未变
- [ ] typecheck / test 全过
- [ ] 关闭记忆（`scheme: "noop"`）时调这个 API → 400（因为 scheme 不是 sqlite）

## 备注

- **不做**：cron / 自动触发、UI 按钮（D4 再挂）、上限可配（写死 100）、跨 scheme 接口
- **事务**：drizzle / better-sqlite3 已经支持事务，照现有 db 模式写
- **LLM response 容错**：JSON 解析失败 / action 引用不存在的 id / merge 的 sourceIds 为空 → 整个整理作废，不写任何东西，返回 5xx 并在 body 给原因
- **Consolidate prompt 产出的 tags 应该符合 D1a 的中英双语约定**（即使 D1a 还没合并也这么做，两个 task 独立推进）
- **先读** `packages/systems/src/memory/sqlite.ts` 和 `packages/db/src/repository/memories.ts` 看现有 pattern
- **先读** `apps/web/src/app/api/agents/[id]/route.ts` 看现有 route handler 怎么写
