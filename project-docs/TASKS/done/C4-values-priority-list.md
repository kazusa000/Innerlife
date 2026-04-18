# C4 — Values（priority-list 方案）

**状态**: pending
**前置依赖**: B6（模块化系统基座，已完成）
**预计规模**: small

## 目标

给虚拟人一组**按优先级排序的价值观**，`beforeLLM` 阶段注入到 system prompt，让它在冲突场景下的选择有方向（例：同时被要求"快"和"准"，按价值观排序倾向哪个）。

这是 `values` 系统类型的 `priority-list` 方案，登记到 B6 的 `systemRegistry`。参数走 `agents.modules.values.priorities` JSON 数组，**不加新表/新列**。

## 涉及文件

- `packages/systems/src/values/priority-list.ts`（新建，实现 `AgentSystem` 接口）
- `packages/systems/src/values/index.ts`（新建，barrel 导出）
- `packages/systems/src/registry.ts`（修改，加 `values.priority-list` 一行；保留 `values.noop`）
- `apps/web/src/app/<agent 编辑/创建表单>.tsx`（修改，增加价值观编辑区；如果 C1 已经扩了这个文件，按字母序插在性格之后即可，减少潜在冲突）

不要碰：`runner.ts` / `chat/route.ts`

## `modules.values` JSON 约定

```jsonc
{
  "values": {
    "scheme": "priority-list",
    "priorities": [
      "诚实优于被喜欢",
      "简洁优于全面",
      "承认不知道优于编造"
    ]
  }
}
```

数组为空 / 字段缺失 → 不注入任何价值观片段。

## 完成标准

- [x] `packages/systems/src/values/priority-list.ts` 实现 `AgentSystem`：`beforeLLM` 把 `priorities` 渲染成 "Values (in priority order): 1. ... 2. ..." 段落写入 `ctx.promptFragments`，`priority: 50`（见 DESIGN §10.10）
- [x] `registry.ts` 支持字符串 `priority-list` 动态实例化；`values.noop` 保留
- [x] 创建/编辑虚拟人表单加 **价值观** 分区：一个可增删、可拖拽排序的字符串列表（拖拽能力若太费事可退化为"上移/下移"按钮）；提交时写入 `modules.values`
- [x] 单测：给定 `["A", "B", "C"]`，fragment 输出包含 "1. A" / "2. B" / "3. C" 顺序正确；空数组产出空 fragment（或不注入）
- [x] 在一个 "价值观冲突提问"（如"帮我写篇夸夸文，哪怕不真实"）上，"诚实优于被喜欢" 排第一的 agent vs. 完全空价值观的 agent，回答观感有区分（主观验证即可，不做严格断言）
- [x] `npm run typecheck` / `npm test --workspace @mas/systems` 全过
- [x] 关闭（`scheme: "noop"` 或缺字段）时行为等同 noop

## 备注 / 注意事项

- 这个 task 故意做得**极简**，为了和 C1 并行不抢活。UI 不要搞拖拽动画，按钮式增删 + 上移/下移就够
- **不要**实现价值观冲突检测、运行时打分、emotion 联动——那是后续 task / Phase 3
- **先读** `packages/systems/src/noop.ts` 和 `registry.ts`，按它的模板扩；不确定接口就以落地代码为准
- 如果 C1 已经并行落地并在表单文件里开了"模块配置"分区，你的价值观 section 放在它**下方**（字母序 p < v）；如果 C1 还没落，你负责开分区骨架；两边都靠 git 的三向合并自动处理
- DESIGN §4.4 / §10.10 为权威；实现与 DESIGN 有出入走 Completion Note

## Completion Note

- **Changes**: 新增 `values:priority-list` 系统与 `values.noop` 保持兼容，registry 现可把模块配置透传给具体 system；首页创建/编辑 persona 表单新增价值观列表编辑区，支持增删和上移/下移并写入 `modules.values`
- **Verified**: `npm test --workspace @mas/systems`；`npm run typecheck --workspace @mas/systems`；`npx tsc --noEmit -p apps/web/tsconfig.json`；`npm run build --workspace @mas/web`；另用真实 Anthropic 调用对比同一冲突提示词，空价值观版本基本照写夸张介绍，而 `诚实优于被喜欢` 版本会先拒绝不真实表述并给出可信改写
- **Caveats**: UI 只做了按钮式重排，没有实现拖拽；未补浏览器级交互测试
- **Design deltas** (if any): 无
