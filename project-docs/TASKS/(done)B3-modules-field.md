# B3 — 收尾：agents.modules 字段 + 创建界面的模块选择面板（占位版）

**状态**: pending
**前置依赖**: 无（本身可独立做；但只有在 B6 落地后才会被真正用上）
**预计规模**: small

## 目标

B3（虚拟人管理）的 CRUD + 前端创建/编辑界面其实已经做完了。**唯一还缺的**是 DESIGN §7.2 里写的 `agents.modules` JSON 字段——它是后面 B6（模块化系统基座）和 C/D 内在系统的入口。

本 task 只做**数据层占位**：加字段 + 加 migration + 前端保留一个预留 section。**暂不实现**模块的运行时行为（那是 B6）。

## 涉及文件

- `packages/db/src/schema.ts`（给 agents 表加 `modules: text('modules')`）
- `packages/db/migrations/`（drizzle 生成一条新 migration；不要手工删旧 migration）
- `packages/db/src/repository/agents.ts`（读写时 JSON 序列化 modules）
- `apps/web/src/app/api/agents/route.ts` + `[id]/route.ts`（接口接受 / 返回 modules）
- `apps/web/src/app/page.tsx`（创建/编辑表单里加一个"模块配置（暂未启用）"折叠块，只显示说明文字，不需要交互控件）

## 完成标准

- [x] schema + migration 成功跑通（`data.db` 里 agents 表有 `modules` 列）
- [x] 创建新虚拟人时，不传 modules 默认为 `null`；传了 JSON 能正确存/取
- [x] `GET /api/agents/:id` 响应中包含 `modules` 字段
- [x] 前端创建表单保留占位区域（告诉用户"即将上线"），不破坏现有布局
- [x] 旧数据（现有的 Hazel/Orion/Sage）不会因为 migration 爆掉

## 备注 / 注意事项

- migration 要可回滚。better-sqlite3 不支持 DROP COLUMN 但可以加字段；加完后用 drizzle-kit generate
- **不要**在本 task 里定义 `modules` 的合法 schema（什么 key 允许什么值）。B6 会定义 registry，届时自然就定了——现在就是个透明 JSON
- 前端那个"模块配置"占位区域尽量朴素，不要做很多视觉投入
- 不要改记忆 / 情感 / 性格任何其他表

## Completion Note

- 已在 `agents` 表加入可空 `modules` 字段，并补了 Drizzle migration；repository 现在负责 JSON 序列化/反序列化。
- Agent API 已支持透传 `modules`，首页创建/编辑表单新增了一个静态“模块配置（暂未启用）”占位区。
- 已验证 repository 存取测试通过、`data.db` 里存在 `modules` 列，并补了 `db-init` 的兼容逻辑，确保旧库在未先手动跑 migration 时也不会因缺列直接报错。
