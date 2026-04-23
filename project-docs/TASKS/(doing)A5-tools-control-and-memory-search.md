# A5 — Tools 控制页与长期记忆搜索接线修复

**状态**: pending
**前置依赖**: A4 / B6 / D1 / D4（已完成）
**预计规模**: medium-large

## 目标

给每个 persona 增加一个固定不变的工具管理入口：`/agent/[id]/tools`。这张卡要把“当前有哪些工具可用、工具描述给模型看什么、默认开关是什么”从聊天链路里的硬编码抽出来，变成 persona 级可管理配置。

本卡只处理用户当前明确指出的两类问题：

- 工具描述仍有英文硬编码，且无法在产品层自定义修改
- `web_fetch` 不应再作为默认聊天工具暴露；长期记忆搜索工具虽然仓库里已有实现，但真实聊天里没有稳定形成“调用工具 → 读取结果 → 继续完成回复”的使用体验

这张卡对应 `DESIGN.md §10.1` 里的 `Tool Set: 勾选制`，也是现有 Memory 管理入口之后，行为层工具配置第一次真正落地。

## 涉及文件

**新建**
- `apps/web/src/app/agent/[id]/tools/page.tsx`
- `apps/web/src/app/agent/[id]/tools/ToolsManagerShell.tsx`
- `apps/web/src/app/agent/[id]/tools/ToolsManager.tsx`
- `apps/web/src/app/api/agents/[id]/tools/route.ts`
- `apps/web/src/app/api/agents/[id]/tools/route.test.ts`
- `packages/core/src/tools/runtime.ts`（或同等职责的新 helper，用于按 agent 解析有效工具集）

**修改**
- `apps/web/src/app/page.tsx`
- `packages/db/src/repository/agents.ts`
- `apps/web/src/app/api/agents/[id]/agent-handler.ts`
- `packages/core/src/tools/types.ts`
- `packages/core/src/tools/registry.ts`
- `packages/core/src/tools/search-long-term-memory.ts`
- `packages/core/src/tools/web-fetch.ts`
- `packages/core/src/tools/registry.test.ts`
- `packages/turing/src/chat-executor.ts`
- `packages/turing/src/chat-executor.test.ts`

## 完成标准

### 配置与运行时（可自动验证）
- [ ] agent 顶层配置新增 persona 级 `tools` 配置，落在 `agents.config`，不塞进 `modules`
- [ ] `search_long_term_memory` 与 `web_fetch` 都有默认中文描述、可选 override 描述和 effective 描述
- [ ] `search_long_term_memory` 默认启用，但仅在 `memory.scheme = sqlite` 时进入 effective tool set
- [ ] `web_fetch` 默认关闭，不再作为默认聊天工具暴露
- [ ] `web_fetch` 实现文件保留，但可在 Tools 页面为单个 persona 手动重新开启
- [ ] 聊天主链路与图灵测试链路都改为按当前 effective tool set 生成中文工具提示，不再硬编码英文 `web_fetch` 文案
- [ ] `search_long_term_memory` 的 effective 描述保留关键约束：只在当前上下文、短期记忆和固化记忆不足时使用；每轮最多一次；无结果时不重复搜索；拿到工具结果后继续完成本轮回复
- [ ] 更新现有过期测试，不能再假设默认工具永远只有 `web_fetch`

### UI 层（必须浏览器验证）
- [ ] 首页 persona 卡片新增 `Tools` 入口
- [ ] `/agent/[id]/tools` 上线，作为该 persona 的固定工具管理入口
- [ ] 页面至少展示 `search_long_term_memory` 与 `web_fetch` 两个工具
- [ ] 页面可查看每个工具的启用状态、默认描述、生效描述、override 编辑区和不可生效原因
- [ ] 当 `memory.scheme != sqlite` 时，`search_long_term_memory` 在页面上明确显示为当前不可生效
- [ ] 手动浏览器验证至少 3 个场景：
- [ ] `memory:sqlite` persona 默认看到长期记忆搜索为启用、`web_fetch` 为关闭
- [ ] 修改长期记忆工具描述后刷新页面，配置仍保留
- [ ] 针对依赖旧记忆的问题发起聊天，能观察到 `search_long_term_memory` 被调用，并且同一轮产出最终助手回复
- [ ] typecheck + 测试通过不等于任务完成，必须浏览器人工验证

## 非目标（明确不做）

- ❌ 不重写 `runAgent` 的工具循环引擎
- ❌ 不修改 memory 检索算法、embedding、semantic analyzer 逻辑
- ❌ 不彻底删除 `web_fetch` 的实现文件；本卡只把它从默认暴露改成“默认关闭，可手动重开”
- ❌ 不把 `bash` / `file_read` / `file_write` 一起接进 Tools 页面
- ❌ 不做全局工具控制台；范围只到 persona 级 `/agent/[id]/tools`

## 备注 / 注意事项

- 当前仓库存在已确认错位：`packages/core/src/tools/generated.ts` 已包含 `search_long_term_memory`，但 `packages/core/src/tools/registry.test.ts` 还停留在“默认只有 `web_fetch`”的旧预期；实现时必须先厘清“默认注册”和“effective 暴露”的边界
- 工具配置建议放在 `agents.config.tools`，不要塞回 `modules`，避免把“内在系统配置”和“行为层工具配置”混在一起
- `apps/web/src/app/page.tsx`、`packages/turing/src/chat-executor.ts`、`packages/core/src/tools/registry.ts` 是 hot file；这张卡应保持改动聚焦，不顺手处理别的 bug
- 设计参考：`DESIGN.md §5 工具系统`、`§10.1 行为层 Tool Set`、`§11 / Phase 2`

## Questions

- 当前环境缺少 provider / embedding 认证，真实 `/api/chat` 流在 `memory:sqlite beforeTurn` 会报
  `Could not resolve authentication method...`，因此“浏览器里观察到 `search_long_term_memory`
  被调用并在同一轮产出最终回复”这一条只能用自动化测试覆盖，无法在本地完成最终手工验收。
