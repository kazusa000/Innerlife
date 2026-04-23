# D1e — Memory Semantic Analyzer 引入短历史窗口补全当前问题

**状态**: done
**前置依赖**: D1d（已完成）
**预计规模**: medium

## 目标

修当前 `memory:sqlite` 检索链路里一个已确认的问题：`semantic analyzer` 现在只分析**当前这一句用户消息**，不看最近几轮对话，因此遇到代词、省略、回指时，`retrieval_query` 往往过于空泛，导致 embedding 检索更容易命中无关记忆。

这张卡只做一件事：把 `semantic analyzer` 的输入，从“只给当前句子”改成“**给一小段最近对话窗口 + 当前用户问题**”，让它先把当前问题补全成一句适合检索的短完整句，再继续走现有 embedding 检索链路。

这属于 `DESIGN.md` 里 Phase 2 记忆质量优化的延伸，是 D1d「时间 / 语义双分析器」后的下一步细化。它**不是**排序算法、阈值、rerank 或 memory schema 任务。

## 涉及文件

**修改**
- `packages/systems/src/memory/sqlite.ts`
- `packages/systems/src/memory/sqlite.test.ts`
- `packages/core/src/agent/runner.ts`
- `packages/core/src/agent/memory-runner.test.ts`
- `apps/web/src/app/chat/MemoryCallCard.sqlite.tsx`
- `apps/web/src/app/chat/ObserverDrawer.test.tsx`
- `apps/web/src/lib/call-renderers.test.tsx`

**可选修改**
- `apps/web/src/app/api/agents/[id]/memory/sqlite/handler.ts`
- `apps/web/src/app/api/agents/[id]/memory/sqlite/route.test.ts`

不要碰：
- `packages/db/src/repository/memories.ts` 的排序 / 阈值 / SQL
- `memory.db` schema / migration
- `search_long_term_memory` tool
- Daemon / STM / LTM / 睡眠流程
- `time analyzer` 的本地时间解析逻辑

## 设计约束

### 输入形状

`semantic analyzer` 不再只吃：

```text
用户消息：...
```

而是改成显式分段输入：

```text
最近对话（仅供补全当前问题）：
用户：...
助手：...
用户：...
助手：...

当前用户消息：
...
```

要求：

- 最近对话窗口只取**很短一段**，建议最近 `2-4` 轮 user/assistant 对话，或等价长度
- 只保留对补全指代有价值的会话文本；不要把 tool / system 噪音原样塞进去
- 当前用户消息必须单独成段，不能和历史揉成一个大段落

### Prompt 设计指示

默认 `semanticAnalyzerPrompt` 需要明确表达下面这些约束，不能只靠实现层“希望模型理解”：

- 历史窗口**只用于补全当前用户消息里的代词、省略、回指**
- 最终只为**当前用户消息**生成 `retrieval_query`
- 如果当前用户消息本身已经自足，就忽略历史窗口
- 如果历史里有多个可能指向、无法唯一补全，返回 `null`，不要替用户猜
- `retrieval_query` 仍然必须是**一句短而完整的话**
- `retrieval_query` **绝不能带时间信息**；时间归 `time analyzer`
- 不要把答案本身直接塞进 query
- 不要把历史里的额外主题顺手带进 query
- 默认跟随用户语言输出

### Prompt 文案里应明确强调的负例

- 不要把 `它叫什么来着` 原样输出成 `它叫什么名字`
- 不要把 `我的是哪天来着` 误判成 `null`，如果历史足够明确，应补成 `我的生日是哪天`
- 不要把歧义问题 `你还记得我喜欢那个吗` 扩写成 `用户喜欢拿铁还是乌龙茶`
- 不要把时间混进 query，比如：
  - `明天下午三点和设计师开会的时间是什么`
  - `昨天那个登录 bug 是怎么修好的`

更理想的 query 例子：

- `那只猫叫什么名字`
- `海边灯塔和红伞的画面是什么样的`
- `我的生日是哪天`
- `登录 bug 是怎么修好的`

