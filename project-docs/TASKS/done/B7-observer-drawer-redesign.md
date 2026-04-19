# B7 — Observer 抽屉重构（维度化展示）

**状态**: in-review（第一版已完成，需返修；见文末"## 返修要求"章节）
**前置依赖**: B2（Observer 基座）+ C1/C2/C4 + D1/D1a/D1b/D1c（所有已合并系统）
**预计规模**: medium

## 目标

把聊天页侧边 Observer 抽屉从"左右挤的 Input / Output 双栏"改成"按 llm_call 扁平列出，每个 call 可自由展开观察其完整上下文 + 维度信息"。核心诉求：

- 用户要能明确看到本次 LLM 调用里**哪段 system prompt 来自哪个系统**（性格 / 价值观 / 情绪 / 记忆）
- 用户要能看到记忆检索**实际命中了哪几条记忆**（不仅是条数）
- 布局不能再左右挤，纵向展开，每个 call 独立成块

本 task **只动聊天页抽屉** `ObserverDrawer.tsx`，独立 `/observer` 页不动（数据层改动两边共享，但 `/observer` 页 UI 暂不重做）。

## 涉及文件

**数据层**（必须先改，UI 才能拿到数据）
- `packages/systems/src/types.ts`（`PromptFragment.source` 已有 string 类型；确认各系统 emit 时都填了 `source`，如 `personality` / `values` / `emotion` / `memory`）
- `packages/core/src/agent/runner.ts`（`onLLMCallStart` 的 snapshot 里除了拼好的 `systemPrompt`，额外存 `fragments: Array<{source, priority, content}>` 到 metadata；当前 runner 拼接后丢失了 source 信息）
- `packages/db/src/schema.ts`（`llmCalls.metadataJson` 已存在，沿用；**不加新列**，所有新增字段塞进 metadata JSON）
- `packages/systems/src/memory/sqlite.ts`（`retrieve` phase 的 observer event metadata 要补 `hits: Array<{id, summary, tags, importance, matchedTerms?}>`；`summarize` phase 补 `written: {id, summary, tags, importance}`；`consolidate` phase 补 `report: {before, after, kept, rewritten, merged}`）
- `packages/systems/src/emotion/dimensional.ts`（`delta` 事件 metadata 补 `before: {mood,energy,stress}` / `after: {...}` / `delta: {...}` / `trigger: string`）
- `packages/systems/src/compaction/summary.ts`（compaction 事件 metadata 确认已有 `before`/`after` 消息计数 + summary 内容，若没有补上）
- `apps/web/src/app/api/observer/calls/[callId]/route.ts`（确认把 metadata JSON 完整返回给前端，不要截断）

**UI 层**（只动这一处）
- `apps/web/src/app/chat/ObserverDrawer.tsx`（完全重写布局；可拆子组件到同目录 `ObserverCallCard.tsx` / `DimensionCard.tsx` / `MessagesTimeline.tsx`）

## 完成标准

### 数据层

- [ ] `llm_calls.metadata_json` 里带 `fragments: Array<{source, priority, content}>`，主对话 call 能解析出 personality / values / emotion / memory 四类 source 的段落（至少有一个系统启用时可见）
- [ ] `memory.retrieve` 事件的 metadata 里 `hits` 包含命中记忆的 `id / summary / tags / importance`（不仅是 count）
- [ ] `memory.summarize` 事件 metadata 里 `written` 包含本轮写入的 `id / summary / tags / importance`
- [ ] `memory.consolidate` 事件 metadata 里 `report` 包含 `{before, after, kept, rewritten, merged}`
- [ ] `emotion` 事件 metadata 里包含 `before / after / delta / trigger`
- [ ] 既有单测补 / 改以覆盖新 metadata（至少 memory + emotion 各补一条断言）

### UI 层（ObserverDrawer）

