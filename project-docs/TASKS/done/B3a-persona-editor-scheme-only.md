# B3a — Persona Editor 收敛为 scheme 选择器

**状态**: pending
**前置依赖**: C1a + C2a + C3a
**预计规模**: medium-large

## 目标

把首页 `Edit persona` / `Create persona` 表单收敛成“模块 scheme 选择器”，不再承载各模块的详细设置。

执行完成后，首页编辑入口只负责：

- 选择 provider / model
- 选择各模块当前 scheme
  - `personality.scheme`
  - `emotion.scheme`
  - `relationship.scheme`
  - `memory.scheme`

模块自己的详细配置全部迁移到各自管理系统：

- `/agent/[id]/personality`
- `/agent/[id]/emotion`
- `/agent/[id]/relationships`
- `/agent/[id]/memory`

同时完成两件收口工作：

- 把 `memory` 的模型设置迁移到已有 `/agent/[id]/memory` 管理页
- 把 `values` 系统从 UI 和 runtime 中移除

这样做完后，首页编辑器只负责“选用哪个 scheme”；模块自己的参数、历史和内部模型设置全部去对应管理页里维护。

## 涉及文件

**修改**
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/persona-modules.ts`
- `apps/web/src/app/persona-modules.test.ts`
- `apps/web/src/app/agent/[id]/memory/MemoryManager.sqlite.tsx`
- `apps/web/src/app/api/agents/[id]/memory/sqlite/route.ts`
- `apps/web/src/app/api/agents/[id]/memory/sqlite/route.test.ts`
- `packages/systems/src/values/*`
- `packages/systems/src/registry.ts`
- `packages/systems/src/index.ts`
- `packages/core/src/agent/runner.ts`
- `packages/core/src/agent/runner.test.ts`
- `apps/web/src/app/chat/ObserverDrawer.tsx`

按需修改：
- 相关样式 / helper（如果必须）

## 完成标准

### 数据层（可自动验证）
- [ ] `buildModules` / 表单状态 helper 只负责 scheme 和基础 agent 信息，不再写 module 详细设置
- [ ] personality / emotion / relationship / memory 的详细设置字段不再从首页表单提交
- [ ] `memory:sqlite` 管理页能读取并更新当前 `modules.memory.summarizeModel`
- [ ] `values` 不再由 registry 实例化；残留 `modules.values` 配置会被忽略，不报错、不注入 prompt
- [ ] typecheck 通过
- [ ] 单测通过

### UI 层（若涉及前端）
- [ ] 首页编辑表单只保留各模块 scheme 选择器，不再编辑 Big Five 分数、emotion baseline、relationship baseline、memory model override
- [ ] values 完全从编辑表单中消失
- [ ] values 相关入口和主对话 fragment anchor 一并消失
- [ ] Agent 卡片或同级动作区提供进入四个管理系统的入口按钮/链接
- [ ] `/agent/[id]/memory` 的 sqlite 子系统里能编辑 Memory model override
- [ ] 至少 2 个具体浏览器验证场景
- [ ] typecheck + 测试通过不等于任务完成，UI 必须人工浏览器验证

## 非目标（明确不做）

- ❌ 不在这张卡里实现各管理系统内部逻辑（前置 task 已负责）
- ❌ 不新增新的模块类型
- ❌ 不修改主聊天行为
- ❌ 不做 `chromadb`、`relationship:simple`、`emotion` 其他 scheme 的管理页

## 备注 / 注意事项

- 这是一个明确的 UI + cleanup 聚合卡，故意放到最后做，用来消化 `apps/web/src/app/page.tsx` 这个热文件
- 必须等 `C1a / C2a / C3a` 完成后再做，否则用户会出现“旧设置入口被删了，但新入口还没做好”的空窗
- 编辑器里“只选 scheme”的含义是：**模块是否启用、启用哪种方案** 在这里定；具体参数在模块管理页里定
- `memory` 的模型设置迁移只是承接到现有 D4 页面，不是再新拆一张 memory task
- 删除 `values` 时不要做数据库批量迁移；策略是忽略旧配置并清掉运行时/UI 暴露
