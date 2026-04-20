# C2a — Emotion 管理入口（dimensional 子系统）

**状态**: pending
**前置依赖**: 无（基于已完成 C2）
**预计规模**: medium

## 目标

为 `emotion` 模块补一个固定管理入口：`/agent/[id]/emotion`。

这张卡只实现 `emotion:dimensional` 的管理子系统，不做跨 scheme 通用 UI。并且把当前放在
`Edit persona` 里的 emotion 相关配置迁移到这个管理页里，包括：

- baseline（mood / energy / stress）
- decayPerTurn
- analysisModel

也就是说，情绪模块的 LLM 模型设置不再留在 `Edit persona`，而是在这个管理系统里维护。

## 涉及文件

**新建**
- `apps/web/src/app/agent/[id]/emotion/page.tsx`
- `apps/web/src/app/agent/[id]/emotion/EmotionManagerShell.tsx`
- `apps/web/src/app/agent/[id]/emotion/EmotionManager.dimensional.tsx`
- `apps/web/src/app/api/agents/[id]/emotion/route.ts`
- `apps/web/src/app/api/agents/[id]/emotion/dimensional/route.ts`
- `apps/web/src/app/api/agents/[id]/emotion/dimensional/route.test.ts`

**修改**
- `packages/db/src/repository/agents.ts`（如需最小 helper）
- `packages/db/src/repository/emotion-states.ts`（如 UI 需要专用查询 helper）

## 完成标准

### 数据层（可自动验证）
- [ ] `GET /api/agents/:id/emotion` 返回当前 scheme / 支持状态 / 是否已配置
- [ ] `GET /api/agents/:id/emotion/dimensional` 返回当前 baseline、decayPerTurn、analysisModel，以及最近若干条 emotion history
- [ ] `PATCH /api/agents/:id/emotion/dimensional` 能只更新 `modules.emotion`
- [ ] API 测试覆盖读取、更新、`noop` / 未配置场景
- [ ] typecheck 通过
- [ ] 单测通过

### UI 层（若涉及前端）
- [ ] `/agent/[id]/emotion` 作为统一入口按 scheme 分发
- [ ] `dimensional` 子系统可编辑 baseline / decay / analysis model
- [ ] 页面能查看当前情绪状态和最近 history
- [ ] `noop` / 未配置时显示空状态和启用提示
- [ ] 至少 2 个具体浏览器验证场景
- [ ] typecheck + 测试通过不等于任务完成，UI 必须人工浏览器验证

## 非目标（明确不做）

- ❌ 不在这张卡里改 `Edit persona` 为 scheme-only（留给 B3a）
- ❌ 不做 emotion 的第二种 scheme
- ❌ 不改情绪系统算法本身
- ❌ 不改 Observer 展示结构，除非只是已有字段对齐

## 备注 / 注意事项

- 路由固定为 `/agent/[id]/emotion`
- API 可以共用 `/api/agents/:id/emotion/*` 前缀，但 `dimensional` 自己维护自己的字段形状
- `analysisModel` 仍然存回 `modules.emotion.analysisModel`，只是配置入口迁到这里
- 不要把情绪设置继续留在首页大表单里；那是 B3a 会收掉的旧入口
