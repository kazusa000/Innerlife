# D4b — 记忆管理页一键清空当前 persona 记忆

**状态**: done
**前置依赖**: D4（已完成）
**预计规模**: small

## 目标

在 `/agent/[id]/memory` 的 sqlite 记忆管理页增加“一键清空当前 persona 全部记忆”能力，用来清掉测试期产生的 short_term / long_term / fixed 记忆，并保持操作范围只限当前 agent。

这延续 D4 的记忆管理入口能力。当前页面只能逐条删除，测试过程中会产生大量无效记忆；需要一个明确、危险但可控的清理动作，避免开发测试数据污染后续记忆效果判断。

## 涉及文件

**修改**
- `packages/db/src/repository/memories.ts`
- `apps/web/src/app/api/agents/[id]/memory/sqlite/handler.ts`
- `apps/web/src/app/api/agents/[id]/memory/sqlite/route.ts`
- `apps/web/src/app/agent/[id]/memory/MemoryManager.sqlite.tsx`
- memory sqlite route / UI 相关测试

## 完成标准

### API 与数据层（可自动验证）
- [x] 新增或扩展 collection 级删除接口，推荐 `DELETE /api/agents/[id]/memory/sqlite`。
- [x] 接口只删除当前 `agentId` 下 sqlite memory 表里的 `short_term / long_term / fixed` 记忆，不影响其他 persona。
- [x] 接口不删除 messages、sessions、emotion、relationship、observer、daemon event 或其他状态。
- [x] 非 sqlite memory scheme 时返回清晰错误或禁用路径，行为与现有 memory sqlite 管理 API 保持一致。
- [x] `memoryRepo.deleteMemoriesByAgent(agentId)` 返回删除条数，API 返回 `{ ok: true, deletedCount }` 或等价结构。
- [x] route tests 覆盖成功清空、agent 不存在、非 sqlite scheme、不会误删其他 agent 记忆。

### UI 层（必须手动验证）
- [x] Memory Rows 区域增加危险操作按钮，例如“清空全部记忆”。
- [x] 点击前必须有确认弹窗，文案明确说明会删除当前 persona 的短期、长期、固化记忆。
- [x] 成功后刷新列表、重置分页/展开行，并显示删除条数。
- [x] 删除失败时保留现有列表并显示错误。
- [x] 空列表状态下按钮行为合理：可以禁用，或确认后返回删除 0 条。
- [x] typecheck 通过。
- [x] 相关测试通过。
- [x] 浏览器手动验证至少 2 个场景：有记忆时清空并看到列表归零；无记忆时不报错。
- [x] typecheck + 测试通过不等于任务完成，必须浏览器人工验证。

## 非目标（明确不做）

- ❌ 不提供跨 persona / 全局清空所有 agent 记忆的入口。
- ❌ 不清空 active context；聊天页上下文清理仍走 D4a 的功能。
- ❌ 不做 memory.db 文件级删除或重建。
- ❌ 不新增自动定时清理策略。
- ❌ 不处理旧记忆时间回填；D1f 单独处理 STM observed 时间。

## 备注 / 注意事项

- 用户当前明确想清掉测试期旧记忆；本任务完成后应通过 UI/API 手动清空，不要用 migration 或启动逻辑自动删库。
- 现有单条删除接口是 `/api/agents/[id]/memory/sqlite/[memoryId]`，collection 级清空不要复用单条 route。
- 这是危险操作，UI 需要使用明显的 destructive 样式和二次确认。
- 合并冲突风险：本任务会触碰 `MemoryManager.sqlite.tsx`；如果 D1f 同时改时间列和详情展示，建议串行执行或合并时由 coordinator 统一处理。

## Completion Note

- **Changes**: Added `DELETE /api/agents/[id]/memory/sqlite`, returning `{ ok, deletedCount }`, backed by `memoryRepo.deleteMemoriesByAgent(agentId)`. Added a Memory Rows destructive “清空全部记忆” UI action with confirmation, refresh, pagination reset, expanded-row reset, success count, and error handling.
- **Verified**: `node --import tsx --test packages/db/src/repository/memories.test.ts`; `node --import tsx apps/web/src/app/api/agents/\[id\]/memory/sqlite/route.test.ts`; `node --import tsx apps/web/src/app/agent/\[id\]/memory/MemoryManager.sqlite.state.test.ts`; `npm run typecheck --workspace @mas/db`; `npm run typecheck --workspace @mas/web`; `npm run build --workspace @mas/web`; browser/CDP verification on `http://127.0.0.1:3006/agent/24690e58-8cda-49ce-8ad8-3393997acc3f/memory` for populated clear (3 -> 0) and empty clear (0 -> 0).
- **Caveats**: Browser verification used a temporary local persona and direct seeded sqlite memories in the D4b worktree dev database.
- **Design deltas** (if any): None.
