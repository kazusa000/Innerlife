# D4a — 聊天侧栏清除上下文并写入短期记忆

**状态**: pending
**前置依赖**: D4 / G1（已完成）
**预计规模**: small-medium

## 目标

把聊天页左侧现有的“清除上下文”动作升级为**先把当前 active context 手动整理成短期记忆，再重置对话上下文**。

这张卡对应当前 sqlite 分层记忆流水线里的 `context -> short_term` 手动触发能力，但入口不放在 `/agent/[id]/memory` 控制台，而是直接挂到日常聊天页侧栏，满足“聊到一段后我想主动清空上下文，同时别丢掉刚聊过内容”的实际使用场景。

## 涉及文件

**修改**
- `apps/web/src/app/chat/Sidebar.tsx`
- `apps/web/src/app/chat/page.tsx`
- `apps/web/src/app/api/agents/[id]/active-session/route.ts`
- `apps/web/src/app/api/agents/[id]/active-session/handler.ts`
- `apps/web/src/app/api/agents/active-session-api.test.ts`

**可选修改**
- `apps/web/src/app/api/agents/[id]/memory/context/handler.ts`
  只允许做最小复用抽取；不要新增平行语义的新 route

## 接口约定

不要新开一个聊天专用 reset route。直接扩展现有：

`POST /api/agents/:id/active-session`

请求体新增可选字段：

```json
{
  "reset": true,
  "flushContext": true
}
```

语义：

1. `reset !== true` 时保持现状
2. `reset === true && flushContext !== true` 时保持当前“直接归档旧 session 并新建 active session”的现状
3. `reset === true && flushContext === true` 时：
   - 若当前 agent 是 `memory:sqlite`，先对**当前 active session**执行一次 `mode: 'manual'` 的 context flush
   - flush 完成后，再 archive 旧 active session 并创建新的 active session
   - 响应里附带 flush 结果，给聊天页侧栏展示

响应示意：

```json
{
  "session": { "...": "new active session" },
  "contextFlush": {
    "ok": true,
    "mode": "manual",
    "createdCount": 2,
    "memoryIds": ["..."],
    "nextActiveStartMessageId": null,
    "flushedMessageCount": 8
  }
}
```

## 行为约定

- 只在 `memory.scheme === "sqlite"` 时，把侧栏按钮文案升级为：`清除上下文并撰写短期记忆`
- 非 sqlite agent 维持现有 `清除上下文` 行为，不强行接 flush 语义
- 对于 `flushContext: true` 的 sqlite 流程，以下结果视为**软结果**，仍然继续 reset：
  - `no_messages`
  - `no_active_context`
  - `nothing_to_flush`
- 以下情况视为**硬失败**，不要创建新 session：
  - agent 不存在
  - 当前 agent 不是 `memory:sqlite`
  - flush 过程中 LLM / provider / embedding / 写库抛错
- 聊天页需要把 flush 结果明确反馈给用户，至少覆盖：
  - 成功写入了几条 STM
  - 没有可写入内容，但上下文已清空
  - flush 失败，因此没有执行 reset

## 完成标准

### 数据与接口层（可自动验证）
- [ ] `active-session` handler 支持 `{ reset: true, flushContext: true }`
- [ ] sqlite agent 下，reset 前会先对当前 active session 触发一次 `mode: 'manual'` 的 context flush
- [ ] soft result (`no_messages` / `no_active_context` / `nothing_to_flush`) 不阻断 reset
- [ ] hard failure 不会 archive 当前 active session，也不会创建新 session
- [ ] `apps/web/src/app/api/agents/active-session-api.test.ts` 补覆盖：
- [ ] `flushContext: true` 时先 flush 再 reset
- [ ] soft result 仍继续 reset
- [ ] hard failure 时不 reset
- [ ] typecheck 通过
- [ ] 受影响测试通过

### UI 层（必须浏览器验证）
- [ ] 聊天页左侧在 `memory:sqlite` agent 下显示 `清除上下文并撰写短期记忆`
- [ ] 点击后有明确 loading 态，避免重复触发
- [ ] 操作完成后会切到新 session，并给出 flush 结果提示
- [ ] 非 sqlite agent 仍保留现有 `清除上下文` 行为，不出现错误文案
- [ ] 至少人工验证 2 个场景：
- [ ] sqlite agent 聊几轮后点击按钮，能看到新 session，且 `/agent/[id]/memory` 里出现新增的 short_term memory
- [ ] sqlite agent 在几乎没有活跃 context 时点击按钮，仍能 reset，但提示“没有可搬运的旧 context”或等价文案
- [ ] 如果涉及侧栏按钮和状态提示样式，验证小窗口下内容不截断、滚轮能滚到底部
- [ ] typecheck + 测试通过不等于任务完成，必须浏览器人工验证

## 非目标（明确不做）

- ❌ 不修改 daemon 的自动 idle flush / overflow flush / sleep 规则
- ❌ 不新增新的 memory route；复用现有 `active-session` 与 context flush 能力
- ❌ 不改 `/agent/[id]/memory` 控制台的信息结构
- ❌ 不把这次动作扩展成“顺便沉淀 long_term”或“顺便 consolidate”
- ❌ 不改聊天主链路的正常自动记忆检索逻辑

## 备注 / 注意事项

- 当前聊天页左侧按钮已经存在，但只是 `POST /api/agents/:id/active-session` with `{ reset: true }`；本卡是在这个动作上加 sqlite-specific 的前置 flush
- 尽量把编排收在 `active-session` handler，避免前端发两次请求后自行拼状态
- 当前已有可复用的手动 flush 能力：`POST /api/agents/:id/memory/context`
  这张卡可以直接复用其 handler / daemon job 逻辑，但不要让聊天页自己串两个公开 endpoint
- hot files：
  - `apps/web/src/app/chat/page.tsx`
  - `apps/web/src/app/chat/Sidebar.tsx`
  - `apps/web/src/app/api/agents/[id]/active-session/handler.ts`
- 设计参考：
  - `DESIGN.md §10.6 Memory`
  - `DESIGN.md §10.8 Daemon 与记忆演化`
  - `STATUS.md` 里关于 `context / short_term / long_term / fixed` 的现状说明
