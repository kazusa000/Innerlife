# B9 — Observer 抽屉 Tab 化（主对话 + 模块分区）

**状态**: done
**前置依赖**: B7（Observer 抽屉维度化，已归档）+ C1/C2/C4 + D1/D1a/D1b/D1c
**预计规模**: medium-large

## 目标

B7 落地后抽屉仍有两个痛点：

1. **展开后 content 溢出看不到尾部**（长 fragment 文本 / 长 messages 直接截断，没有内部滚动）
2. **只能看主对话 call**，想观察记忆 / 情绪模块的内部 call（retrieve / summarize / delta 等）只能去别的地方看；但用户希望实时在抽屉里看这些模块"本轮"做了什么

B9 的方案：**抽屉顶部 Tab 化** + **主对话展开加吸顶锚点导航** + **模块 Tab 按 scheme 自动渲染**。数据只看当前（或最近一次完成的）turn，历史仍靠独立 `/observer` 页面。

## 涉及文件

**UI 层**（本 task 主战场）
- `apps/web/src/app/chat/ObserverDrawer.tsx`（重写布局，可拆子组件如 `ObserverTabs.tsx` / `TurnMainCallCard.tsx` / `MemoryCallCard.sqlite.tsx` / `EmotionCallCard.dimensional.tsx` / `AnchorNav.tsx`）
- `apps/web/src/app/chat/ChatArea.tsx`（如需把当前 agent 的 `modules` 配置透给抽屉，供 scheme 判定）
- `apps/web/src/app/chat/observer-types.ts`（按需扩展 LiveCall / Turn 结构类型）

**数据层**（若已具备则不动）
- 已有：`llm_calls.metadata_json.fragments / hits / written / report / before / after / delta / trigger / keywords` 等（B7 保留不动的字段全部在）
- 若 SSE 当前没有提供 agent.modules 给前端，需让 chat SSE 在 session 开头的 `turn_start` 或 session meta 事件里带上当前 agent 的 modules 配置（只要能在前端知道"memory scheme = sqlite"即可，字段最小化）

## 完成标准

### 数据 / 状态层

- [x] 抽屉订阅 SSE 后**按 turn 聚合 calls**：维护 "当前 turn" 的 calls 列表；收到新的 `turn_start`（或同义事件）时切换到下一个 turn，**不保留历史 turn**（历史回放走独立 `/observer` 页）
- [x] 初始进入聊天页 / 切换 session 时，如果上一次 turn 还未刷新，展示最近一次完成的 turn；无数据时显示空状态文案
- [x] 抽屉能从前端上下文拿到当前 agent 的 modules 配置（memory.scheme / emotion.scheme），用于给模块 tab 选组件

### Tab 层（顶部）

- [x] 顶部 sticky tab bar，3 个 tab：**主对话 / 记忆 / 情绪**
- [x] 某 tab 在当前 turn 没有对应 kind 的 call 时，**tab 仍显示但内容区空状态提示**（"本轮未触发记忆调用"）；不要隐藏 tab
- [x] tab 切换不影响当前 turn 数据（只是切显示视图）；选中的 tab 跨 turn 保持（用户上次选了"记忆"，下一轮还在"记忆"）

### 主对话 Tab

- [x] 列出当前 turn 所有 `kind === 'turn'` 的 call（有工具循环时可能多个）；每张 call 可展开 / 收起
- [x] 展开后内容布局：
  - **吸顶横向锚点条**（sticky 在展开区顶部），锚点项 = {性格, 价值观, 情绪, 记忆, Messages, Tools, Final prompt}，**只渲染当前 call 实际存在的那几个**（某 fragment.source 不存在则对应锚点也不渲染）
  - 点击锚点 → 滚动到对应段落（section id / ref）
  - **内容区必须 `overflow-y: auto` + 有 max-height**，长 fragment 内部可滚动，不能溢出看不到
- [x] 性格 / 价值观 / 情绪 / 记忆 四段：沿用 B7 简化版"只展示 `fragment.content`"
- [x] Messages 段：user / assistant / tool_use / tool_result / 本 call 的 response 时间线展开；compaction 事件内联（若本轮触发）
- [x] Tools 段：tools schema JSON，可折叠（默认折叠）
- [x] Final prompt 段：完整拼好的 system prompt，可折叠（默认折叠）
- [x] 当前 turn 有多个主对话 call 时各自独立一张卡，可独立展开收起

### 记忆 Tab

- [x] 列出当前 turn 所有 `kind === 'memory'` 的 call，按发生时间顺序（retrieve 通常在前、summarize 在后）
- [x] 每条 call 的渲染组件**按当前 agent 的 memory.scheme 自动选择**（本 task 只实现 `sqlite` scheme 组件；将来加 `chromadb` 时新增 `MemoryCallCard.chromadb.tsx` 并在 scheme 分发 switch 里加一行即可）
- [x] sqlite scheme 的 `retrieve` call 卡展示：keywords / fallbackKeywords / 命中记忆列表（summary / tags / importance / matchedTerms）
- [x] sqlite scheme 的 `summarize` call 卡展示：written 记录（id / summary / tags / importance）
- [x] sqlite scheme 的 `consolidate` call 卡展示：report（before / after / kept / rewritten / merged）
- [x] 每个 call 可展开查看原 prompt / response（折叠区，和主对话 tab 的 Final prompt 风格一致）
- [x] 内容区同样 `overflow-y: auto` + max-height，不溢出
- [x] 当前 turn 无 memory call 时显示空状态提示

