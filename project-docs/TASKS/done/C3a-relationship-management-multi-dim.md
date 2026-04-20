# C3a — Relationship 管理入口（multi-dim 子系统）

**状态**: pending
**前置依赖**: 无（基于已完成 C3）
**预计规模**: medium-large

## 目标

为 `relationship` 模块补统一管理入口：`/agent/[id]/relationships`。

这张卡只实现 `relationship:multi-dim` 的管理子系统，不做 `simple` 或未来其他 scheme。并且把
relationship 相关设置放到这个管理系统里维护，包括：

- baseline（trust / affinity / familiarity / respect）
- decayPerTurn
- analysisModel

页面同时要能看见当前关系状态和最近 history，避免关系系统“后台在跑但无处确认”的问题。

## 涉及文件

**新建**
- `apps/web/src/app/agent/[id]/relationships/page.tsx`
- `apps/web/src/app/agent/[id]/relationships/RelationshipManagerShell.tsx`
- `apps/web/src/app/agent/[id]/relationships/RelationshipManager.multi-dim.tsx`
- `apps/web/src/app/api/agents/[id]/relationships/route.ts`
- `apps/web/src/app/api/agents/[id]/relationships/multi-dim/route.ts`
- `apps/web/src/app/api/agents/[id]/relationships/multi-dim/route.test.ts`

**修改**
- `packages/db/src/repository/relationships.ts`（补 UI 需要的查询 helper）
- `packages/db/src/repository/agents.ts`（如需最小 helper）

## 完成标准

### 数据层（可自动验证）
- [ ] `GET /api/agents/:id/relationships` 返回当前 scheme / 支持状态 / 是否已配置
- [ ] `GET /api/agents/:id/relationships/multi-dim` 返回 baseline、decayPerTurn、analysisModel、当前 dimensions、最近 history
- [ ] `PATCH /api/agents/:id/relationships/multi-dim` 能只更新 `modules.relationship`
- [ ] API 测试覆盖读取、更新、`noop` / 未配置场景
- [ ] typecheck 通过
- [ ] 单测通过

### UI 层（若涉及前端）
- [ ] `/agent/[id]/relationships` 作为统一入口按 scheme 分发
- [ ] `multi-dim` 子系统可编辑 baseline / decay / analysis model
- [ ] 页面能查看当前关系状态和最近 history
- [ ] `noop` / 未配置时显示空状态和启用提示
- [ ] 至少 2 个具体浏览器验证场景
- [ ] typecheck + 测试通过不等于任务完成，UI 必须人工浏览器验证

## 非目标（明确不做）

- ❌ 不做 agent ↔ agent 关系
- ❌ 不做图谱可视化或复杂 network 视图
- ❌ 不做 `relationship:simple`
- ❌ 不在这张卡里改首页 `Edit persona`（留给 B3a）

## 备注 / 注意事项

- 入口固定为 `/agent/[id]/relationships`
- 当前 counterpart 仍然只看默认用户，不要借这张卡偷偷扩到 F1
- `analysisModel` 仍然存回 `modules.relationship.analysisModel`，只是配置入口迁到这里
- 尽量复用 C3 已有的 `relationships` repository 和 history 结构，不要新起第二套 schema