- [ ] 抽屉内容从"左右两栏 Input / Output"改为**纵向 llm_call 列表**，每个 call 一张卡片
- [ ] 每张 call 卡片顶部显示 **call 类型标签**（"主对话" / "memory.retrieve" / "memory.summarize" / "memory.consolidate" / "emotion.delta" / "compaction.summary"），由 `kind + metadata.phase` 推导
- [ ] call 卡片展开后，按顺序显示：
  1. **维度卡区**（4 张，按需显示）：性格 / 价值观 / 情绪 / 记忆。只在**本 call 的 fragments 里有该 source**，或**本 call 的 metadata 属于该维度**时显示
     - 性格 / 价值观卡：展示 fragment 的 content
     - 情绪卡：若是 emotion.delta call，展示 before / after / delta / trigger；若是主对话且有 emotion fragment，展示当前注入的情绪段落
     - 记忆卡：若是 memory.retrieve call，展示扩展出的 keywords + 命中记忆列表（summary / tags / importance）；若是 memory.summarize call 展示 written；若是主对话且有 memory fragment 展示注入的 "Relevant memories" 段落
  2. **Final system prompt**（折叠，默认关）——拼接好的完整 systemPrompt 原文
  3. **Tools schema**（折叠，默认关）
  4. **Messages 时间线**（默认展开）——user / assistant / tool_use / tool_result / 本 call 的 response 按顺序平铺，**compaction 事件作为一张内联卡嵌在对应位置**，显示 "本轮压缩：X 条 → 1 条摘要"
- [ ] 左右不再挤：同一横向只有 1 栏（全宽），messages 块内 code / JSON 可滚动但不再和 response 抢宽度
- [ ] 抽屉实时刷新（保留现有 SSE 逻辑），新 llm_call 出现时追加到底部
- [ ] 手动验证通过：启用性格 + 价值观 + 情绪 + 记忆 四系统的 agent 聊一轮，抽屉里能看到 memory.retrieve call 的命中详情 + 主对话 call 的 4 张维度卡 + emotion.delta call 的 before/after/delta；主对话包含工具调用时能看到多个 call 串联

### 非目标（明确不做）

- ❌ 不动 `/observer` 独立页
- ❌ 不改 observer 数据表结构（只塞 metadata JSON）
- ❌ 不做筛选 / 搜索 / 过滤 UI
- ❌ 不做跨 session 对比
- ❌ 不新建维度层的独立 db 表

## 备注 / 注意事项

- **PromptFragment.source 已是 string 字段**，现有各系统 emit 时约定值：`personality` / `values` / `emotion` / `memory`（grep 确认；如果有系统没填 source，补上，值按上述约定）
- runner 里 fragments 拼接 systemPrompt 的代码在 `runner.ts`；snapshot 时把 fragments 数组一起传进 `observer.onLLMCallStart` 的 metadata
- 现有 `llm_calls.kind` 枚举：`'turn' | 'compaction' | 'memory' | 'emotion'`——够用，不扩枚举，用 `metadata.phase` 细分
- memory.retrieve 的 `hits` 用 `findRelevantMemories` 已经返回的对象直接塞，别再查一次
- 维度卡区在 call 类型和 fragment 都不匹配时**整块不渲染**（不要留空卡片占位）
- 抽屉宽度固定，内部竖直 flex + overflow-y 滚动；不要尝试做响应式栅格
- UI 风格沿用现有 Modern Dark Cinema 设计 token（`globals.css` 的配色 / 半径 / 玻璃态）——新维度卡用玻璃态 + 不同 accent 色区分（性格 indigo / 价值观 amber / 情绪 pink / 记忆 emerald，作参考）
- **合并冲突风险**：本 task 碰 `runner.ts` + `ObserverDrawer.tsx` 两个 hot file，不要和其他 task 并行派发
- 完成后手动截图发群（或描述验证路径）——UI task 的完成标准不能只靠 typecheck + 测试

---

## 返修要求（2026-04-19 追加）

### 背景

