# G1 — Daemon v1

**状态**: pending
**前置依赖**: 无
**预计规模**: medium

## 目标

创建一个**本地单进程常驻 daemon v1**，让系统第一次具备“关掉网页后后台仍然活着”的基础能力。它的职责先收窄为：进程存活、单实例锁、heartbeat、固定 tick loop、可观测状态；先不提前把 scheduler、自主行为、Context→STM→LTM 搬运塞进同一张卡。

这张卡对应 `DESIGN.md §11 / Phase 4 / G1`。它是后续 `G2 Scheduler / 后台任务循环` 和 `G3 记忆三层演化` 的地基：先解决后台进程如何长期运行、如何被识别、如何知道自己还活着，再谈它具体处理哪些后台工作。

## 涉及文件

**新建**
- `packages/daemon/package.json`
- `packages/daemon/src/main.ts`
- `packages/daemon/src/runner.ts`
- `packages/daemon/src/lock.ts`
- `packages/daemon/src/types.ts`
- `packages/db/src/repository/daemon-state.ts`
- `packages/db/migrations/<next>_*.sql`
- `packages/daemon/src/*.test.ts`

**修改**
- `package.json`
- `packages/db/src/schema.ts`
- `packages/db/src/index.ts`
- `project-docs/DESIGN.md`（若实现期发现需要补充精确字段/状态语义，再小幅回写）

## 完成标准

### 进程层（可自动验证）
- [x] 新增 `@mas/daemon` 包，提供明确入口命令，可从仓库根启动本地 daemon
- [x] daemon 启动后写入单实例锁；同机重复启动时会被拒绝，并给出可读错误
- [x] daemon 支持优雅退出，停止时释放锁并更新最终状态

### 状态层（可自动验证）
- [x] 数据层新增 daemon 状态持久化，至少能记录：`pid`、`startedAt`、`lastHeartbeatAt`、`status`
- [x] daemon 运行时按固定间隔刷新 heartbeat
- [x] 提供仓库内可复用的状态读取接口，供未来 web/CLI 状态页直接复用

### 运行层（可自动验证）
- [x] daemon 内部有固定 tick loop，但当前 tick 只做 heartbeat / 基础巡检，不执行 `scheduled_tasks`
- [x] tick loop 具备最小错误隔离：单次 tick 出错不会直接让整个 daemon 进程静默退出
- [x] 自动化测试覆盖：单实例、heartbeat 刷新、优雅退出、tick 错误隔离
- [x] typecheck 通过
- [x] 相关单测通过

## 非目标（明确不做）

- ❌ 不做 `scheduled_tasks` 的扫描与执行（延后到 `G2`）
- ❌ 不做 Context → STM → LTM 的实际搬运逻辑（延后到 `G3`）
- ❌ 不做自主行为（主动问候 / 自我反思 / 日程执行，延后到 `G4`）
- ❌ 不做多进程、多 worker、多机部署
- ❌ 不做 daemon UI 页面或控制台面板；状态只需先能被代码和数据库读取

## 备注 / 注意事项

- 代码约定提示：当前项目默认还是 `apps/web` 驱动主聊天链路；daemon v1 是新增后台进程，不应该接管现有同步聊天请求。
- 数据语义提示：daemon 状态应是“当前本地后台进程的运行状态”，不是 agent 业务数据，不要和 `sessions` / `llm_calls` / `memories` 混表。
- 合并冲突风险：`packages/db/src/schema.ts` 和根 `package.json` 是 hot file；这张卡应避免顺手改 `runner.ts`、`apps/web/src/app/api/chat/route.ts` 之类更热的链路文件。
- 设计参考：`DESIGN.md §10.8-10.9, §11 Phase 4 / G1`；参考项目 `reference-project/openclaw/` 的 heartbeat / cron 思路，但 v1 只取“本地常驻 + 心跳 + tick”这层。

## Completion Note

- **Changes**: 新增 `@mas/daemon` 包，提供根命令 `npm run daemon:start`、文件锁、固定 tick loop 和 SIGINT/SIGTERM 优雅退出；`@mas/db` 新增 `daemon_state` schema / repository / migration，持久化当前本地 daemon 的运行状态与最近错误。
- **Verified**: `npm test --workspace @mas/db --workspace @mas/daemon`；`npm run typecheck --workspace @mas/db --workspace @mas/daemon`；`npm run db:generate --workspace @mas/db`。
- **Caveats**: 当前默认锁文件落在仓库根下的 `.superpowers/daemon.lock`。源任务卡在 `master` 上是未跟踪文件，所以首个 claim commit 只能在任务分支里新增 `(doing)G1-daemon-v1.md`，无法做真正的 `git mv` 轨迹。
- **Design deltas**: `daemon_state` 除任务要求的最小字段外，还补了 `stoppedAt` 和 `lastError`，用于对齐 `DESIGN.md` 里 heartbeat / status / 最近错误的可观测语义。
