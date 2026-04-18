# C1 — Personality（big-five 方案）

**状态**: done
**前置依赖**: B6（模块化系统基座，已完成）
**预计规模**: medium

## 目标

把虚拟人"有没有性格"这件事从 placeholder 变成真的：用 Big Five 五维 + 说话风格 + 背景故事，在 `beforeLLM` 阶段注入到 system prompt。同样的问题，不同性格的虚拟人回答风格会不同。

这是 `personality` 系统类型的 `big-five` 方案，登记到 B6 的 `systemRegistry`。参数**不加新表/新列**，全部塞进 `agents.modules.personality` 的 JSON（B3 已经有 `modules` JSON 字段）。

## 涉及文件

- `packages/systems/src/personality/big-five.ts`（新建，实现 `AgentSystem` 接口）
- `packages/systems/src/personality/index.ts`（新建，barrel 导出）
- `packages/systems/src/registry.ts`（修改，加 `personality.big-five` 一行；保留 `personality.noop` 兜底）
- `packages/systems/src/index.ts`（如果需要对外 re-export 新 system，修改；尽量不改）
- `apps/web/src/app/<agent 编辑/创建表单所在文件>.tsx`（修改，增加性格编辑区）
- `apps/web/src/app/api/agents/[id]/route.ts`（如已接 `modules` 字段则无需改动；若没通 JSON 直通，补一下 PATCH）

不要碰：`packages/core/src/agent/runner.ts`、`apps/web/src/app/api/chat/route.ts`（`createSystems(agent?.modules)` 已经接好，big-five 走 `modules.personality` 子 key 即可）

## `modules.personality` JSON 约定

```jsonc
{
  "personality": {
    "scheme": "big-five",          // registry 识别用
    "big5": {                      // 0..1 归一化
      "openness": 0.7,
      "conscientiousness": 0.6,
      "extraversion": 0.4,
      "agreeableness": 0.8,
      "neuroticism": 0.3
    },
    "speechStyle": "简洁、口语化、偶尔自嘲",
    "background": "一位 30 岁的前端工程师，喜欢解构事物的第一性原理…"
  }
}
```

任一字段缺失 → 用合理默认（五维 0.5 / 空 speechStyle / 空 background）。

## 完成标准

- [x] `packages/systems/src/personality/big-five.ts` 实现 `AgentSystem`：`beforeLLM` 里把性格描述（五维语言化 + 说话风格 + 背景）写入 `ctx.promptFragments`，`priority: 10`（见 DESIGN §10.10）
- [x] `registry.ts` 能从字符串 `big-five` 动态实例化，参数从 `modules.personality` 读取
- [x] `personality.noop` 保留（兜底空实现，`modules.personality` 缺失或 `scheme: "noop"` 时使用）
- [x] 创建/编辑虚拟人的表单里有 **性格** 分区：五条 Big Five 滑块（0..1，步长 0.05）+ "说话风格" 单行输入 + "背景故事" 多行输入；提交时写入 `modules.personality`
- [x] 同一问题对两个性格差异大的虚拟人（例：高开放性+低神经质 vs 低开放性+高神经质），回答风格观感不同；Observer 面板里 `systemPrompt` 能看到性格段
- [x] 至少一条单测：big-five 对给定 fixture 参数，产出的 promptFragment 内容稳定可断言（不要断言精确措辞，断言关键字如 "openness" 或中文等价即可）
- [x] `npm run typecheck --workspace @mas/core` / `@mas/systems` / `@mas/web` 全过；`npm test --workspace @mas/systems` 新增测试过
- [x] 关闭性格（`modules.personality.scheme = "noop"` 或字段缺失）时行为与现在一致，Observer 里 `systemPrompt` 不含性格段

## 备注 / 注意事项

- **五维 → 自然语言**不要搞花活，简单映射即可（>0.7 "非常…"，0.4-0.7 "偏…"，<0.4 "不太…"）。以后想升级成更好的 prompt 工程再说。
- **说话风格 & 背景** 直接按原文拼进去；不要 LLM 再加工。
- **Big Five 滑块 UI**：不用大改设计系统，复用现有组件，新 section 放在创建/编辑表单已有的"模块配置"占位区里；Dark Cinema 风格一致（indigo 激活态）
- **不要做**：情感 / 价值观 / 记忆（各自独立 task C2/C4/D1）
- **先读** `packages/systems/src/noop.ts` 看 `AgentSystem` 接口落地形状，别凭 DESIGN 想象（以落地代码为准）
- **先读** `packages/systems/src/registry.ts` 看怎么注册新 scheme；`debug:hello-world` 是现成模板
- 参数读取：`beforeTurn` 时从 `ctx.agentConfig.modules?.personality` 拿（如果接口暴露的话）；否则在 system 实例化时（registry 工厂）接收参数存实例字段。按 B6 落地实际选
- DESIGN.md §4.4.3 / §10.10 为权威参考；实现与 DESIGN 有出入，走 Completion Note 记录，别静默改 DESIGN

## Completion Note

- **Changes**: 实现 `personality:big-five` 系统与 registry 配置，基于 `modules.personality` 生成 priority 10 的 prompt fragment；首页 persona 表单新增性格开关、五条 Big Five 滑块、说话风格和背景故事输入，并写回 `modules.personality`。
- **Verified**: `npm run typecheck --workspace @mas/core`；`npm run typecheck --workspace @mas/systems`；`npm run typecheck --workspace @mas/web`；`npm test --workspace @mas/core`；`npm test --workspace @mas/systems`；`npm run build --workspace @mas/web`。
- **Caveats**: 没有手动跑一遍真实 Anthropic/Observer UI 交互；用 `@mas/systems` 测试验证了 prompt fragment 内容，用 `@mas/core` 测试验证了 big-five 会进入最终 `systemPrompt`，`noop` 不会进入。
- **Design deltas** (if any): 在表单里额外加了一个显式启用/关闭开关；关闭时写入 `modules.personality = { scheme: 'noop' }`，避免编辑已有 agent 时因默认值把性格系统意外打开。
