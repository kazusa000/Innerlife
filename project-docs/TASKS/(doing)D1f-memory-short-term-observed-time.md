# D1f — 短期记忆 observed 时间范围

**状态**: pending
**前置依赖**: D1e / G1（已完成）
**预计规模**: medium

## 目标

把 short-term memory 的时间语义从“生成时间”改成“被观察到的上下文时间范围”。新写入的短期记忆需要带 `observed_start_at` / `observed_end_at`，检索、prompt 注入、API 和管理页都要优先使用这个时间范围。

这对应 DESIGN.md §10.6 / §10.8 的 context → STM → LTM 分层记忆流水线。当前 STM 是从旧上下文提炼出来的，`created_at` 只能代表记忆行生成时间，不能代表事件发生时间；时间检索继续用 `created_at` 会导致“昨天聊过什么”这类查询不准确。

## 涉及文件

**修改**
- `packages/db/src/memory-client.ts`
- `packages/db/src/repository/memories.ts`
- `packages/systems/src/memory/sqlite.ts`
- `packages/daemon/src/memory-jobs.ts`
- `apps/web/src/app/api/agents/[id]/memory/sqlite/handler.ts`
- `apps/web/src/app/agent/[id]/memory/MemoryManager.sqlite.tsx`
- memory / daemon / route 相关测试

## 完成标准

### 数据层与写入链路（可自动验证）
- [ ] `memories` 表兼容新增 nullable `observed_start_at` / `observed_end_at`，老库自动补列，不需要破坏性迁移。
- [ ] `MemoryRecord` / `addMemory` / sqlite row mapper 支持 observed 时间范围；`createdAt` 仍内部保留用于审计、排序 fallback 和兼容老数据。
- [ ] daemon 执行 context → STM 时，用被整理消息块的最早 / 最晚 `createdAt` 写入 short_term 的 `observedStartAt` / `observedEndAt`。
- [ ] `buildContextToShortTermSourceText(...)` 给 LLM 的源文本包含整理窗口时间范围，并在必要时给每条历史消息带本地时间，避免 LLM 写出无时间依据的短期记忆。
- [ ] long_term / fixed 不被强制改成 observed 语义；本任务只修 STM 时间语义。

### 检索与 prompt 注入（可自动验证）
- [ ] short_term 在带 `timeRange` 检索时使用 observed range overlap：`observed_start_at <= end` 且 `observed_end_at >= start`。
- [ ] 老 short_term 记录如果缺少 observed range，在带时间范围检索时不假装命中；不带时间范围的语义检索仍可正常命中。
- [ ] fixed 检索继续按现有规则使用 `created_at`，不受 STM observed 改动影响。
- [ ] 注入主 prompt 时，short_term 显示“发生于 observed_start - observed_end”；缺失 observed range 时显示“时间未知”，不要显示 misleading 的生成时间。
- [ ] STM → LTM 源文本如果需要时间信息，优先传递 STM observed range，而不是只传 `createdAt`。

### API 与 UI（需要自动 + 手动验证）
- [ ] `/api/agents/[id]/memory/sqlite` 返回 `observedStartAt` / `observedEndAt`。
- [ ] 记忆管理页短期记忆行的时间列显示 observed range；详情里可以保留内部生成时间。
- [ ] 老短期记忆缺少 observed range 时，页面明确显示“时间未知”或等价文案。
- [ ] typecheck 通过。
- [ ] 相关单测通过。
- [ ] 浏览器手动验证至少 2 个场景：新 flush 的 short_term 显示上下文发生时间；老 short_term 显示未知但页面不报错。
- [ ] typecheck + 测试通过不等于任务完成，必须浏览器人工验证。

## 非目标（明确不做）

- ❌ 不处理长期记忆融合后的复杂时间模型；LTM 时间标注另开任务讨论。
- ❌ 不批量回填旧 memory.db 的 historical short_term observed 时间。
- ❌ 不删除旧测试记忆；清理入口由 D4b 处理。
- ❌ 不改变 semantic analyser 的 query 生成策略。
- ❌ 不改变 fixed memory 的时间语义。

## 备注 / 注意事项

- `memory.db` 是 sqlite 记忆真实存储，重点看 `packages/db/src/memory-client.ts`，不要只改主库 schema。
- `findRelevantMemories(...)` 当前对所有 layer 使用 `created_at` 过滤；本任务需要按 layer 分支处理，避免 fixed 被误改。
- `packages/daemon/src/memory-jobs.ts` 的 `runContextFlushForSession` 已经能拿到被 flush 的候选消息，observed range 应从这个候选块计算。
- 合并冲突风险：本任务会触碰 `MemoryManager.sqlite.tsx` 和 memory API；如果 D4b 同时执行，需要串行合并或协调 UI toolbar/时间列改动。
