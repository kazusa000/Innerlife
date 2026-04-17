# A1+A2+A3 — 文件读写 + 网页抓取三件套工具

**状态**: done
**前置依赖**: 无
**预计规模**: medium（3 个小工具共用一套脚手架）

## 目标

让 agent 不用再借 bash 来读文件、写文件、抓网页。三件事是同一类工作（I/O 型工具），合并在一个 task 里做更高效。

- **A1 FileReadTool** — 读指定路径文件内容
- **A2 FileWriteTool** — 创建 / 覆盖 / 追加写入文件
- **A3 WebFetchTool** — 给 URL 返回网页正文（去除脚本/样式噪音）

## 涉及文件

- `packages/core/src/tools/file-read.ts`（新建）
- `packages/core/src/tools/file-write.ts`（新建）
- `packages/core/src/tools/web-fetch.ts`（新建）
- `packages/core/src/tools/index.ts` 或等价出口（修改，导出新工具）
- agent 注册工具的入口（现状是手动传 `tools` 数组，位置参考 `apps/web/src/app/api/chat/` 或 core 内的 runAgent 调用处）

## 完成标准

- [x] 三个工具均实现 `Tool` 接口（`name` / `description` / `inputSchema` / `call`）
- [x] FileRead：路径必填；不存在返回 `isError: true` + 清楚的 error 文本
- [x] FileWrite：支持 `mode: 'create' | 'overwrite' | 'append'`；父目录不存在则自动创建
- [x] WebFetch：超时 30s；返回正文（HTML→text 即可，不必强求 Readability 算法，先跑通）；非 2xx 返回 `isError: true`
- [x] 三个工具在 agent 注册列表里可见，LLM 能通过 tool_use 调用
- [x] 本地手动验证：直接调用工具完成读取 `package.json`、写入 `/tmp/mas-a1a3.txt`、抓取 `https://example.com/`；并完成 `@mas/core` typecheck 与 `apps/web` production build。未额外跑一遍带 Observer 的浏览器手动链路
- [ ] 更新 `project-docs/STATUS.md`（由 Coordinator 验收时做，不需要 agent 改）

## 备注 / 注意事项

- 参考 `packages/core/src/tools/bash.ts` 作为骨架，保持和它同等的简洁度
- **不要**在这三个工具里加权限/破坏性/只读标记字段；那是 Phase 3 的事（见 DESIGN §5.1 可选方法）
- WebFetch：用 Node 20+ 原生 `fetch`，不要引新的重型依赖；HTML→text 可先粗暴 strip `<script>` `<style>` 然后去标签
- A4（自动注册）是**单独**的 task，本 task 仍然走**手动数组注册**。不要越界
- 输出 `ToolResult.output` 的文本应保持对 LLM 友好——读大文件要裁剪（比如超过 100KB 就截断并在末尾提示）

## 完成说明

- 新增 `file_read`、`file_write`、`web_fetch` 三个工具，并从 `@mas/core` 导出
- chat API 的手动工具注册列表已加入这三个工具，仍然保持手动注册，不越界到 A4
- `file_read` 对缺失文件返回清晰错误；大于 100KB 的文本会裁剪
- `file_write` 支持 `create` / `overwrite` / `append`，会自动创建父目录，`create` 模式下若文件已存在则返回错误
- `web_fetch` 使用原生 `fetch` + 30s 超时，非 2xx 返回错误，HTML 会去掉脚本/样式并粗略转成文本
- 已验证：`packages/core` typecheck 通过；`apps/web` build 通过；工具直接调用读写本地文件与抓取 `https://example.com/` 均成功
- 剩余 caveat：还没有额外走一遍浏览器聊天页 + Observer 的手工端到端验收
