# 模块管理系统重构 Rollout — 设计文档

日期：2026-04-20
状态：设计完成，待分 task 落地

---

## 1. 目标

把当前堆在 `Edit persona` 里的模块配置拆成“统一入口 + 按 scheme 分发的管理子系统”。

这次 rollout 覆盖 4 个模块：

- `personality`
- `emotion`
- `relationship`
- `memory`

目标结果：

- 每个模块都有固定管理入口
- 入口只负责读取当前 `scheme` 并分发
- 不同 `scheme` 的管理界面完全独立，不共享同一套配置 UI
- 各模块自己的 LLM 模型设置只出现在对应管理页里，不再放在 `Edit persona`
- `Edit persona` 最终只负责为各模块选择 `scheme`
- 价值观系统从当前 UI/runtime 收口中移除

---

## 2. 已确认的设计约束

### 2.1 统一入口，独立子系统

每个模块只有一个稳定入口：

- `/agent/[id]/personality`
- `/agent/[id]/emotion`
- `/agent/[id]/relationships`
- `/agent/[id]/memory`

入口层只做三件事：

1. 读取 `agents.modules.<module>.scheme`
2. 判断当前是否已启用
3. 把页面分发到对应 scheme 的管理子系统，或显示 `noop / unconfigured / 未实现` 状态

入口层不是通用配置页，不抽象跨 scheme 的共享 CRUD。

### 2.2 scheme 互相独立

不同 scheme 的数据和操作语义完全独立：

- 不共享同一套字段表单
- 不共享同一套列表/图谱/管理逻辑
- 只共享入口层和路由约定

### 2.3 模型设置下沉到模块管理页

凡是模块内部需要独立 LLM 的地方，模型设置都放到对应模块管理页里：

- `emotion.analysisModel` → `/agent/[id]/emotion`
- `relationship.analysisModel` → `/agent/[id]/relationships`
- `memory.summarizeModel`（现语义已覆盖 retrieve/summarize/consolidate）→ `/agent/[id]/memory`

`personality:big-five` 当前没有独立模型设置，因此不新增模型配置。

### 2.4 Edit Persona 最终只负责选 scheme

`Edit persona` 在最终收口后只保留：

- `provider`
- 主聊天 `model`
- 每个模块的 `scheme` 选择

不再直接承载模块内部参数。

---

## 3. 这批 rollout 的任务边界

### C1a — personality 管理入口（big-five）

只做：

- `/agent/[id]/personality`
- `/api/agents/:id/personality`
- `/api/agents/:id/personality/big-five`
- `big-five` 管理 UI

不做：

- `Edit persona` 收口
- 其他 personality scheme

### C2a — emotion 管理入口（dimensional）

只做：

- `/agent/[id]/emotion`
- `/api/agents/:id/emotion`
- `/api/agents/:id/emotion/dimensional`
- baseline / decay / analysisModel 的编辑

不做：

- `Edit persona` 收口
- 其他 emotion scheme

### C3a — relationship 管理入口（multi-dim）

只做：

- `/agent/[id]/relationships`
- `/api/agents/:id/relationships`
- `/api/agents/:id/relationships/multi-dim`
- baseline / decay / analysisModel 的编辑
- 当前 relationship state 和近期 history 展示

不做：

- 图谱扩张
- 其他 relationship scheme

### B3a — persona editor 收口与 values 移除

只做：

- `Edit persona` 收成 scheme-only
- 把 memory 模型设置迁入 `/agent/[id]/memory`
- 为四个模块挂出管理入口
- 移除 values 的 UI/runtime 接线

---

## 4. 路由与 API 约定

每个模块都遵守同一层级模式：

### 页面

```txt
/agent/[id]/<module>                       统一入口
/agent/[id]/<module> -> 当前 scheme 子系统
```

### API

```txt
GET   /api/agents/:id/<module>             入口元信息
GET   /api/agents/:id/<module>/<scheme>    当前 scheme 详情
PATCH /api/agents/:id/<module>/<scheme>    更新当前 scheme 配置
```

入口元信息统一返回：

```json
{
  "agentId": "string",
  "scheme": "string | null",
  "supportedSchemes": ["string"],
  "configured": true
}
```

---

## 5. UI 复用策略

`memory` 已经有完整的“入口壳层 + scheme 映射 + 状态页”模式，这一批新管理页直接复用同一种结构：

- `page.tsx` 只解析 `agentId`
- `ManagerShell` 拉入口元信息
- `scheme -> Component` 做分发
- `noop / unconfigured / unsupported` 统一走状态卡

这样做的目的不是追求抽象复用，而是保持四个模块入口的交互一致，减少后续维护分叉。

---

## 6. 数据更新原则

各模块管理 API 只能最小化更新 `agents.modules` 里的对应模块片段：

- `PATCH personality/big-five` 只改 `modules.personality`
- `PATCH emotion/dimensional` 只改 `modules.emotion`
- `PATCH relationship/multi-dim` 只改 `modules.relationship`
- `PATCH memory/sqlite` 只改 `modules.memory`

不得污染其他模块配置。

因此需要把“读取/合并/写回单模块配置”的逻辑抽成稳定 helper，避免四套页面各自手搓 JSON merge。

---

## 7. values 移除策略

`values` 不是这一批管理页的一部分，而是收口时直接移除：

- 从 `Edit persona` UI 中删除
- 从 `persona-modules` 构建逻辑中删除
- 从 runtime 系统注册和 prompt 注入链路中删除
- 从 Observer 主 prompt fragment 锚点里删掉对应显示

这一步放到 `B3a`，避免和前三张管理页同时抢热文件。

---

## 8. 风险与控制

### 8.1 热文件冲突

高风险热文件：

- `apps/web/src/app/page.tsx`
- `apps/web/src/app/persona-modules.ts`
- `packages/systems/src/registry.ts`
- `packages/core/src/agent/runner.ts`

控制方式：

- `C1a/C2a/C3a` 不碰 `page.tsx`
- `values` 删除延后到 `B3a`
- 先增管理页，再统一收口旧入口

### 8.2 modules JSON 回写互相覆盖

如果每个管理 API 都整块覆盖 `modules`，很容易丢别的模块配置。

控制方式：

- 所有 PATCH 都走“读现有 → 局部 merge → 写回”
- 路由测试必须覆盖“只改本模块，不污染其他模块”

### 8.3 设计漂移

如果在实现中发现某个模块需要例外规则，先改这份 rollout 设计，再继续扩张，不允许无文档地偏离“统一入口 + 独立子系统”的总原则。

