# B10 — Observer 补全 relationship 可视化

**状态**: done
**前置依赖**: C3
**预计规模**: medium

## 目标

把已经上线的 `relationship:multi-dim` 系统接入现有 Observer 链路，让聊天页抽屉和历史回放都能看到关系系统在当前 turn 里的输入/输出，而不是只在行为上生效、在观测上不可见。

这张卡属于 Phase 2 / 模块 B 的 observer 补全，不是重新实现关系系统本身。C3 已经完成关系状态读取、prompt fragment 注入、afterLLM 分析和 afterTurn 持久化；本 task 只补 `observer` 数据流、前端类型和展示层。

## 涉及文件

**修改**
- `packages/core/src/agent/runner.ts`
- `packages/core/src/agent/runner.test.ts`
- `apps/web/src/app/chat/observer-types.ts`
- `apps/web/src/app/chat/ChatArea.tsx`
- `apps/web/src/app/chat/ObserverDrawer.tsx`
- `apps/web/src/app/chat/ObserverDrawer.test.tsx`

**可选修改**
- `apps/web/src/app/chat/observer-ui.tsx`
- `apps/web/src/app/chat/observer-utils.ts`

## 完成标准

### 数据层（可自动验证）
- [x] `runPendingRelationshipAnalysis()` 接入 observer start/end，和 `emotion` 一样把关系分析 call 落进 `llm_calls`
- [x] relationship observer call 使用独立 `kind: 'relationship'`
- [x] relationship observer metadata 至少包含 `before`、`after`、`delta`、`trigger`
- [x] 主对话 call 的 prompt fragments metadata 能继续保留 `relationship` fragment，不被前端忽略
- [x] `packages/core` 相关测试补齐并通过

### UI 层（必须人工验证）
- [x] 聊天页抽屉新增 relationship 可见入口；当前 turn 触发关系分析时，能看到关系 call 的模型输入/输出与 delta
- [x] 主对话 tab 中如果本轮注入了 relationship fragment，锚点区和正文都能看到该 fragment
- [x] 当 agent 配置 `relationship.scheme = noop` 或本轮没触发关系分析时，tab 仍保持一致的空状态，不报错、不闪退
- [ ] 至少手动浏览器验证 2 个场景：
- [ ] 场景 1：连续两轮让关系明显升高或降低，Observer 中可见 `delta` 与 `trigger`
- [ ] 场景 2：切到无 relationship 或 `noop` agent，Observer 保持稳定且不显示脏数据
- [ ] `typecheck + 测试通过不等于任务完成，UI 必须人工浏览器验证`

## 非目标（明确不做）

- ❌ 不做 `/agent/[id]/relationships` 管理入口或图谱 UI
- ❌ 不扩到 `agent ↔ agent` 关系；那是 F1
- ❌ 不改 `relationships` 表结构
- ❌ 不重做独立 `/observer` 页面布局；只补现有数据类型和可视化能力
- ❌ 不顺手调整 relationship prompt 文案或 delta 算法，除非为 observer metadata 落地所必需

## 备注 / 注意事项

- `C3` 当时明确把“observer kind”排除在外，这张卡就是补那一段，不要回头修改 C3 的范围定义
- hot files 明显集中在：
- `packages/core/src/agent/runner.ts`
- `apps/web/src/app/chat/observer-types.ts`
- `apps/web/src/app/chat/ChatArea.tsx`
- `apps/web/src/app/chat/ObserverDrawer.tsx`
- 和其他 observer / runner task 不适合并行
- 现状已知缺口：
- `RunAgentObserver` 目前只接受 `turn | compaction | memory | emotion`
- `runPendingRelationshipAnalysis()` 当前没有 observer hook
- `ObserverTab` 当前只有 `main | memory | emotion`
- `ObserverDrawer` 主对话 fragment 锚点当前也没渲染 `relationship`
- 设计参考：
- `project-docs/STATUS.md` 里已经声明 relationship 已接入，但 Observer 只写了 memory / emotion；这张卡完成后需要 review 时确认描述是否要补齐
- 参考现有 `emotion` 观测链路，优先保持 metadata 结构和 UI 交互模式一致

## Completion Note

- **Changes**: 给 `relationship:multi-dim` 补上了独立 observer kind 和 metadata 持久化，聊天抽屉与 `/observer` 回放类型现在都能识别 `relationship` call。主对话 tab 也会展示 `relationship` prompt fragment，并新增 `RelationshipCallCardMultiDim` 渲染 before/after/delta/trigger。
- **Verified**: `npm test --workspace @mas/core`；`node --import tsx --test apps/web/src/app/chat/ObserverDrawer.test.tsx`；`npm run typecheck --workspace @mas/core --workspace @mas/db --workspace @mas/observer --workspace @mas/systems --workspace @mas/web`。
- **Caveats**: 当前环境无法完成真实浏览器手验，任务卡里两条手动场景仍未勾选。`npm run build --workspace @mas/web` 在既有 `next/font` 远程拉取 Google Fonts 时超时失败，和本 task 改动无直接关系。
- **Design deltas**: 为了让历史回放也能稳定识别关系分析，这次一并放宽了 `@mas/db`、`@mas/observer` 以及 `/observer` 页面的 kind 联合类型，仍未改动独立 `/observer` 的布局结构。

## Coordinator Review (2026-04-20)

- **Code review**: 通过。task 分支已补齐与当前 `master` 的基线同步，避免把后续 memory/tools 改动回退到旧状态。
- **Re-verified**: `npm test --workspace @mas/core --workspace @mas/db --workspace @mas/systems`；`node --import tsx --test apps/web/src/app/chat/ObserverDrawer.test.tsx apps/web/src/lib/call-renderers.test.tsx`；`npm --ignore-scripts run typecheck --workspace @mas/core --workspace @mas/db --workspace @mas/observer --workspace @mas/systems --workspace @mas/web`。
- **Blocking**: 任务卡要求的两条浏览器手动验证仍未完成，因此暂不归档，不更新 `STATUS.md`。
