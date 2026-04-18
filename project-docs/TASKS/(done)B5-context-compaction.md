# B5 — 上下文压缩（summary 方案）

**状态**: done
**前置依赖**: B6（模块化系统基座）—— compaction 以 `AgentSystem` 形式实现
**预计规模**: medium

## 目标

对话变长后 token 爆掉。做**最简一层**的上下文压缩：消息数或预估 token 超过阈值时，用 LLM 把"较早的一段消息"摘要成一条 `system` 消息，保留最近 N 条原文。

这是 `compaction` 系统类型的 `summary` 方案。登记到 B6 的 systemRegistry，通过 `agents.modules.compaction = "summary"` 启用。

参考：`reference-project/claude-code/src/services/compact/`（四层 auto/reactive/snip/micro），本 task 只做 `auto` 层。

## 涉及文件

- `packages/systems/src/compaction/summary.ts`（新建，实现 AgentSystem 接口）
- `packages/systems/src/compaction/index.ts`（导出注册）
- `packages/systems/src/registry.ts`（在 registry 里加 `compaction.summary`）
- 可能需要在 runner 的 beforeLLM 阶段让 compaction 有机会改写 `messages`（不只是 promptFragments）—— 如果 B6 当前的钩子不够用，需要和 Coordinator 沟通扩展方案

## 完成标准

- [x] 对话消息数超过阈值（建议 40 条）或输入 token 估算超过某值时自动触发压缩
- [x] 压缩后保留最近 N 条（建议 20 条）原文 + 一条摘要 system message
- [x] 摘要必须包含：关键事实、用户偏好、未解决的任务（prompt 模板要写清楚）
- [x] 被摘要吃掉的原消息**不从 DB 删除**，只在 runner 发给 LLM 的 messages 数组里被替换
- [x] Observer 面板里能看到"触发了一次压缩"，压缩前后 messages 对比
- [x] 关闭（modules.compaction = "noop"）时行为和现在一模一样

## 备注 / 注意事项

- 压缩触发条件留一个简单配置（常量即可，不必做前端 UI）
- 摘要 LLM 调用使用同一个 provider + 当前 agent 的 model（不要硬编码 Haiku 省钱逻辑；以后再优化）
- **不要做**：reactive / snip / micro 三层（那些放 B5-v2 或 Phase 4）
- 如果 B6 还没落地，就先写 `packages/systems/src/compaction/summary.ts` 的骨架，但**不要合并**到主分支；等 B6 完成再联调
- Observer 要区分"正常 LLM call"和"压缩用的 LLM call"，用 `kind: "compaction"` 字段标记，避免 turn 计数混乱

## Completion Note

- **Changes**: 新增 `compaction.summary` AgentSystem，在 `beforeLLM` 前按消息数 / 粗略 token 估算触发一次摘要调用；runner 用一条 `system` 摘要消息替换早期上下文并保留最近 20 条原文。根据 review 退回补了一次修复：连续 compaction 时会保留上一轮的 compaction summary，不再把早期摘要丢掉；同时新增回归测试覆盖该场景。Observer / DB / Web 同步新增 `kind` 与 compaction metadata，可查看压缩前后 messages 对比。
- **Verified**: `npm --workspace @mas/core test`；`npm --workspace @mas/systems test`；`npm --workspace @mas/core run typecheck`；`npm --workspace @mas/systems run typecheck`；`npm --workspace @mas/db run typecheck`；`npm --workspace @mas/observer run typecheck`；`npm --workspace @mas/web run build`
- **Caveats**: token 估算目前是基于消息 JSON 字符数的粗略近似值，适合作为 Phase 1 触发阈值，不保证与 provider 真实计费 token 完全一致。
- **Design deltas**: 为了让 compaction 仍以 AgentSystem 形式接入，但能在主 LLM 调用前改写 `messages`，我扩展了 `TurnContext`，新增可变 `messages` 与 `pendingCompaction`。具体压缩调用仍由 runner 执行，避免系统层直接持有 provider 依赖。

## Coordinator Review Feedback (2026-04-18)

**Verdict: FAIL — bounced back**

第 2 条完成标准（"压缩后保留最近 N 条原文 + 一条摘要 system message"）实际执行时存在 high 级别 bug：

**问题**：连续压缩会丢早期摘要。`packages/systems/src/compaction/summary.ts:41` 在下一轮 compaction 时把 `sourceMessages` 中所有 `role === 'system'` 的消息过滤掉。但上一轮 compaction 的结果由 `runner.ts:295` 写成了一条 `system` 摘要 message —— 等于：第二次压缩看不到第一次压缩的产物，长对话经过多次压缩后，最早期的事实/偏好/未解决任务会被逐步**永久丢失**。

**复核证据**（reviewer 用 node 直接跑）：
```
{ "pending": true, "sourceHasSystem": false, "sourceCount": 20, "keepFirstRole": "user" }
```
`sourceHasSystem: false` = 已有摘要确实没被纳入新一轮压缩输入。

**修复方向**（建议，不锁死）：
- 在 `summary.ts` 区分"原始 system message"和"compaction 自己生成的 summary system message"。后者应该保留进入下一轮，前者按现行行为过滤
- 简单办法：给 compaction 生成的 summary message 打一个 metadata/前缀（如 `Conversation summary so far:` 已经是固定前缀了，可以基于此识别），或者加一个特殊 marker
- 或者：保留**最旧的一条 system summary**进入下一轮 source，与新历史合并重写
- 加一条单测：连续触发两次 compaction，断言第二轮的 summary input 包含上一轮 summary 的内容

**其他部分**：6 条标准里 5 条都过、所有 typecheck/test 全绿，是这一条逻辑漏洞。修完即可重新走 review。

## Rework Resolution (2026-04-18)

- 已按反馈修复：`summary.ts` 现在只过滤普通 `system` message，保留带 `Conversation summary:` 前缀的 compaction 摘要进入下一轮 `sourceMessages`
- `runner.ts` 改为复用同一个摘要前缀常量，避免生成端和识别端再次漂移
- 新增回归测试：连续触发 compaction 时，第二轮压缩输入必须包含上一轮摘要内容
