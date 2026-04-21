# D1d — Memory 查询拆分为双 LLM 分析器

**状态**: pending
**前置依赖**: 当前 `memory:sqlite` embedding 检索链路已完成；与 Daemon / STM / LTM 无依赖
**预计规模**: medium

## 目标

把当前 `memory.retrieve` 的**单次查询分析**拆成两个独立的 LLM 调用：

- `time analyzer`：只负责输出 `time_range`
- `semantic analyzer`：只负责输出 `retrieval_query` 与 `focus`

然后在运行时把两者合并为最终的 memory 查询元数据，再进入现有 embedding 检索流程。

这张卡的核心目标是提升**时间表达 + 主题表达混合问法**的泛化稳定性，例如：

- `我刚刚和你说了什么`
- `前天上午我们聊了什么`
- `你还记得前天上午聊的画面吗`
- `你昨天在修什么 bug`

同时必须把 Observer 一并补齐：聊天抽屉和独立 `/observer` 页面都要能看出这次 memory 查询其实由两个分析器组成，而不是继续表现成一个黑盒 retrieve call。

## 涉及文件

**修改**
- `packages/core/src/agent/runner.ts`
- `packages/core/src/agent/memory-runner.test.ts`
- `packages/systems/src/memory/sqlite.ts`
- `packages/systems/src/memory/sqlite.test.ts`
- `packages/systems/src/types.ts`
- `apps/web/src/app/chat/ObserverDrawer.tsx`
- `apps/web/src/app/chat/ObserverDrawer.test.tsx`
- `apps/web/src/lib/call-renderers.tsx`
- `apps/web/src/lib/call-renderers.test.tsx`

**可选修改**
- `apps/web/src/app/observer/DetailPane.tsx`
- `apps/web/src/app/chat/observer-types.ts`
- `apps/web/src/app/chat/observer-utils.ts`

不要碰：
- memory schema / `memory.db`
- memory 管理页功能
- Daemon / STM / LTM
- 排序算法的大改
- 代码层硬编码时间解析器

## 完成标准

### 数据与调用链（可自动验证）
- [ ] `memory.retrieve` 不再用一个 LLM prompt 同时产出 `retrieval_query + time_range + focus`
- [ ] 改为两个独立 pending/query 调用：
- [ ] `time analyzer` 只输出 `time_range`
- [ ] `semantic analyzer` 只输出 `retrieval_query + focus`
- [ ] 两个 analyzer 都走结构化输出（沿用现有 OpenRouter `json_schema` 路径）
- [ ] 两个 analyzer 的输出会在进入 repository 检索前合并成统一 metadata
- [ ] `retrieval_query` 允许为 `null`
- [ ] `time_range` 允许为 `null`
- [ ] 纯时间回顾问题（如 `我刚刚和你说了什么`）在 merged metadata 中表现为：
- [ ] `retrieval_query = null`
- [ ] `time_range != null`
- [ ] 时间 + 主题混合问题（如 `前天上午聊的画面`）在 merged metadata 中表现为：
- [ ] `retrieval_query != null`
- [ ] `time_range != null`
- [ ] 纯主题问题（如 `你还记得我养的猫叫什么吗`）在 merged metadata 中表现为：
- [ ] `retrieval_query != null`
- [ ] `time_range = null`

### Observer（必须包含在本卡）
- [ ] `memory.retrieve` 的 Observer 信息能区分两个 analyzer，而不是继续只有一个模糊的 retrieve 黑盒
- [ ] 聊天页抽屉可见：
- [ ] `time analyzer` 的输出
- [ ] `semantic analyzer` 的输出
- [ ] merged 后的最终 memory query metadata
- [ ] 独立 `/observer` 页面也能看到同样的信息，不要求重做布局，但不能只剩原始 JSON 才能读懂
- [ ] 如果某个 analyzer 失败，Observer 能明确看出失败的是哪一个 analyzer
- [ ] 最终 merged metadata 至少包含：
- [ ] `retrievalQuery`
- [ ] `focus`
- [ ] `timeRange`

### 测试与验证
- [ ] 单测补齐：
- [ ] `semantic analyzer` 解析结果测试
- [ ] `time analyzer` 解析结果测试
- [ ] merge 行为测试
- [ ] `runner` / memory retrieve 调用次数测试（确认 memory 查询分析确实变成两次 LLM 调用）
- [ ] Observer 渲染测试更新
- [ ] 至少做一轮真实对话验证，不只跑单测；需要结合 Observer 确认两个 analyzer 都实际被调用并落出可读结果
- [ ] 至少覆盖以下 3 类真实问法：
- [ ] 纯时间：`我刚刚和你说了什么`
- [ ] 时间 + 主题：`你还记得前天上午聊的画面吗`
- [ ] 纯主题：`你还记得我养的猫叫什么吗`
- [ ] `typecheck / test` 通过

## 非目标（明确不做）

- ❌ 不写代码层时间表达规则引擎
- ❌ 不新增第三个 analyzer
- ❌ 不改 embedding provider / memory schema
- ❌ 不改 memory prompt 注入结构之外的排序策略
- ❌ 不顺手做 STM / LTM / 睡眠机制 / hybrid / rerank

## 设计约束

- 这是一次**prompt 任务拆分**，不是规则引擎任务
- `time analyzer` 只负责“什么时候”
- `semantic analyzer` 只负责“是什么”
- `retrieval_query` 中不应混入时间信息
- `focus` 只是解释性元数据，不要再拿它驱动 `topK` 等检索行为
- 这张卡完成后，Observer 必须帮助调试这两个 analyzer 的行为，否则后续继续压 prompt 会很痛苦

## 备注 / 注意事项

- 这是明显的 hot-file task，至少会碰：
- `packages/core/src/agent/runner.ts`
- `packages/systems/src/memory/sqlite.ts`
- Observer 渲染相关文件
- 不适合和其他 memory / observer task 并行
- 当前已知背景：
- 单 analyzer 方案里，`retrieval_query` 容易被时间表达和“内容/事情/讨论”这类回顾外壳污染
- 离线实验显示：拆成 `time analyzer + semantic analyzer` 后，主题锚点提炼明显更干净；这张卡就是把那条路线正式落进项目
- 如果最终实现需要为 Observer 增加更细的 `phase` / `subkind` / metadata 字段，优先保持命名清晰，不要做“靠 message 文本猜是哪条 analyzer”的隐式方案
