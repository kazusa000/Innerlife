# 四层记忆流水线设计

日期：2026-04-22

## 目标

把当前“每轮直接写 memory”的方案，重构成更接近人的四层记忆系统：

- `context`：当前活跃对话缓存，只存在于模型上下文里
- `short_term`：由 daemon 在空闲或超窗时，从旧上下文提炼出的短期记忆
- `long_term`：由每日一次的睡眠流程，把短期记忆沉淀成长期记忆
- `fixed`：从长期记忆中手动提升出的极稳定事实记忆

这次设计只定义第一版结构和运行规则，不提前实现自动提升、复杂意图判断、混合检索或认知反思。

## 已确认边界

- 原始 `messages` 永远保留在数据库里，不物理删除
- `context` 不参与 embedding 检索，它只是当前送进模型的活跃消息窗口
- `STM / fixed` 每轮都做前置检索
- `LTM` 不前置注入，只有主模型主动调用长期记忆搜索 tool 时才参与
- `LTM` 搜索 tool 每轮最多调用 1 次
- `STM -> LTM` 固定每天一次，由 daemon 的睡眠流程执行
- `fixed` 第一版只支持手动从 `long_term` 提升
- 记忆检索未命中时不静默，先用固定格式提示“未搜索到相关记忆”

## 非目标

这次不做：

- token 级 context 预算控制
- `memory-intent` 判定后再决定是否检索 STM / fixed
- `fixed` 自动提升
- `LTM` 自动前置检索
- 跨层 consolidate
- 复杂“睡眠反思”或“人格成长”逻辑

## 一、运行时模型

### 1. Context

`context` 是当前活跃会话在模型里的缓存，不是记忆对象。

它的特征是：

- 来源于当前 session 的 `messages`
- 只取某个尾部区间，而不是全量历史
- 不写入 `memory.db`
- 不参与检索

实现上，`context` 不是单独复制一份文本，而是由 `messages` 上的活动边界决定。

### 2. Short-term memory

`short_term` 是由 daemon 从旧上下文中提炼出来的近期印象。

第一版规则：

- 不再每轮写 `short_term`
- 只在以下两种情况下生成：
  - 对话空闲到达阈值
  - 活跃 `context` 严重超出窗口上限
- 一次上下文卸载处理“最早的一段完整回合块”
- 每次最多生成 `3` 条 `short_term`
- 只有写入成功后，相关旧上下文才从活跃窗口移出

### 3. Long-term memory

`long_term` 是每天固定一次“睡眠”流程从 `short_term` 沉淀出来的长期记忆。

第一版规则：

- 固定每天一次
- 不做复杂反思，只做短期记忆的整理与沉淀
- `long_term` 不参与前置注入
- 只在主模型需要时，通过长期记忆搜索 tool 进入下一轮 LLM 调用

### 4. Fixed memory

`fixed` 是从 `long_term` 手动提升出的极稳定事实记忆，例如名字、长期偏好、稳定背景事实。

第一版规则：

- 只支持手动提升
- 与 `short_term` 一样，参与每轮前置检索和注入
- 不走长期记忆搜索 tool

## 二、上下文窗口与搬运规则

### 1. 上下文窗口控制

第一版先按消息条数控制 `context` 长度，不按 token。

基础参数：

- `contextWindowMessages`：活跃上下文最大消息条数
- `contextOverflowBatchSize`：强制卸载时，一次考虑处理的最早回合块范围

### 2. 混合触发策略

`context -> STM` 使用混合触发：

- 正常情况：空闲触发
- 极端长对话：超窗强制触发

### 3. 搬运对象

强制卸载和空闲搬运都遵守同一规则：

- 只处理最早的一段旧上下文
- 必须按完整回合块搬走
- 不按单条 message 生切

### 4. 写入优先级

搬运顺序固定为：

1. 从最早旧上下文中提炼最多 3 条 `short_term`
2. 成功写入 `memory.db`
3. 更新 session 的活跃上下文边界

如果写入失败：

- 活跃上下文边界不动
- 这段旧消息继续保留在 `context` 中

## 三、数据模型

### 1. messages

`messages` 继续保存完整会话历史，承担：

- 聊天回放
- observer 证据
- 图灵测试 transcript
- 后续记忆重建的原始依据

### 2. session context state

新增一张 session 级运行时状态表，例如 `session_context_state`，用于表达活跃上下文边界。

第一版最小字段：

- `session_id`
- `active_start_message_id`
- `pending_flush_until_message_id`
- `last_user_message_at`
- `last_context_flush_at`
- `updated_at`

这张表只负责 runtime context，不承担记忆存储职责。

### 3. memory.db

`memory.db` 继续只保存真正的记忆对象，layer 固定为：

- `short_term`
- `long_term`
- `fixed`

`context` 不进入 `memory.db`。

## 四、主对话 prompt 组装

每轮主对话只由以下部分组成：

1. 基础 `system prompt`
2. 当前 `context`
3. `short_term` 检索命中
4. `fixed` 检索命中

不包含：

