# B4 — 中断 / 取消正在进行的回复

**状态**: done
**前置依赖**: 无
**预计规模**: medium

## 目标

长回复或工具卡住时用户能点"停止"取消掉这一轮。`AbortController` 贯穿：前端 UI → SSE 请求 → runAgent → LLM stream → 工具执行。

参考：`reference-project/claude-code/src/utils/abortController.ts` 的穿透模式。

## 涉及文件

- `packages/core/src/agent/runner.ts`（接受外部 AbortSignal，检查点：每次 LLM 调用前、工具调用前、yield 前）
- `packages/core/src/tools/types.ts`（`Tool.call` 签名加可选 `{ signal?: AbortSignal }`）
- `packages/core/src/tools/bash.ts` + A1-A3 工具（如果先落地了）——把 signal 传给 child_process / fetch
- `packages/core/src/provider/anthropic.ts`（`streamMessage` 支持 signal，透传给 fetch）
- `apps/web/src/app/api/chat/route.ts`（把客户端断开信号转成 AbortController；或用 request.signal）
- `apps/web/src/app/chat/ChatArea.tsx`（流式状态下 send 按钮变成"停止"按钮；点击调用 AbortController.abort()）

## 完成标准

- [x] 前端流式显示途中点停止，LLM stream 立即中断，不再继续 yield 新 delta
- [x] 正在执行的 bash 命令被 kill（child_process 带 signal）
- [x] 中断后前端状态正确：composer 恢复可用，最后一条 assistant 消息保留"已被中断"标记或内容截断点
- [x] 已中断的 turn 不会"补发"——Observer 里能看到 turn 提前终止
- [x] 网络断线（浏览器关闭）也能正确释放资源，不留僵尸 stream

## 备注 / 注意事项

- 不要做"暂停 / 恢复"，只做"取消"
- 取消后的现场保存：对话历史里要不要留下半条 assistant 消息？**建议**保留已经流出来的文本，尾部加 `—（中断）`，这样 Observer 和 DB 里都能看到真实发生过什么
- 检查点不要太密（不必每个 delta 都 `throwIfAborted`），在"启动下一次 LLM 调用前"和"启动工具前"两处做即可
- 前端"停止"按钮样式：沿用 ChatArea 当前的设计系统（indigo→灰 或直接 coral 色）

## Completion Note

- 改动：为 `runAgent`、Anthropic provider、bash/web fetch 工具和聊天 SSE 链路接入 `AbortSignal`，前端流式发送按钮改为停止按钮，中断后保留已生成文本并追加 `—（中断）`。
- 验证：`npm --workspace packages/core test`、`npm --workspace packages/core run typecheck`、`npm --workspace packages/observer run typecheck`、`npm --workspace packages/db run typecheck`、`npm --workspace apps/web run build`。
- Caveats：浏览器主动关闭连接的释放路径已通过 `request.signal` 贯穿实现，但未单独做一次真实浏览器断线的手工回归。
