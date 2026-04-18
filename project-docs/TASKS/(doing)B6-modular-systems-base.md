# B6 — 模块化系统基座（TurnContext + AgentSystem + Registry + runAgent 改造）

**状态**: pending
**前置依赖**: 建议 B3（modules 字段）先落地；A1-A3/A4/B4 与本 task **并行**不冲突
**预计规模**: large（整个 Phase 2 的基石，不要求小）

## 目标

这是 Phase 2 的核心基础设施。完成后：
- runAgent 不再只是"调 LLM + 跑工具"，而是在 `beforeTurn / beforeLLM / afterLLM / afterTurn` 四个阶段暴露钩子给可插拔系统
- 所有"性格/情感/关系/记忆/价值观"等系统都通过同一个 `AgentSystem` 接口接入
- 每个虚拟人独立配置走哪些系统（通过 `agents.modules` JSON 字段）
- 加新系统只需：新文件 + registry 一行

**本 task 只做基础设施**。不实现任何具体系统（那些是 C1-C4 / D1-D4）。基础设施必须自带 `noop` 方案以保证现有功能（空 modules 的 agent）**不回归**。

详见 `../DESIGN.md §4.4` 和 `§10`。

## 涉及文件

- 新包 `packages/systems/`
  - `package.json`
  - `src/types.ts` — `AgentSystem` 接口、`TurnContext` 类型
  - `src/registry.ts` — `systemRegistry` + `createSystems(modules)` 函数
  - `src/noop.ts` — 通用 NoopSystem 实现
- `packages/core/src/agent/runner.ts`（改造）
  - 接受 `systems: AgentSystem[]` 参数
  - 在循环入口创建 TurnContext
  - 在 LLM 调用前后插入 beforeTurn / beforeLLM / afterLLM / afterTurn 钩子
  - 基础 system prompt 与 `ctx.promptFragments` 按 priority 排序拼接
- `apps/web/src/app/api/chat/route.ts`（调用 runAgent 的地方）
  - 从 `agents.modules` 读配置 → 调 `createSystems` → 传给 runAgent
- 根 `package.json` / `tsconfig.json`（注册新 workspace）

## 完成标准

- [x] 空 modules（或 modules 全为 noop）的 agent 行为与当前完全一致（**无回归**）
- [x] TurnContext 在一轮对话内贯穿，系统能读 / 写自己那部分 state
- [x] promptFragments 按 priority 排序后正确拼接到 system prompt（Observer 里可验证）
- [x] 至少写一个"玩具系统"验证链路通（比如 `hello-world` 系统，在 beforeLLM 往 promptFragments 里塞一行 `"(Debug: hello from system)"`，能在 Observer 里看到该字符串进了 system prompt）
- [x] `packages/systems/` 能被 core + apps/web 正确引用（workspace 路径）
- [x] registry 支持：用字符串方案名（如 `modules.emotion = "noop"`）动态实例化系统
- [x] 更新 DESIGN 里如果发现与实际实现有分歧，记录在 task 备注里（由 Coordinator 验收时回写 DESIGN.md）

## 备注 / 注意事项

- **生命周期契约**要严格：
  - beforeTurn 并发跑（系统之间不互相依赖输入，只读 DB）
  - beforeLLM 并发跑（各系统独立 push promptFragment）
  - afterLLM 并发跑
  - afterTurn 并发跑（持久化）
  - 任何系统抛错 → **不阻断** agent 主流程，但要 yield 一个 `{ type: 'system_error', system: string, error }` 事件让 Observer 看到
- 不要实现具体 emotion / personality。它们是独立 task。
- registry 的形状参考 DESIGN §4.4.3：`Record<systemType, Record<schemeName, () => AgentSystem>>`
- 看得见的"玩具系统"验证很重要——没有它就等于什么都没证明
- 本 task 可能导致 runAgent 签名变化，所以要**同时**改 apps/web 的 chat route（别留半吊子）
- Observer 里最好能显示每个钩子阶段耗时（后面 C/D 性能调优会用）——如果不费事就加上，费事就留给后续 task

## Completion Note

- **Changes**: 新增 `@mas/systems` workspace，提供 `TurnContext` / `AgentSystem` / registry / `noop` 与 `debug:hello-world` 玩具系统；`runAgent` 现在支持 `beforeTurn`、`beforeLLM`、`afterLLM`、`afterTurn` 生命周期、按优先级拼接 prompt fragments，并在系统抛错时发出 `system_error` 但不中断主流程。`apps/web` chat route 已从 `agents.modules` 实例化系统并将 `sessionId` / `userId` 注入 runner。
- **Verified**: `npm test --workspace @mas/core -- src/agent/runner.test.ts` 通过；`npm test --workspace @mas/systems` 通过；`npm run typecheck --workspace @mas/core` 通过；`npm run typecheck --workspace @mas/systems` 通过；`npm run build --workspace @mas/web` 通过。
- **Caveats**: 当前 registry 仅接入 `debug` 类型（`noop` / `hello-world`），其余 personality/emotion/memory 等具体系统留给后续任务；`system_error` 已通过 SSE 可见，但本 task 没额外实现每个生命周期阶段耗时统计。
- **Design deltas** (if any): 无功能性分歧；实现上额外兼容了对象形态模块配置（如 `{ debug: { scheme: 'hello-world' } }`），以减少后续前端配置格式耦合。
