# Memory Embedding Retrieval Design

## Goal

将当前 `memory:sqlite` 从“LLM 生成关键词 + `tags like` 检索”的方案，重构为“LLM 生成自然语言检索文本 + embedding 检索 `retrieval_text` + 注入 `display_summary`”。

本次只做最小可用版，不做 STM/LTM、睡眠机制、hybrid、rerank。

## Scope

- 记忆存储结构重建
- 记忆库迁移到独立 `memory.db`
- memory write / query / retrieve / prompt injection 全链路切换到 embedding
- 允许直接清空旧 memories 数据，不兼容旧 schema / 旧数据

## Architecture

### Databases

- `data.db`
  - 保留业务主库：agents / sessions / messages / llm_calls / emotion / relationship / daemon
- `storage/memory/memory.db`
  - 只放记忆相关表
  - 当前只建一张 `memories`

### Memory Record

`memory.db.memories` 最小字段：

- `id`
- `agent_id`
- `session_id`
- `source_text`
- `display_summary`
- `retrieval_text`
- `retrieval_embedding`
- `retrieval_model`
- `tags`
- `importance`
- `created_at`

说明：

- `display_summary` 只用于 UI 展示和 prompt 注入
- `retrieval_text` 只用于 embedding 检索
- `tags` 降级为辅助元数据，不再做主检索入口

### Write Flow

每轮 `afterTurn`：

1. summarize LLM 输出：
   - `display_summary`
   - `retrieval_text`
   - `tags`
   - `importance`
2. 调用 OpenRouter embeddings 生成 `retrieval_text` 的 embedding
3. 写入 `memory.db.memories`

### Query Flow

每轮 `beforeTurn`：

1. query LLM 输出：
   - `retrieval_query`
   - `time_range`
   - `focus?`
2. 对两路文本分别生成 embedding：
   - 用户原问题
   - `retrieval_query`
3. repository 先按 `agent_id`、可选 `time_range` 过滤候选 memory
4. 对候选 memory 的 `retrieval_embedding` 做相似度比较
5. 合并两路命中结果、去重、取前几条

### Prompt Injection

只注入命中的 `display_summary`：

```txt
以下是本轮回复可直接依赖的相关记忆：
- ...
- ...
```

不再依赖 tag 作为主搜索入口，不注入 `retrieval_text`。

## Embeddings

本次只实现 OpenRouter embeddings。

- provider: `OpenRouterEmbeddingProvider`
- 默认 model: `qwen/qwen3-embedding-0.6b`

原因：

- 速度优先
- 成本低
- 足够支撑当前最小检索方案

## Reset Strategy

- 不迁移旧 memories
- 不兼容旧 schema
- 允许直接删除旧 memory 数据
- 新系统从空 `memory.db` 开始累积

## Out of Scope

- 长短期记忆分层
- 固化记忆
- 睡眠机制
- hybrid BM25
- rerank
- 独立 memory service
- 每 agent 独立 memory sqlite
