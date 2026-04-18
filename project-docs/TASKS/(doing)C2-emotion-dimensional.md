# C2 — Emotion（dimensional 方案）

**状态**: pending
**前置依赖**: B6（模块化基座，已完成）
**预计规模**: medium

## 目标

给虚拟人一个**会被对话改变**的情绪状态。用三维向量 mood / energy / stress（各 -1..1 或 0..1）表示，**每轮对话**都会：
1. `beforeTurn` 加载当前状态，`beforeLLM` 把"当前情绪"渲染成文本片段注入 system prompt
2. `afterLLM` 让 LLM 顺手分析"这一轮聊天对情绪的影响"（用同一个 provider/model），给出 delta
3. `afterTurn` 把 delta 应用到状态、做时间衰减回归基线、持久化到 DB

效果：骂它会不开心、夸它会开心、过一阵自己回归基线。同样问题在不同情绪下回答略不同。

这是 `emotion` 系统类型的 `dimensional` 方案，登记到 B6 的 `systemRegistry`。参数走 `agents.modules.emotion` JSON。状态持久化用**新增的 `emotion_states` 表**（不要塞进 agents.modules JSON）。

## 涉及文件

- `packages/systems/src/emotion/dimensional.ts`（新建，实现 `AgentSystem` 接口）
- `packages/systems/src/emotion/index.ts`（新建，barrel 导出）
- `packages/systems/src/registry.ts`（修改，加 `emotion.dimensional` 一行；保留 `emotion.noop`）
- `packages/systems/src/index.ts`（修改，barrel re-export 新 system；如果 C1/C4/B5 已经定了模式照搬）
- `packages/db/src/schema.ts`（新增 `emotion_states` 表定义）
- `packages/db/migrations/<next-num>_*.sql`（新建迁移）+ `meta/_journal.json` + `meta/<next>_snapshot.json`（用 `npx drizzle-kit generate` 生成；不要手写）
- `apps/web/src/lib/db-init.ts`（如有按需 ALTER 兜底，加一行确保 `emotion_states` 存在；参考现有 pattern）
- `apps/web/src/app/page.tsx`（**最小化**：在"模块配置"分区加一个**只有开关 + 可选 baseline 滑块**的小卡，不要做复杂 UI；当前情绪状态由 Observer 看，不在 form 里）

不要碰：`runner.ts` / `chat/route.ts`（B6 的 `createSystems(agent?.modules)` 已经接好）

## `modules.emotion` JSON 约定

```jsonc
{
  "emotion": {
    "scheme": "dimensional",
    "baseline": {                  // 选填，缺省都 0（中性）
      "mood": 0.2,                 // -1..1，正向偏开心
      "energy": 0.5,               // 0..1
      "stress": 0.1                // 0..1
    },
    "decayPerTurn": 0.15,          // 选填，每轮回归基线的比例，默认 0.1
    "analysisModel": null          // 选填；null = 用 agent.model；后续可单独指定一个便宜 model
  }
}
```

字段缺失 → 走默认；`scheme: "noop"` 或 `modules.emotion` 缺失 → 不注入、不存状态。

## 数据库

新增 `emotion_states` 表：

```ts
emotion_states {
  id              text primary key
  agentId         text references(agents.id)
  sessionId       text references(sessions.id)  // 便于 Observer 按会话回放
  state           text  // JSON: { mood, energy, stress }
  delta           text  // JSON: 这一轮分析出来的变化（可空，初始状态时无）
  trigger         text  // 短句：触发情绪变化的本轮关键事件（LLM 给的一句话）
  createdAt       integer (timestamp_ms)
}
```

每轮 `afterTurn` 写一条新记录（**不更新旧的**，保留情绪轨迹用于 Observer / 后续分析）。`beforeTurn` 取该 agent + session 最新一条作为当前状态；没有则用 baseline。

## `afterLLM` 的情绪分析调用

- 用 **当前 agent 的 provider + model**（不要硬编码）：在 system instance 里通过 registry factory 接收 `provider` 句柄，或者跟 B5 类似让 system 仅产出 prompt + 由 runner 触发 LLM call。**优先方案**：复用 B5 已建立的 "system 产 pendingXxx → runner 真正调 LLM" 模式，避免 system 层直接持有 provider 依赖
- 分析 prompt 模板要明确产出 JSON：`{ "mood_delta": -0.3, "energy_delta": 0.0, "stress_delta": 0.2, "trigger": "用户用了不耐烦的语气" }`，runner 解析后 clip 到合法区间
- LLM call 用 Observer `kind: 'emotion'` 标记（参考 B5 的 `kind: 'compaction'` 模式），别和正常 turn 混计

## 完成标准

- [ ] `dimensional.ts` 实现 `AgentSystem`：
  - `beforeTurn`：从 DB 读当前状态写入 `ctx.state.emotion`
  - `beforeLLM`：把当前情绪语言化（如"当前心情：略微低落；精力：中等；压力：偏高"）写入 `ctx.promptFragments`，`priority: 20`（DESIGN §10.10）
  - `afterLLM`：构造分析 prompt，挂到 `ctx.pendingEmotionAnalysis`（参考 B5 的 `pendingCompaction` 形式扩 TurnContext）；runner 触发 LLM 调用拿 delta
  - `afterTurn`：apply delta + 衰减 + 写一条新 `emotion_states`
- [ ] `registry.ts` 支持字符串 `dimensional` 实例化；`emotion.noop` 保留
- [ ] DB 迁移生成、`db-init.ts` 兜底 OK，sqlite3 能看到 `emotion_states` 表
- [ ] Observer 能看到该 turn 的"情绪 LLM call"和最新 emotion_states 行；UI 至少在 turn 详情里显示当前 mood/energy/stress 数值
- [ ] 同一个 agent，故意骂它两轮 → mood 显著下降；夸它两轮 → 回升（手动验证）
- [ ] 单测：给定 fixture 状态 + 模拟 LLM 返回 delta，断言衰减 + apply 后的最终状态在合理区间；空 modules / `scheme: noop` 时不写入 emotion_states
- [ ] `npm run typecheck` / `npm test --workspace @mas/systems --workspace @mas/core` 全过
- [ ] 关闭（`scheme: "noop"` 或字段缺失）时行为完全等同 B5 落地后的 noop 状态，Observer 里没有 emotion call

## 备注 / 注意事项

- **不要做**：discrete categories（开心/愤怒/悲伤分类）、PAD 模型、emotion 触发 tool call、跨 session 累积情绪 —— 都留 Phase 3+
- **状态属于 (agentId, sessionId)** —— 不要做"全局情绪"。换会话情绪重置（取 baseline）
- 衰减公式：`new = current + (baseline - current) * decayPerTurn` 然后再 apply delta；clip 到合法区间
- **TurnContext 扩展**：添加 `pendingEmotionAnalysis?` 字段时参考 B5 的 `PendingCompaction` 写法，写 Completion Note 披露
- **不要让 system 直接持有 provider** —— B5 已经用"system 产意图 / runner 执行"模式把 provider 隔离出去了，emotion 沿用同模式
- **先读** `packages/systems/src/compaction/summary.ts` 看 B5 怎么扩 TurnContext + 怎么让 runner 帮自己跑 LLM —— 这是关键参考
- **先读** `packages/systems/src/personality/big-five.ts` 看 beforeLLM 怎么写 promptFragment
- DESIGN §4.4.3 / §10.10 / §11 (C2 行) 为权威；扩 TurnContext / 加 Observer kind 这种偏离要走 Completion Note