- 全量历史消息
- 默认注入的 `long_term`

### 1. Context

`context` 直接来源于当前 session 中、从 `active_start_message_id` 开始的消息尾部区间。

### 2. STM / fixed

`short_term` 与 `fixed` 每轮都做前置检索，并以统一格式注入。

命中格式：

- `[短期记忆][2026-04-21 14:32 +02:00] ...`
- `[固化记忆][2026-03-11 09:10 +02:00] ...`

未命中格式先固定为：

- `短期记忆检索结果：未搜索到相关记忆。`
- `固化记忆检索结果：未搜索到相关记忆。`

第一版先用固定格式，不引入额外的 `searched=true/false` 结构化状态位。

## 五、长期记忆 tool 搜索

长期记忆不前置注入，只能通过一个显式 tool 进入主对话循环：

- `search_long_term_memory`

### 1. Tool 使用原则

该 tool 自身带明确规则：

- 只有当前 `context + short_term + fixed` 仍不足以回答时，才允许搜索 `long_term`
- 不要把长期记忆搜索当成默认动作
- 每轮最多调用 1 次

### 2. Tool 结果

tool 返回两类结果：

- 命中若干 `long_term`
- 未命中

未命中时不能静默，下一轮 LLM 调用前必须明确注入：

- `长期记忆检索结果：未搜索到相关记忆。`

## 六、Sleep 机制

后台第三块统一命名为：

- `睡眠区`

它代表每天一次的 `STM -> LTM` 流程，而不是泛化的 daemon 配置区。

第一版可配置项：

- `sleepEnabled`
- `sleepTimeLocal`
- `sleepIntervalDays`

第一版默认：

- 固定每天一次

这里先不做复杂多阶段睡眠，只做稳定沉淀。

## 七、管理后台

memory 管理页升级成三段式工作台：

### 1. Context 控制区

显示并可配置：

- 当前 active context 大小
- active context 起点
- 最近一次 `context -> STM` 时间
- `contextWindowMessages`
- `contextOverflowBatchSize`
- `contextIdleFlushMinutes`
- `maxShortTermMemoriesPerFlush`

并提供：

- `立即整理当前旧上下文`

### 2. 短期 / 长期 / 固化记忆区

提供统一表格：

- layer 筛选
- 搜索
- 分页
- 单条详情
- 单条改 layer
- 删除单条记忆

### 3. 睡眠区

显示并可配置：

- daemon 在线状态
- 最近 heartbeat
- 最近一次 sleep 执行时间
- 最近一次 `STM -> LTM` 结果
- `sleepEnabled`
- `sleepTimeLocal`
- `sleepIntervalDays`

并提供：

- `立即睡觉`

## 八、Prompt 与工具规则

### Prompt Lab

新的 memory prompt 结构按“记忆层级与转换流程”组织，而不是只按现有 `retrieve / summarize / consolidate` 组织。

第一版应至少包括：

- `Context → STM Prompt`
- `STM → LTM Prompt`
- `Short-term Fragment Prompt`
- `Fixed Fragment Prompt`

### 长期记忆工具规则

`Long-term Search Tool Prompt` 不作为普通 Prompt Lab 条目出现，而是包装在 `search_long_term_memory` 这个 tool 的工具级规则中。

它负责约束：

- 只在必要时调用
- 每轮最多 1 次
- 未命中时的固定反馈格式

## 九、第一版默认参数

第一版只把以下参数做成后台可调：

- `contextWindowMessages`
- `contextIdleFlushMinutes`
- `maxShortTermMemoriesPerFlush`
- `sleepEnabled`
- `sleepTimeLocal`
- `sleepIntervalDays`

其他参数，例如：

- `LTM` 生成上限
- importance 阈值
- 自动 `fixed` 提升

暂不暴露，后续再加。

## 十、验证标准

### 1. Context

- 活跃上下文不再等于全量 session 历史
- 原始消息保留，但模型只看到活动边界之后的消息

### 2. STM

- 对话过程中不再每轮直接写 `short_term`
- daemon 可在空闲或超窗时，从旧上下文提炼最多 3 条 `short_term`
- 只有写入成功，context 边界才推进

### 3. LTM

- 每日一次睡眠流程可把 `short_term` 沉淀成 `long_term`
- `long_term` 不参与前置注入
- 主模型可在必要时通过 tool 搜索 `long_term`

### 4. Fixed

- `fixed` 由手动提升产生
- `fixed` 每轮前置检索并注入

### 5. 未命中反馈

- `short_term` 未命中时有固定提示
- `fixed` 未命中时有固定提示
- `long_term` tool 未命中时有固定提示

## 十一、后续扩展

这套结构为后续能力预留了明确演进路径：

- `fixed` 自动提升
- 基于 token 的 context 预算
- `memory-intent` 判断后再决定是否检索 STM / fixed
- 更复杂的睡眠反思
- daemon 驱动的长期成长与自主行为

第一版先把分层、边界、后台搬运和使用方式做清楚，不追求一次做到最聪明。
