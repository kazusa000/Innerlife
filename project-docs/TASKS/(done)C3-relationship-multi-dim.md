# C3 — Relationship（multi-dim 方案）

**状态**: done
**前置依赖**: B6（已完成）
**预计规模**: medium

## 目标

给虚拟人一个**持续变化的关系状态**，让它对“熟人”和“陌生人”、对“值得信任的人”和“刚冒犯过自己的人”有不同的表达倾向。

本 task 只实现 `relationship` 系统类型下的 `multi-dim` 方案：

- `trust`
- `affinity`
- `familiarity`
- `respect`

当前范围只做 **user ↔ agent** 关系。`agent ↔ agent` 关系留给 F1。  
当前范围只做**系统本身和持久化**，不做统一入口 UI、不做图谱页。

## 涉及文件

- `packages/systems/src/relationship/multi-dim.ts`（新建，实现 `AgentSystem` 接口）
- `packages/systems/src/relationship/index.ts`（新建，barrel 导出）
- `packages/systems/src/registry.ts`（修改，加 `relationship.multi-dim` 一行；保留 `relationship.noop`）
- `packages/systems/src/index.ts`（修改，barrel re-export）
- `packages/systems/src/types.ts`（按需修改，补 relationship state / pending analysis 类型）
- `packages/db/src/schema.ts`（新增 `relationships` 表定义）
- `packages/db/src/repository/relationships.ts`（新建，关系读取 / 写回）
- `packages/db/src/repository/relationships.test.ts`（新建）
- `packages/db/migrations/<next-num>_*.sql`（用 `npx drizzle-kit generate` 生成）+ meta 文件
- `apps/web/src/lib/db-init.ts`（如现有模式需要，补表存在兜底）

不要碰：

- `apps/web/src/app/page.tsx`（本 task 不做模块配置 UI）
- `apps/web/src/app/observer/*`、`apps/web/src/app/chat/ObserverDrawer.tsx`（本 task 不加新的 observer kind）
- `/agent/[id]/relationships` 页面（统一入口 / 图谱视图后续单独 task）

## `modules.relationship` JSON 约定

```jsonc
{
  "relationship": {
    "scheme": "multi-dim",
    "baseline": {
      "trust": 0.5,
      "affinity": 0.4,
      "familiarity": 0.1,
      "respect": 0.5
    },
    "decayPerTurn": 0.05,
    "analysisModel": null
  }
}
```

- `scheme: "noop"` 或字段缺失 → 行为等同关闭
- baseline 全缺时走默认值
- `analysisModel: null` = 用当前 agent 的主模型

## 数据模型

`relationships` 表按“一个 counterpart 一条当前关系记录”存：

```ts
relationships {
  id          text primary key
  agentId     text references(agents.id)
  counterpartType text        // 'user' | 'agent'
  counterpartId   text        // 当前阶段先写 'default-user'
  dimensions   text           // JSON: { trust, affinity, familiarity, respect }
  history      text           // JSON array，记录最近几次变化摘要
  updatedAt    integer
}
```

当前 C3 只允许 `counterpartType = 'user'`。F1 再扩到 `agent`。

## 生命周期约定

- `beforeTurn`
  - 读取当前 `(agentId, default-user)` 的最新关系；没有就用 baseline 初始化到 `ctx.state.relationship`
- `beforeLLM`
  - 把当前关系渲染成 prompt fragment，例如：
    - “你对当前用户的熟悉度较低，但基本信任对方”
    - “你与当前用户已经非常熟悉，亲和度较高”
- `afterLLM`
  - 复用 B5/C2 的 pending-analysis 模式，挂出一次 relationship analysis 请求，让 runner 用 LLM 产出本轮 delta JSON
- `afterTurn`
  - 应用 delta、clip 到 0..1、轻微衰减回 baseline、写回 `relationships` 表，并追加简短 history

## 完成标准

- [x] `relationship.multi-dim` 已登记到 registry；`relationship.noop` 保留
- [x] `multi-dim` 系统实现 `beforeTurn` / `beforeLLM` / `afterLLM` / `afterTurn`
- [x] 关系维度至少包含 `trust / affinity / familiarity / respect` 四轴，范围都在 `0..1`
- [x] 当前阶段只支持 `user ↔ agent`；代码和任务说明都没有偷偷扩到 `agent ↔ agent`
- [x] `relationships` 表 + repository 落地；首次对话时会自动初始化 baseline
- [x] prompt 注入有效：同一个 agent 在“高 trust / 高 familiarity”和“低 trust / 低 familiarity”下回答风格有可观察差异
- [x] 单测覆盖：
  - [x] baseline 初始化
  - [x] delta 应用后会 clip 到合法区间
  - [x] `scheme: noop` 时完全不写表、不注入 fragment
  - [x] history 追加逻辑正常
- [x] `npm run typecheck` / `npm test --workspace @mas/systems --workspace @mas/db --workspace @mas/core` 全过

## 备注 / 注意事项

- **不要做 UI。** `/agent/[id]/relationships` 统一入口和图谱可视化后续单独 task
- **不要做 agent ↔ agent。** 那是 F1，不要在 C3 里提前抽一套“大而全”的 relationship service
- **不要加新的 observer kind。** 这会撞 observer hot files；本 task 先把关系系统本身跑通
- 更新 relationship 的分析调用沿用 emotion / memory 的 pending-analysis 模式，不要让 system 直接持有 provider
- prompt fragment 建议 `priority` 介于 personality 和 memory 之间，避免压过性格但又早于价值观；具体数值由执行 agent结合现有顺序选一个稳定值，并在 Completion Note 里披露
- 未来不管 `relationship` 增加 `simple` 还是别的 scheme，管理入口仍然是 `/agent/[id]/relationships`；但那不意味着要复用这张卡里的数据 shape 或 UI 语义

## Completion Note

- **Changes**: 重新落地 `relationship:multi-dim`，新增 `relationships` 表、`relationshipRepo`、relationship system、registry/index/types 导出，以及 runner 对 relationship pending-analysis 的执行与解析；repository API 改成只暴露 user counterpart，不再把 `agent` 带进 schema/repository 的可用类型面。
- **Verified**: `npm test --workspace @mas/systems --workspace @mas/db --workspace @mas/core`、`npm run typecheck --workspace @mas/systems --workspace @mas/db --workspace @mas/core`、`npm run build --workspace @mas/web` 全过；新增单测直接证明 `relationship.noop` 时 main turn `systemPrompt` 仍为基础 prompt 且 `relationships` 表写入数为 0。
- **Caveats**: prompt fragment priority 仍选 `40`，位于 emotion(`20`) 之后、values(`50`) 之前；未新增 observer kind，关系分析仍走现有 system_error / pending-analysis 路径。
- **Design deltas** (if any): 无设计偏移；这次按审核意见把当前阶段的 counterpart 范围严格收回到 `user`。
- **回答风格差异验证**: 额外用主工作树 `.env` 的真实 provider（`claude-sonnet-4-6`）做了两组同 prompt 对比。对同一句“别再来问我了，直接替我决定技术路线并往下推进。”，低关系基线回复为“基于当前项目情况直接选择技术方案并执行，如有重要节点会同步给您确认”，高关系基线回复为“决定采用微服务架构，并开始搭建基础框架。有重大进展或需要确认时再同步给你”。前者更保守、保留确认口径，后者更直接地下判断并推进，满足“可观察差异”。
