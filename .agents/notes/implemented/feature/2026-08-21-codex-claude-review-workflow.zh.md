# Agent Note：固定 Codex 开发 → Claude Code 审核工作流

Status: implemented

[English](2026-08-21-codex-claude-review-workflow.md) | 中文

## 问题

桌面预览模式向本地模型暴露了独立的 Codex 与 Claude Code 工具，并依赖模型自行选择和排序。较小的本地模型可能编造工具名、跳过阶段、静默退回本地执行，或在审核失败后继续工作。仅靠提示词无法形成可靠的执行边界。

## 决策

`@deepseek-ai/dsh-tool-workflow` 新增可选的 `reviewToolName` 配置。启用后注册一个固定工具：先启动 provider `codex` 并等待完成，随后才启动 provider `claude-code`。审核者获得原始目标和 Codex 输出，被明确要求不修改文件，并且必须返回 `VERDICT: PASS`、`VERDICT: NEEDS_CHANGES` 或 `VERDICT: BLOCKED`。

桌面 `codex-claude-review` 预设启用该固定工具，并在面向模型的工具目录中禁用两个独立 provider 工具。各阶段错误独立保留；Codex 失败会短路审核。“需修改”“阻塞”以及格式不正确的结论都会停止并等待用户决定，不存在自动修复循环。

## 考虑过的替代方案

- 未采用模型编写的通用工作流，因为一次工作流运行绑定单一 subagent provider，无法安全强制 provider 切换。
- 未采用只依赖 persona 的排序，因为实测本地模型可能忽略或编造工具约定。
- 暂缓自动 Codex 修复循环，因为它可能在没有用户再次确认时反复修改文件。

## 影响

正式工作流现在具有确定性并可测试，但要求已注册 `codex` 与 `claude-code` provider。直接模式和预览模式仍是独立选择。审核结果采取保守策略：缺失结论时按阻塞处理，不会推断为成功。
