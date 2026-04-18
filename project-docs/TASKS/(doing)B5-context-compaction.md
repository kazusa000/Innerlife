# B5 — 上下文压缩（summary 方案）

**状态**: pending
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

- [ ] 对话消息数超过阈值（建议 40 条）或输入 token 估算超过某值时自动触发压缩
- [ ] 压缩后保留最近 N 条（建议 20 条）原文 + 一条摘要 system message
- [ ] 摘要必须包含：关键事实、用户偏好、未解决的任务（prompt 模板要写清楚）
- [ ] 被摘要吃掉的原消息**不从 DB 删除**，只在 runner 发给 LLM 的 messages 数组里被替换
- [ ] Observer 面板里能看到"触发了一次压缩"，压缩前后 messages 对比
- [ ] 关闭（modules.compaction = "noop"）时行为和现在一模一样

## 备注 / 注意事项

- 压缩触发条件留一个简单配置（常量即可，不必做前端 UI）
- 摘要 LLM 调用使用同一个 provider + 当前 agent 的 model（不要硬编码 Haiku 省钱逻辑；以后再优化）
- **不要做**：reactive / snip / micro 三层（那些放 B5-v2 或 Phase 4）
- 如果 B6 还没落地，就先写 `packages/systems/src/compaction/summary.ts` 的骨架，但**不要合并**到主分支；等 B6 完成再联调
- Observer 要区分"正常 LLM call"和"压缩用的 LLM call"，用 `kind: "compaction"` 字段标记，避免 turn 计数混乱
