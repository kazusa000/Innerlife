# D1a — Memory tags 强制中英双语

**状态**: done
**前置依赖**: D1（已完成）
**预计规模**: small

## 目标

修 D1 上线后发现的 bug：跨语言关键词检索漏命中。

## 现象

实测 Hazel 跨 session 测试：

- 会话 A：用户说 "我叫王家骏" → memory 入库，summary 中文，**tags 是 LLM 给的全英文** `["greeting", "name_introduction", "conversation_initiation"]`
- 会话 B：用户问 "我叫什么名字" → 检索分词出 `["我", "叫", "什么", "名字"]`（中文）→ SQL `tags LIKE '%名字%'` 匹配不到全英文 tag → 返回 0 条 → prompt 不注入 → Hazel 答 "尚未得知"

记忆**写入正常**，**读取因 tag 单一语种漏命中**。

## 涉及文件

- `packages/systems/src/memory/sqlite.ts`（修改 summarize prompt）
- `packages/systems/src/memory/sqlite.test.ts`（新增/补充测试）

不要碰：runner、registry、DB schema、UI

## 改法

修改 `sqlite.ts` 里 summarize prompt 模板，明确要求 tags **同时给中文和英文同义词**，比如：

```
请为本轮对话生成 JSON，字段：
{
  "summary": "...",
  "tags": ["..."],   // 至少 6 个；中英文同义词都要列，例如 ["名字", "name", "称呼", "introduction"]
  "importance": 0..1
}
```

不需要做语种检测之类的复杂逻辑，靠 prompt 约束足够。

## 完成标准

- [x] summarize prompt 模板包含"中英文同义词都要给"的明确要求
- [x] 单测：mock LLM 返回包含中英 mixed tags 的 JSON，断言能正常解析存入 `memories.tags`
- [x] 单测：构造一条 fixture memory（tags 同时含 `["名字", "name"]`），用中文 input "我叫什么名字" 走检索，断言能命中；再用英文 input "what's my name" 也能命中
- [x] 不破坏现有 D1 测试 —— `npm test --workspace @mas/systems --workspace @mas/core --workspace @mas/db` 全过
- [x] `npm run typecheck --workspace @mas/systems` 通过

## 备注

- **不要**改检索逻辑（关键词分词、SQL LIKE）—— 只动 prompt
- **不要**做"重写已有 memories 的 tags"——历史 5 条 (Hazel 那批) 留着即可，新 memory 用新 prompt 就行
- 写完合并后用 Hazel 实测：开新会话告诉她一件事 → 再开新会话用另一种语言问 → 应能记得
- 如果用户后续报 "tags 列表太长污染 DB" 再开 D1b 加上限（当前 LLM 应该自己控制在合理范围）

## Completion Note

- **Changes**: 把 `memory/sqlite` 的 summarize prompt 改成强制输出至少 6 个 tags，并尽量同时给出中文和英文同义词；补了 mixed bilingual tags 的解析持久化测试，以及中英文输入都能命中的检索测试。
- **Verified**: `node --import tsx --test src/memory/sqlite.test.ts`（在 `packages/systems`）；`node --import tsx --test src/repository/memories.test.ts`（在 `packages/db`）；`npm test --workspace @mas/systems --workspace @mas/core --workspace @mas/db`；`npm run typecheck --workspace @mas/systems`。
- **Caveats**: 没做 Hazel 的真实手测；任务备注里的那一步留给合并后带 API key 的环境。为满足 `@mas/systems` typecheck，顺手补了 `packages/systems/src/emotion/dimensional.test.ts` 里缺失的 `turnMetadata` 测试夹具字段，这个问题是基线已有、与 D1a 运行时逻辑无关。
- **Design deltas**: 无运行时设计偏移；仅把 prompt 约束写得更具体，保持 D1a 要求的“只改 prompt，不改检索逻辑”。