第一版把所有 llm_call（主对话 + memory.retrieve + memory.summarize + emotion.delta + compaction.summary）全塞到主抽屉时间线里，同时记忆卡展示命中 hits、情绪卡展示 before/after/delta——这条路线有两个问题：

1. **scheme 耦合**：记忆卡 / 情绪卡直接渲染了 sqlite / dimensional scheme 的源数据形状，未来切换 scheme（memory → chromadb、emotion → plutchik-wheel）UI 直接断裂
2. **范围混乱**：主抽屉同时承担"主对话观测"和"系统内部 call 观测"两件事，容易把用户看懵

新方案划清职责：**主抽屉只观测主对话 call + 按系统来源区分展示 prompt 贡献**；各系统内部 call 归各自模块观测页（B8 起分别单独 task，按 scheme 一套 UI）。

### 抽屉层必须改

1. **只渲染 `kind === 'turn'` 的 llm call**，其他 kind（memory / emotion / compaction）的 call **在抽屉里过滤掉不展示**
2. **维度卡简化成只展示 `fragment.content` 文本**：
   - 性格卡 / 价值观卡 / 情绪卡 / 记忆卡：统一按 `fragment.source` 匹配本 call 的 fragments，直接渲染 content 字符串（保留系统名 + accent 色区分）
   - **删除**所有 scheme-specific 字段展示：
     - 记忆卡不再渲染 hits 表格 / matchedTerms / importance 数值
     - 情绪卡不再渲染 before / after / delta / trigger
     - 不再在抽屉里体现 memory.summarize 的 written / consolidate 的 report
3. **某系统在本 call 没有 fragment 时，对应维度卡整块不渲染**（不占位、不显示"无数据"提示）
4. **call 类型标签**可去掉（既然只剩 `turn` 一种 kind）
5. final system prompt 折叠区、tools schema 折叠区、messages 时间线（含 compaction 内联提示）——**保留**，逻辑不变

### 数据层必须保留不动

- `llm_calls.metadata_json.fragments`（`{source, priority, content}` 数组）保留——主抽屉维度卡的数据源
- `memory.retrieve` 的 `hits`、`memory.summarize` 的 `written`、`memory.consolidate` 的 `report`、`emotion.delta` 的 before/after/delta/trigger、compaction 的 before/after——**全部保留在 metadata_json 里**
- 理由：B8 及后续模块观测页（`/observer/memory/sqlite`、`/observer/emotion/dimensional` 等）要消费这些字段

### 非目标

- ❌ 不动 `/observer` 独立页
- ❌ 不做 `/observer/memory/sqlite` 等模块观测页（B8 单独 task）
- ❌ 不动数据层 metadata 的形状 / 字段（B8 要用）
- ❌ 不删除 runner 里 emit 这些 metadata 的逻辑

### 完成标准（返修版）

- [ ] 主抽屉只看到主对话 call（一轮一张卡；有工具调用则本轮内可能多张主对话 call 串联，但没有 memory / emotion / compaction 的 call）
- [ ] 维度卡只展示 `fragment.content`，一眼能看出"这段 prompt 是哪个系统写的"
- [ ] 未启用的系统对应的维度卡不渲染
- [ ] final system prompt 折叠区展开可验证"维度卡里各 fragment 拼接起来 = 完整 system prompt"
- [ ] 手动验证：开启性格 + 价值观 + 记忆三系统的 agent 发一句话，抽屉看到 3 张维度卡 + final prompt 能对应上
- [ ] typecheck / 单测通过（单测若以旧结构写的断言需同步调整）

### 备注

- 不要动 `runner.ts` 里往 metadata 塞 fragments / hits / delta 的那套逻辑——全部保留
- 可以复用第一版做好的维度卡子组件，只是把内部的 hits 表格 / delta 显示段落删掉
- 抽屉 UI 风格沿用第一版已实现的 Modern Dark Cinema 样式
- 合并前在本地 dev 跑一轮端到端验证（至少 2 个启用了不同系统组合的 agent，观察 3 张 / 4 张 / 0 张维度卡的渲染都正确）