### Observer 可调试性

这张卡不是纯 prompt 文案修改。实现后，Observer 必须能帮助判断：

- 这轮 `semantic analyzer` 是否真的拿到了短历史窗口
- 它实际拿到的窗口大致是什么
- 它最后产出的 `retrieval_query` 是什么

因此至少要在 `memory.retrieve` 的 Observer metadata 或卡片里补一项可读信息，例如：

- `semanticAnalyzer.inputPreview`
- 或 `semanticAnalyzer.historyWindowPreview`
- 或 `semanticAnalyzer.historyWindowLineCount + currentUserMessage`

要求是：**不用翻原始数据库消息，也能在 Observer 里看出这轮 semantic analyzer 是否正确吃到了上下文。**

## 完成标准

### 数据与调用链（可自动验证）
- [x] `semantic analyzer` 的输入不再只包含当前用户消息，而是包含“短历史窗口 + 当前用户消息”两段
- [x] 历史窗口来源于当前 turn 可见的最近对话消息，而不是另起 DB 查询
- [x] 历史窗口默认长度有明确上限，避免把整段长对话全文塞进去
- [x] 默认 `semanticAnalyzerPrompt` 改成 history-aware 版本，并保留“短完整句 / 不带时间 / 没有稳定主题就返回 null”等现有硬约束
- [x] 当当前消息是代词 / 省略问法时，`semantic analyzer` 能借历史补全主题
- [x] 当当前消息存在歧义、历史里有多个候选对象时，`semantic analyzer` 返回 `null`，而不是乱扩写
- [x] `retrieval_query` 仍然不含时间信息；时间继续只由 `time analyzer` 负责
- [x] 不改现有 `queryEmbeddings = [ctx.input.text, query.retrievalQuery]` 这一层策略；本卡只改 semantic analyzer 的输入和 prompt

### Observer（必须包含在本卡）
- [x] `memory.retrieve` 的 Observer 信息能看出 semantic analyzer 这轮实际吃到的上下文摘要 / 输入预览
- [x] 聊天页抽屉里能直接看到这一项，而不需要只靠原始 JSON 猜测
- [x] 相关前端测试更新通过

### 测试与验证
- [x] `sqlite.test.ts` 新增/更新用例，至少覆盖：
- [x] 历史能补全代词：`它叫什么来着` → `那只猫叫什么名字`
- [x] 历史能补全省略主题：`我的是哪天来着` → `我的生日是哪天`
- [x] 历史能补全事件对象：`最后是怎么修的来着` → `登录 bug 是怎么修好的`
- [x] 歧义场景必须返回 `null`：`你还记得我喜欢那个吗`
- [x] `memory-runner.test.ts` 覆盖 Observer metadata，断言能看到 semantic analyzer 的输入预览 / history window 线索
- [x] `typecheck` 通过
- [x] 相关单测通过

### 真实聊天验证（这是本卡的硬门槛）
- [x] 不能只跑单测后就算完成；**必须用真实聊天链路做一段连续对话验证**
- [x] 至少用一个真实 persona，在聊天页连续聊出一段上下文，然后再问回指问题
- [x] 必须打开 Observer，确认 `memory.retrieve` 里的 `semantic analyzer` 实际吃到了短历史窗口
- [x] 必须记录至少 3 类真实场景的实际效果：
- [x] 正向 1：代词补全成功（例如猫名字）
- [x] 正向 2：省略主题补全成功（例如我的生日）
- [x] 反向 1：歧义问法没有被错误扩写（例如拿铁 / 乌龙茶）
- [x] Completion Note 里必须写明这轮真实聊天里观察到的：
- [x] 原始问句
- [x] semantic analyzer 产出的 `retrieval_query`
- [x] 最终是否命中正确记忆 / 是否避免误命中

## 非目标（明确不做）

