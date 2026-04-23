# C1b — 人设系统（整合双 Prompt，替换 Big Five 性格系统）

**状态**: done
**前置依赖**: B3a / C1 / C1a（已完成）
**预计规模**: medium-large

## 目标

把当前的 `personality` 模块从“Big Five 性格系统”改成“人设系统”。

新的方向是：

- 保留现有固定入口 `/agent/[id]/personality`
- 保留现有数据 key `modules.personality`
- 但不再把它当作结构化性格系统，也不再通过 `AgentSystem` 注入性格 fragment

改造后，`modules.personality` 只负责承载两段真正的人设文本：

- `systemPrompt`
- `personaPrompt`

现有顶层 `agents.config.systemPrompt / personaPrompt` 要迁入 `modules.personality`，之后主流程只认新位置。Big Five 五维、说话风格、背景故事、legacy `personality.prompt`、以及 `personality:big-five` 运行时系统和对应管理 API / UI 全部移除。

这张卡的目标不是“删除人设能力”，而是把原本分散在首页顶层配置和 personality 模块里的 prompt 管理收口为**一个真正的人设系统入口**。

## 涉及文件

**删除**
- `packages/systems/src/personality/big-five.ts`
- `packages/systems/src/personality/index.ts`
- `apps/web/src/app/agent/[id]/personality/PersonalityManager.big-five.tsx`
- `apps/web/src/app/api/agents/[id]/personality/big-five/route.ts`
- `apps/web/src/app/api/agents/[id]/personality/big-five/handler.ts`

**修改**
- `packages/systems/src/registry.ts`
- `packages/turing/src/chat-executor.ts`
- `packages/db/src/repository/agents.ts`
- `apps/web/src/app/persona-modules.ts`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/agent/[id]/personality/page.tsx`
- `apps/web/src/app/agent/[id]/personality/PersonalityManagerShell.tsx`
- `apps/web/src/app/api/agents/[id]/personality/route.ts`
- `apps/web/src/app/api/agents/[id]/agent-handler.ts`
- 相关 personality / agent / turing / systems / observer 测试文件

## 完成标准

### 运行时与数据层（可自动验证）
- [x] `personality:big-five` 从 runtime registry 移除，不再作为 `AgentSystem` 参与 promptFragments
- [x] `modules.personality` 改为仅承载 `systemPrompt` 与 `personaPrompt`
- [x] 读取 agent 时，旧的 `agents.config.systemPrompt / personaPrompt` 会被迁入或归并到 `modules.personality`
- [x] 迁移完成后，主聊天链路与 turing 链路都只从 `modules.personality` 读取这两段 prompt
- [x] `readLegacyPersonaPrompt`、Big Five 配置解析、`personality.prompt` fallback 等旧兼容逻辑全部移除
- [x] personality 相关 API 只保留“人设管理入口”所需的读取/更新接口，不再保留 `big-five` 子路由
- [x] typecheck 通过
- [x] 相关单测通过

### UI 层（必须浏览器验证）
- [x] `/agent/[id]/personality` 保留，但页面文案、接口语义和编辑表单改为“人设管理”
- [x] 该页面只编辑 `systemPrompt` 与 `personaPrompt` 两段文本
- [x] 首页 persona 编辑区不再直接编辑这两段 prompt，也不再暴露 personality scheme 选择
- [x] 首页 persona 卡片和模块文案不再出现 Big Five / 性格方案 / 性格管理等旧语义，统一改成人设语义
- [x] 至少人工验证 3 个场景：
- [x] 一个已有旧数据的 agent 打开人设页后，能看到旧 `systemPrompt / personaPrompt` 被正确带入
- [x] 保存人设后进入聊天，最终 system prompt 里包含两段新的人设文本且不再出现 Big Five fragment
- [x] 首页编辑 agent 时，不再看到 personality scheme 配置，也不会误删 emotion / relationship / memory 配置
- [x] typecheck + 测试通过不等于任务完成，必须浏览器人工验证

## 非目标（明确不做）

- ❌ 不改 `emotion` / `relationship` / `memory` 模块的行为和入口
- ❌ 不把 `/agent/[id]/personality` 路由整体重命名为 `/persona`
- ❌ 不保留 Big Five、speechStyle、background 的兼容展示
- ❌ 不新增第三段“统一 persona 文本”；只保留 `systemPrompt` 和 `personaPrompt` 两段
- ❌ 不在这张卡里顺手处理其它 prompt 工程或工具系统问题

## 备注 / 注意事项

- 这是产品方向替换，不是简单删页面；实现时要同时清理 runtime、DB 映射、API、首页入口、Turing prompt 组装和相关测试
- `apps/web/src/app/page.tsx`、`packages/db/src/repository/agents.ts`、`packages/turing/src/chat-executor.ts`、`packages/systems/src/registry.ts` 都是 hot file；不要顺手扩 scope
- `modules.personality` 继续沿用旧 key，只是语义改成人设配置块，避免本卡再引入整套路由/API 改名
- 设计参考：`DESIGN.md §10.1` 的 persona 管理方向、`§11 Phase 2 / C1`；实现完成后需要由 Coordinator 再回写 DESIGN / STATUS

## Completion Note

- **Changes**: 仓库层现在会把旧 `config.systemPrompt / personaPrompt` 归并进 `modules.personality`，主聊天链路与 Turing 链路都只读取这里；Big Five runtime、API 和管理页已删除，人设页改成双文本编辑器，首页不再暴露 personality scheme 或顶层 prompt 编辑。
- **Verified**: `node --import tsx --test packages/db/src/repository/agents.test.ts`、`packages/systems/src/registry.test.ts packages/core/src/agent/runner.test.ts`、`packages/turing/src/chat-executor.test.ts`、`apps/web/src/app/api/agents/personality-api.test.ts apps/web/src/app/persona-modules.test.ts apps/web/src/app/api/agents/agent-route.test.ts` 通过；`npm test --workspace @mas/db`、`@mas/systems`、`@mas/turing` 通过；`npm run typecheck --workspace @mas/db`、`@mas/systems`、`@mas/turing`、`@mas/web` 通过；`npm run build --workspace @mas/web` 通过；用 Playwright 人工验证了旧数据回填、人设保存后 prompt 组装、首页编辑不暴露 personality 配置且保留 emotion / relationship / memory。
- **Caveats**: `npm test --workspace @mas/core` 仍有与本卡无关的既有失败，`packages/core/src/tools/registry.test.ts` 断言默认工具列表只包含 `web_fetch`，但当前清单还包含 `search_long_term_memory`；浏览器聊天验证时本地未配置真实模型鉴权，实际 LLM 调用报认证错误，但 `llm_calls.system_prompt` 已成功落库并确认包含新人设文本且不含 Big Five fragment。
- **Design deltas**: 无。
