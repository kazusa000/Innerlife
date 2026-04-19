# D1b — Memory 检索 query 扩展（LLM 版）

**状态**: pending
**前置依赖**: D1（已完成）。与 D1a（tags 中英双语）独立，不互相阻塞
**预计规模**: small

## 目标

修 D1 第一版的根本问题：**检索纯关键词匹配命中率低，同义表达、跨语言、换说法都搜不到**。

方案：把 `beforeTurn` 里那一步"把 user input 分词"从"正则 tokenizer + stopword 过滤"换成"一次轻量 LLM call"，让 LLM 根据用户输入产出更适合去 `memories.tags` 搜索的关键词数组，再喂给现有 SQL `LIKE`。

不动 DB schema、不动检索 SQL、不动 summarize 流程。**只换分词这一步**。

## 涉及文件

- `packages/systems/src/memory/sqlite.ts`（修改：加一个 `pendingMemoryQuery` 意图；不再直接调 `tokenizeText` 喂检索）
- `packages/systems/src/types.ts`（加 `PendingMemoryQuery` 接口，跟已有 `PendingMemoryWrite` 并列）
- `packages/core/src/agent/runner.ts`（加一段 `runPendingMemoryQuery`，照抄 `runPendingMemoryWrite` / `runPendingEmotionAnalysis` 模板）
- `packages/systems/src/memory/sqlite.test.ts`（补测试）

不要碰：registry、DB schema / migration、UI、Observer 前端（`kind` 复用 `memory`，前端已经能显示）

## 新数据流

```
beforeTurn:
  memory system 构造 PendingMemoryQuery {
    input: ctx.input.text,
    prompt: "...请输出 JSON: {keywords:[...]}...",
    fallback: tokenizeText(ctx.input.text)   ← 现有 tokenizer 产出，失败时用
  }
  ctx.pendingMemoryQuery = pending
  （beforeTurn 结束，未发 LLM call）

runner 看到 ctx.pendingMemoryQuery:
  调 provider.sendMessage（kind: 'memory', metadata.phase: 'retrieve'）
  解析 JSON 拿 keywords
  失败（超时 / JSON 解析不出 / 空 keywords）→ 用 pending.fallback
  把 keywords 写到 ctx.state.memoryRetrievalKeywords（仅本轮用）
  用 keywords 跑现有 findRelevantMemories → 写 ctx.state.memories

beforeLLM:
  memory system 照旧读 ctx.state.memories 渲染 promptFragment，priority 30
```

## LLM 调用约定

**Prompt 模板**（示意，实现时再打磨）：
```
你是检索助手。用户当前输入如下：
{user input}

请为从虚拟人记忆库（按 tag 关键词匹配）里检索相关记忆，列出最相关的 4-8 个关键词。
- 中英同义词都给（如 "名字", "name", "姓名"）
- 不要只列 input 里的字，要扩出同义 / 上位 / 相关话题
- 输出 JSON：{"keywords": [...]}
```

**Observer 记录**：`kind: 'memory'`，`metadata.phase: 'retrieve'`（写 summarize 那一次用 `phase: 'summarize'`，方便日后前端按 phase 区分但不强制）。**不要**新增 `kind: 'memory_query'`，kind enum 膨胀不划算。

**系统不持 provider**：照 B5 / C2 / D1 summarize 同模式，system 只产 `pendingMemoryQuery` 意图，`runner.ts` 里 `runPendingMemoryQuery` 真正 `provider.sendMessage`。

## 成本 & 失败策略

- **不考虑成本**（用户确认）：每轮都发一次扩展 call。开了记忆系统的 turn = 4 次 LLM call（主 turn + query 扩展 + emotion 分析 + summarize）
- **不跳过短输入**（第一版）
- **不 cache**（第一版）
- **失败 / 超时 / JSON 解析不出** → 回退到 `tokenizeText` 原逻辑，**不阻断检索**

## 完成标准

- [ ] `sqlite.ts` 的 `beforeTurn` 只负责构造 `pendingMemoryQuery`，不再直接喂检索
- [ ] `runner.ts` 新增 `runPendingMemoryQuery`，签名 / 结构照抄 `runPendingMemoryWrite`
- [ ] Observer 里能看到这一次 `kind: 'memory'` + `metadata.phase: 'retrieve'` 的 call，含 prompt / response / 解析出的 keywords
- [ ] 单测：
  - mock LLM 返回 `{"keywords": ["name", "名字"]}` → 断言实际跑的是 LLM 给的 keywords 而非 tokenizer
  - mock LLM 抛错 → 断言回退到 tokenizer 结果、检索照样跑、yield `system_error` 事件（跟 memory summarize 失败同 pattern）
  - mock LLM 返回非法 JSON / 空 keywords → 断言同样回退到 tokenizer
- [ ] 现有 D1 测试继续过；`npm test --workspace @mas/systems --workspace @mas/core` / `npm run typecheck --workspace @mas/systems --workspace @mas/core` 全过
- [ ] 关闭记忆（`modules.memory.scheme = "noop"`）时不发 retrieve call，和现在一致

## 备注

- **先读** `packages/systems/src/memory/sqlite.ts` 和 `packages/core/src/agent/runner.ts` 里 `runPendingMemoryWrite` 的实现，新函数照抄结构省事
- Observer 前端已经把 `kind: 'memory'` 渲染得够用，**不用改前端**；phase 字段留给后续想分视图时用
- **不要**提前做 cache / 短输入跳过 / `kind: 'memory_query'` 新枚举 —— 都明确砍掉
- **不要**动 `findRelevantMemories` / SQL；这个 task 只换 keywords 来源