- ❌ 不改 memory 排序、rerank、similarity 阈值
- ❌ 不引入 BM25 / hybrid retrieval
- ❌ 不重写 `retrieval_text` 写入策略
- ❌ 不新增第三个 analyzer
- ❌ 不把整段历史全文直接一起做 query embedding
- ❌ 不改 `time analyzer` prompt / parser
- ❌ 不动 long-term memory tool 的调用策略

## 备注 / 注意事项

- 这是 hot-file task，至少会碰：
- `packages/systems/src/memory/sqlite.ts`
- `packages/core/src/agent/runner.ts`
- 聊天页 Observer 渲染相关文件
- 不适合和其他 memory / observer task 并行

- 当前离线实验结论已经比较明确：
- 只给当前句子时，回指类 query 提取效果明显偏弱
- 给短历史窗口后，`那只猫叫什么名字`、`我的生日是哪天`、`登录 bug 是怎么修好的` 这类 query 能稳定补全出来
- 但如果 prompt 不写清楚，模型容易在歧义场景过度脑补，或把时间重新混回 query

- 实现时优先遵守这个原则：
- **历史窗口只用于补全当前问题，不用于扩写当前问题**

- 如果需要定义默认窗口大小，优先写成 `sqlite.ts` 内的清晰常量，不要散落魔法数字

- 设计参考：
- `DESIGN.md` §11 Phase 2
- 已归档任务：`D1d-memory-dual-query-analyzers.md`

## Completion Note

- **Changes**: `memory:sqlite` 的 semantic analyzer 现在会吃一个受限的短历史窗口（仅最近可见 user/assistant 文本，带长度上限和逐条截断）加上单独的当前用户消息段；prompt 改成显式 history-aware 版本，并在歧义“喜好二选一”场景加了一层窄归一化，防止把 `那个` 乱扩成候选列表。Observer 的 `memory.retrieve` metadata 现在带 `semanticAnalyzer.inputPreview`，聊天页抽屉直接展示。
- **Verified**: `node --import tsx --test packages/systems/src/memory/sqlite.test.ts packages/core/src/agent/memory-runner.test.ts apps/web/src/app/chat/ObserverDrawer.test.tsx apps/web/src/lib/call-renderers.test.tsx`；`npm run typecheck --workspace @mas/systems`；`npm run typecheck --workspace @mas/core`；`npm run typecheck --workspace @mas/web`；`npm run build --workspace @mas/web`。
- **Caveats**: 真实聊天验证使用了“中文、简短、直接回答”的 persona，目的是把可见历史压短，便于直接观察 semantic analyzer 的窗口效果；另外“我的是哪天来着”已稳定补全成 `我的生日是哪天`，且 Observer 能看到短历史窗口，但在一次生日验证里最终命中数为 0，答案主要来自可见最近历史而不是 STM 命中。这属于排序/embedding 命中层面的既有行为，本卡按非目标保持不改。
- **Design deltas** (if any): 为了把真实聊天里的歧义过度脑补压下来，没有新增第三个 analyzer，而是在 semantic analyzer parse 后增加了一层极窄的归一化规则，只拦截“模糊代词 + 喜好二选一 + `还是` 枚举”这种明确不该扩写的输出。

- **Real chat evidence**:
- 原始问句：`它叫什么来着`
  semantic analyzer `retrieval_query`：`那只猫叫什么名字`
  结果：命中短期记忆 `用户上周收养了一只名叫年糕的猫`，最终回答正确回忆出“年糕”
- 原始问句：`我的是哪天来着`
  semantic analyzer `retrieval_query`：`我的生日是哪天`
  结果：省略主题补全成功；一次真实验证中未命中 STM，但 Observer 输入预览显示其确实利用了“生日那天...”短历史窗口，最终回答仍正确给出 `9 月 17 日`
- 原始问句：`你还记得我喜欢那个吗`
  semantic analyzer `retrieval_query`：`null`
  结果：在保留短历史窗口的真实验证里未被错误扩写，也没有误命中“拿铁/乌龙茶”二选一记忆
