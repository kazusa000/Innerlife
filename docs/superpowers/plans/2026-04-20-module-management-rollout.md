# 模块管理系统重构 Rollout — Implementation Plan

日期：2026-04-20
状态：执行中

关联设计：
- `docs/superpowers/specs/2026-04-20-module-management-rollout.md`

---

## 1. 总体顺序

按这个顺序串行推进：

1. `C1a` — personality 管理入口（big-five）
2. `C2a` — emotion 管理入口（dimensional）
3. `C3a` — relationship 管理入口（multi-dim）
4. `B3a` — persona editor 收口 + memory 设置迁移 + values 移除

前三张先把新入口建起来，最后一张再回收旧入口，避免半路把现有配置路径拆断。

---

## 2. 执行策略

### 2.1 实现方式

- 每张 task 使用独立 worktree / branch
- 在 task worktree 内 claim `(doing)` 状态后再动代码
- 每张卡都按 TDD 走：先写/补失败测试，再补实现

### 2.2 复用策略

优先复用现有 `memory` 管理页模式：

- `page.tsx`
- `ManagerShell`
- scheme 分发表
- 入口元信息 API

优先复用现有 `persona-modules.ts` 里的 clamp / 读取规则，但会逐步把“单模块 patch helper”从大表单逻辑里抽出来。

---

## 3. C1a 计划

### 目标

落地 `/agent/[id]/personality` 与 `personality:big-five` 子系统。

### 步骤

1. 新增 personality API 路由测试
   - `GET /api/agents/:id/personality`
   - `GET /api/agents/:id/personality/big-five`
   - `PATCH /api/agents/:id/personality/big-five`
2. 抽最小 personality helper
   - 读取 `modules.personality`
   - merge 写回 `modules.personality`
3. 实现 personality API
4. 搭入口页与 `PersonalityManagerShell`
5. 实现 `PersonalityManager.big-five`
6. 跑 web build/typecheck/测试
7. 浏览器手验：
   - 已启用 big-five 的 agent 可以编辑五维 / speechStyle / background
   - `noop` agent 显示空状态

### 预期改动面

- `apps/web/src/app/agent/[id]/personality/*`
- `apps/web/src/app/api/agents/[id]/personality/*`
- 可能少量触及 `packages/db/src/repository/agents.ts`

---

## 4. C2a 计划

### 目标

落地 `/agent/[id]/emotion` 与 `emotion:dimensional` 管理子系统，并把 emotion 设置从 editor 下沉出去。

### 步骤

1. 新增 emotion API 测试
2. 复用壳层，落 emotion 入口页
3. 实现 `dimensional` 管理 UI
4. 迁移 baseline / decay / analysisModel 的编辑逻辑
5. 跑测试、typecheck、build
6. 浏览器手验

### 风险

- 和 `page.tsx` 的旧表单逻辑存在重复期
- 先允许重复存在，最终由 `B3a` 回收旧入口

---

## 5. C3a 计划

### 目标

落地 `/agent/[id]/relationships` 与 `relationship:multi-dim` 管理子系统。

### 步骤

1. 新增 relationship API 测试
2. 实现入口元信息接口
3. 实现 multi-dim 详情/编辑接口
4. 在 UI 中显示：
   - baseline
   - decay
   - analysisModel
   - current state
   - recent history
5. 跑测试、typecheck、build
6. 浏览器手验

### 风险

- 关系状态和配置分属不同数据源：配置来自 `agents.modules`，状态/history 来自 `relationships`
- API 需要明确把两块分开返回，避免 UI 误解为同一来源

---

## 6. B3a 计划

### 目标

把旧大表单收成 scheme-only，并完成 values 移除。

### 步骤

1. 把 `page.tsx` 的模块编辑收成 scheme-only
2. 为 agent 卡片或编辑区挂出四个管理页入口
3. 把 memory 模型设置从旧 editor 挪走，只留在 memory 管理页
4. 从 `persona-modules.ts`、旧 UI 和 runtime 中移除 values
5. 更新 Observer 主 prompt fragment 显示，去掉 values
6. 跑全量相关测试、typecheck、build
7. 浏览器手验完整创建/编辑流程

### 风险

- 这是热文件聚合卡，必须放最后
- 做之前要重新看 `master` 上前三张卡的最终落点，避免回退

---

## 7. 每张卡的通用验证

最少要跑：

- 相关 route test
- `npm run typecheck --workspace @mas/web`
- `npm run build --workspace @mas/web`

如果改到共享 helper 或 repo 层，再补对应 package 的测试。

每张卡完成前还需要：

- task worktree `git status` clean
- task 文件改成 `(done)`
- Completion Note 写清验证和 caveat

