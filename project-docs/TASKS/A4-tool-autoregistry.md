# A4 — 工具自动发现 / 自注册

**状态**: pending
**前置依赖**: 建议在 A1-A3 落地之后再做（有多个工具才能检验注册机制是否值得抽象）
**预计规模**: small

## 目标

以后加新工具，只要把文件扔进 `packages/core/src/tools/` 就能自动生效，不用改任何注册中心或数组。

参考 `reference-project/` 里 hermes-agent 的 `tools/registry.py` 自注册模式（每个工具文件 export 一个 Tool 实例，registry 在模块加载时扫描 import 并收集）。TS 环境里可用显式 barrel + Vite/Next 的 `import.meta.glob`（dev-only）或一个编译期生成的 manifest。

## 涉及文件

- `packages/core/src/tools/index.ts`（重写为自动收集）
- 可能新增：`packages/core/src/tools/registry.ts`
- 调用方（runAgent / apps/web chat route）改成从 registry 读 `getDefaultTools()` 而不是手写数组

## 完成标准

- [ ] 新增一个工具文件，**不改任何其他文件**，重启 dev server 后 LLM 能调用到它
- [ ] 旧的手动数组注册路径可以删除，或保留为"显式覆盖"兜底（二选一，由实现者判断）
- [ ] BashTool + A1-A3 三件都能被 registry 正确收录
- [ ] Observer 面板里工具列表反映 registry 内容

## 备注 / 注意事项

- **不要**引重型依赖做反射。Node/TS 环境有几种可行方式：
  1. 每个工具文件显式 `export const tool: Tool = {...}`，`registry.ts` 用一个手写 barrel（权衡：自动性弱，但是零魔法）
  2. 构建期脚本扫目录生成 `tools.generated.ts`（权衡：需要 npm script hook）
  3. 运行时 `readdirSync` + 动态 import（权衡：在 Next 的 server 区域要小心 RSC 边界）
  优先顺序：方案 3 > 方案 2 > 方案 1。先试方案 3，不行再降级。
- 不要把"工具权限/分类/白名单"也一并做了，那是 Phase 3 的 F3/F4
- 本 task 的价值是"减少加工具的摩擦"，不是"做一个插件系统"
