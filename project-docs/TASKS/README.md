# TASKS

这个目录放**可分发给执行 agent 的任务卡**。规则：

- 文件名格式：`<ID>-<短标题>.md`，例如 `B4-interrupt.md`
- 完成 → 由 Coordinator 验收 → 通过后移动到 `done/`
- 任务 ID 与 `../DESIGN.md §11 分阶段路线图` 中的编号对齐（A1 / B4 / C2 ...）
- 没法直接对齐时，用 `X<n>` 作为临时 ID

## 任务卡模板

每个任务文件至少包含以下字段：

```markdown
# <ID> — <任务标题>

**状态**: pending | in-progress | in-review | done
**前置依赖**: <列出阻塞该任务的其他 ID，或"无"
**预计规模**: small | medium | large

## 目标
一句话说清楚这件事为什么要做，做完能带来什么能力。

## 涉及文件
- `packages/.../xxx.ts`（新建）
- `apps/web/src/app/.../yyy.tsx`（修改）
…

## 完成标准
- [ ] 可验证的结果 1
- [ ] 可验证的结果 2
…

## 备注 / 注意事项
对执行 agent 的提示：现有代码的约定、坑、参考文件等。
```

## 当前批次

见本目录下所有非 `done/` 文件。由 Coordinator 负责：

1. 根据 DESIGN.md 拆分
2. 验收 agent 产出
3. 通过后 `mv <task>.md done/`
4. 更新 `../STATUS.md`
5. 如设计变更，更新 `../DESIGN.md`
