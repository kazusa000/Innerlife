# C1a — Personality 管理入口（big-five 子系统）

**状态**: pending
**前置依赖**: 无（基于已完成 C1）
**预计规模**: medium

## 目标

为 `personality` 模块补一个固定管理入口：`/agent/[id]/personality`。

这张卡只实现 `personality:big-five` 的管理子系统，不做跨 scheme 通用 UI。入口层负责读取
`agents.modules.personality.scheme` 并分发；第一版只支持：

- `scheme = "big-five"` → 进入 Big Five 管理子系统
- `scheme = "noop"` / 缺失 → 显示空状态
- 其他未来 scheme → 显示“未实现”的占位态

这张卡的核心目的是把 Big Five 相关配置从 `Edit persona` 的大表单里拆出去，形成一个独立的
管理页，后续如果 personality 有别的 scheme，也继续挂在同一个入口下面。

## 涉及文件

**新建**
- `apps/web/src/app/agent/[id]/personality/page.tsx`
- `apps/web/src/app/agent/[id]/personality/PersonalityManagerShell.tsx`
- `apps/web/src/app/agent/[id]/personality/PersonalityManager.big-five.tsx`
- `apps/web/src/app/api/agents/[id]/personality/route.ts`
- `apps/web/src/app/api/agents/[id]/personality/big-five/route.ts`
- `apps/web/src/app/api/agents/[id]/personality/big-five/route.test.ts`

**修改**
- `packages/db/src/repository/agents.ts`（如需最小 helper）
- `apps/web/src/app/page.tsx`（只在后续 B3a 再统一改；本卡不要碰）

## 完成标准

### 数据层（可自动验证）
- [ ] `GET /api/agents/:id/personality` 返回入口元信息：当前 scheme、是否已配置、已支持 scheme
- [ ] `GET /api/agents/:id/personality/big-five` 返回当前 `big5 / speechStyle / background`
- [ ] `PATCH /api/agents/:id/personality/big-five` 能只更新 `modules.personality`，不污染其他模块
- [ ] API 测试覆盖：读取已配置、写回更新、`noop` / 未配置空状态
- [ ] typecheck 通过
- [ ] 单测通过

### UI 层（若涉及前端）
- [ ] `/agent/[id]/personality` 作为统一入口按 scheme 分发
- [ ] `big-five` 子系统支持编辑五维分数、说话风格、背景故事并保存
- [ ] `noop` / 未配置时显示空状态和启用提示
- [ ] 至少 2 个具体浏览器验证场景
- [ ] typecheck + 测试通过不等于任务完成，UI 必须人工浏览器验证

## 非目标（明确不做）

- ❌ 不在这张卡里改 `Edit persona` 为 scheme-only（留给 B3a）
- ❌ 不做 personality 的第二种 scheme
- ❌ 不改主聊天 prompt 结构，只更新配置入口
- ❌ 不做跨模块聚合页

## 备注 / 注意事项

- 入口固定为 `/agent/[id]/personality`，不要把 `big-five` 直接写死在入口页
- 这张卡没有 LLM 模型设置；只管理 personality 自己的结构化配置
- 后续若 personality 出现新 scheme，也走 `/api/agents/:id/personality/<scheme>/*`
- 尽量不要碰 `apps/web/src/app/page.tsx`，避免和 B3a 抢热文件