### 情绪 Tab

- [x] 列出当前 turn 所有 `kind === 'emotion'` 的 call
- [x] 渲染组件**按当前 agent 的 emotion.scheme 自动选择**（本 task 只实现 `dimensional` scheme）
- [x] dimensional scheme 的 `delta` call 卡展示：before {mood,energy,stress} / after {mood,energy,stress} / delta {mood,energy,stress} / trigger 文本
- [x] 每个 call 可展开看原 prompt / response（折叠）
- [x] 内容区可滚，不溢出
- [x] 无情绪 call 时空状态提示

### 非目标（明确不做）

- ❌ 不做 chromadb memory / plutchik-wheel emotion 等 scheme 的组件（但接口要预留）
- ❌ 不做 compaction tab（如果将来需要再 B10）
- ❌ 不做历史 turn 回放（走 `/observer` 独立页）
- ❌ 不动 `/observer` 独立页面
- ❌ 不改 llm_calls 数据表结构（沿用 metadata_json，不新增列）

## 备注 / 注意事项

**Tab 切换要在抽屉里做，不是路由**——这是聊天页侧边抽屉，不是独立路由页。

**Scheme 分发模式（重要）**：
```ts
// 示意：按 scheme 分发到对应组件
const MemoryCallCardByScheme: Record<string, ComponentType<{ call: LiveCall }>> = {
  sqlite: MemoryCallCardSqlite,
  // chromadb: MemoryCallCardChromadb,  // 将来加
}
const Card = MemoryCallCardByScheme[agentModules?.memory?.scheme ?? ''] ?? UnknownSchemeCard
```
抽屉只负责按 scheme key 查字典并渲染。不要在抽屉里 hardcode "sqlite" 分支逻辑；所有 sqlite-specific 展示封装到 `MemoryCallCardSqlite` 组件里。

**内容溢出是 P0 必修**：任何展开内容都必须在可滚容器内，`overflow-y: auto`，长 fragment / 长 messages 都不能把后面内容挤出屏幕。这是 B7 v2 遗留问题，用户明确指出。

**吸顶锚点条实现**：
- 用 sticky + scroll-margin-top 做锚点跳转
- 锚点条本身也 sticky 在 call 卡展开区的顶部
- 切 call 时锚点条重建
- 动画可以没有，但跳转要平滑（`scroll-behavior: smooth`）

**Turn 边界判定**：
- SSE 事件里应该已经有 `turn_start` / `turn_end` 等事件（没有的话在 `runner.ts` 里加一个；但尽量先查现有事件结构）
- 前端在 `turn_start` 时清空当前 turn 的 calls 列表，开始收集；`turn_end` 后保持展示直到下一个 `turn_start`
- 切换 session 时也清空

**样式沿用**：Modern Dark Cinema（`globals.css` 现有 token）；accent 色和 B7 一致（性格 indigo / 价值观 amber / 情绪 pink / 记忆 emerald）

**合并冲突风险**：本 task 碰 `ObserverDrawer.tsx` + 可能 `ChatArea.tsx` + 可能 `runner.ts`（若 SSE 事件要加 `turn_start`/`turn_end`），不要和其他 task 并行派

**验证**：
- 至少测两个 agent 场景：
  1. 启用 memory.sqlite + emotion.dimensional 的 agent，发一句含关键词的话，抽屉三个 tab 都应该有内容（主对话的四张锚点段 + 记忆的 retrieve/summarize 卡 + 情绪的 delta 卡）
  2. 只启用 personality + values 的 agent，记忆 tab 和情绪 tab 显示空状态；主对话 tab 锚点只出现 "性格 / 价值观 / Messages / Tools / Final prompt"
- 检查长 fragment（比如贴一大段背景故事）能在内容区内滚动，不溢出抽屉
- 多轮对话：第二轮开始时抽屉内容替换为新 turn，旧 turn 不残留
- typecheck 通过；Observer 单测按新结构调整通过

## Completion Note

- **Changes**: 聊天页 Observer 抽屉改成三 tab（主对话 / 记忆 / 情绪），按当前 turn 聚合并保留最近一次完成 turn；主对话 tab 支持按 call 切换、锚点跳转、fragment/messages/tools/final prompt 分段展示；memory/sqlite 和 emotion/dimensional 各自落到独立 call 卡组件，支持按 scheme 分发和空状态占位。收尾时又补了一轮 UI 细化：把主对话、多 memory call、多 emotion call 改成 subtabs 切换，去掉旧的多卡同时展开状态，并把 memory/emotion 细节卡改成可折叠结构，避免长内容继续把抽屉撑爆。
- **Verified**: `npm run typecheck`（`apps/web`）；`node --import tsx --test src/app/chat/ObserverDrawer.test.tsx`（`apps/web`）。按用户说明，审核与手动验证已在合并前完成。
- **Caveats**: `ChatArea` 仍只保留当前 turn 和最近一次完成 turn 的前端态，不承担历史 turn 回放；历史分析继续走独立 `/observer` 页面。
