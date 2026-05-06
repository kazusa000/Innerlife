# 开源前准备清单

这个文件用来记录项目公开前需要完成的事情。我们后续可以按章节逐步处理。

## 1. 项目定位

- [ ] 明确公开定位：这是实验性的 AI companion / virtual persona runtime，不是生产级软件。
- [ ] 写一句简短 tagline。
- [ ] 说明项目主要价值：记忆架构、人格运行时、Observer、Daemon、模块化 AgentSystem。
- [ ] 说明项目不承诺什么：不承诺生产部署稳定性、不承诺 API 长期兼容、不承诺多用户托管服务。
- [ ] 确定第一次公开版本名，例如 `v0.1 experimental`。

## 2. 仓库清理

- [x] 保证本地运行数据不会进入仓库。
- [x] 确认 `.env`、`data.db`、`memory.db`、`storage/`、`.next/`、`.venv/`、`playwright-report/`、`test-results/` 都被 `.gitignore` 忽略。
- [x] 发布前删掉残留的个人本地文件。（当前保留的 `.env`、`apps/web/.env`、`node_modules/` 是本机运行文件，已被忽略，不会进入仓库。）
- [ ] 检查没有真实 API key、本机路径、私人笔记、私人聊天记录被 git 跟踪。（未完成：还需要单独清理 tracked docs / tests 里的本机路径和私人化样例。）
- [ ] 如果后续添加截图或 demo 数据，先检查里面没有私人内容。

## 3. README

- [ ] 重写一个面向公开用户的 `README.md`。
- [ ] 用一段话讲清楚项目是什么。
- [ ] 写当前功能列表。
- [ ] 写架构概览：chat runtime、memory、emotion、relationship、daemon、observer。
- [ ] 写快速启动命令。
- [ ] 写环境变量配置说明。
- [ ] 写当前限制和不稳定点。
- [ ] 如果要放截图或架构图，先确认截图里没有私人数据。

## 4. 环境配置

- [ ] 检查 `.env.example` 是否真实可用。
- [ ] 说明必需 API key 和可选 provider 配置。
- [ ] 说明 Anthropic-compatible endpoint 怎么配置。
- [ ] 说明 OpenRouter 怎么配置。
- [ ] 说明 app database 和 memory database 默认会生成在哪里。
- [ ] 确认 fresh clone 不依赖你本机隐藏状态。

## 5. License

- [ ] 添加根目录 `LICENSE` 文件。
- [ ] 确认是否使用当前文档里提到的 MIT。
- [ ] 粗略检查主要依赖许可证是否有明显冲突。
- [ ] 在 `README.md` 中写明 license。

## 6. 启动与开发体验

- [ ] 验证 fresh install：

```bash
npm install
cp .env.example .env
npm run dev --workspace @mas/web
```

- [ ] 验证 daemon 启动：

```bash
npm run daemon:start
```

- [ ] 验证空数据库首次启动能自动建表。
- [ ] 给常见启动失败写 troubleshooting。
- [ ] 决定是否添加根目录快捷脚本，例如 `npm run dev:web`。

## 7. 测试与验证

- [ ] 文档化主要 typecheck 命令。
- [ ] 文档化重点测试命令。
- [ ] 确认测试不依赖私人本地数据。
- [ ] 确认测试使用临时数据库，而不是污染真实本地数据。
- [ ] 决定 Playwright 测试是否进入公开 quick check。

## 8. 文档清理

- [ ] 决定哪些内部文档适合公开保留。
- [ ] 如果 `project-docs/DESIGN.md` 足够干净，可以作为架构参考保留。
- [ ] `project-docs/STATUS.md` 只保留当前真实能力，不写过期计划。
- [ ] 决定 `project-docs/TASKS/done/` 是保留、归档，还是从公开文档入口弱化。
- [ ] 清理已删除系统的过期引用，尤其是 Turing test 相关设计。
- [ ] 清理过于私人化的计划记录。

## 9. 隐私与数据安全

- [ ] 确认没有被跟踪的文件包含真实私人聊天。
- [ ] demo agent 必须使用虚构数据。
- [ ] Observer 示例不能暴露私人 prompt 或 API response。
- [ ] 文档里明确提醒：本地数据库可能包含私人聊天和记忆。
- [ ] 文档化如何安全重置本地数据。

## 10. 安全说明

- [ ] 明确说明工具可能调用外部 API，也可能在配置允许时执行本地动作。
- [ ] 说明 `web_fetch` 默认关闭。
- [ ] 说明工具暴露是按 persona 配置的。
- [ ] 说明 provider API key 如何保存在本地。
- [ ] 添加实验性本地使用的安全免责声明。

## 11. 架构图

- [ ] 添加一张 runtime flow 图。
- [ ] 添加一张 memory pipeline 图：context -> STM -> entity graph + episodic memory。
- [ ] 添加一张 recall 图：STM 前置检索 + long-term memory tool 召回。
- [ ] 添加一张 daemon 职责图。
- [ ] 添加一张 observer 数据流图。

## 12. 公开 Demo 数据

- [ ] 创建一个虚构 demo persona。
- [ ] 如果需要示例记忆，使用安全的虚构记忆。
- [ ] 不要提交真实 SQLite database。
- [ ] 如果 demo seed 有价值，提供脚本，不直接提交数据库文件。

## 13. 发布前检查

- [ ] 跑最终 typecheck。
- [ ] 跑重点测试。
- [ ] 用干净本地数据库启动 web。
- [ ] 用干净本地数据库启动 daemon。
- [ ] 确认中英文切换可用。
- [ ] 确认 Turing 路由已经不存在。
- [ ] 确认 `.gitignore` 能挡住所有本地运行文件。
- [ ] 最终 review 后创建公开 release 分支或 tag。

## 14. 推荐开场描述

这个项目是一个实验性的本地 virtual persona runtime。它包含长期情景记忆、实体图召回、情绪状态、关系状态、工具调用、后台 daemon 记忆沉淀，以及用于观察内部 LLM 调用的 observer。它更适合作为长期记忆和虚拟人格系统的研究/开发原型，而不是生产级应用。
