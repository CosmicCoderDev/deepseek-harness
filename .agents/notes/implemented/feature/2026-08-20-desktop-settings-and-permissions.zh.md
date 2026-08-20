# Agent Note：桌面设置与子代理权限

Status: implemented

[English](2026-08-20-desktop-settings-and-permissions.md) | 中文

## Problem

桌面应用此前通过临时对话框提供代理控制，而 Codex 与 Claude Code 的权限行为固定在配置中。用户无法在同一处查看 provider 就绪状态与网络情况、选择适合任务的授权档位，也无法在授予无限制访问前理解安全边界。打包版本同样缺少针对设置界面及其 IPC 边界的自动验证。

## Decision

桌面壳层持有一个由安装包静态资源加载的沙箱化本地设置页。收窄后的 preload bridge 只公开经过校验的设置读写、无凭据连通性测试、复制诊断和打开日志目录。该页面整合 provider 状态、代理配置、权限选择与诊断操作，同时不向其渲染器授予 Node 访问能力。

三个产品级权限档位映射到 provider 原生模式：只读分析映射为 Codex `never` 和 Claude Code `plan`；项目开发映射为 Codex `approve-for-me` 和 Claude Code `acceptEdits`；完全访问映射为 Codex `dangerously-bypass-approvals-and-sandbox` 和 Claude Code `bypassPermissions`。除非调用方提供明确的二次确认，否则主进程 IPC 边界会拒绝完全访问。设置保存在带版本号、经过校验、以原子替换写入的私有文件中；旧版仅代理偏好会在首次读取时迁移。

安装包冒烟测试会打开真实设置资源、验证控件、证明未确认的完全访问写入会被拒绝，并通过 IPC 往返保存安全设置。ASAR 继续关闭：两轮打包试验都能启动 Host，但会破坏 `@deepseek-ai/dsh-client-modules/client.js` 的 parser preload。只有在自定义协议 bundle 路径与 preload 顺序具备专门的安装包回归覆盖后，才允许重新启用。

Provider 登录操作使用封闭的 IPC 枚举。主进程自行推导安装包内可执行文件路径，并在终端中打开相应的官方登录命令；渲染器输入只能选择 Codex 或 Claude Code，不能提供 shell 文本或路径。单独的显式真实冒烟脚本使用只读／无工具调用，把未认证产品报告为 `SKIP`，并要求每个已认证产品返回固定标记。

产品状态检查由主进程中带缓存且不可重入的服务持有：显式并发刷新会合并，最后一次成功快照保持可读，完成后的变化会通知设置页渲染器。已经存在但无效的设置会先按时间戳保留为损坏文件，再由安全默认值替换。权限变化会把 Host 标记为需要重启；主进程在仍有受跟踪请求时拒绝重启，否则原地重建 Host，并在启动失败时尝试持久化回退到只读分析。

## Alternatives considered

**继续增加原生消息框。** 这可以减少新增 UI 代码，但 Electron 消息框无法提供统一的可编辑表单，并且此前已经迫使手动代理地址通过剪贴板输入。

**直接暴露 Codex 与 Claude 的原始权限字符串。** 这对专家更灵活，但容易误配，也无法清晰表达跨 provider 的共同安全含义。固定产品档位可以保持映射规模小且便于评审。

**启用 ASAR 并大范围解包依赖。** 已经分别测试选择性解包与完整解包 `node_modules`，两者都未恢复 parser preload，因此保留 ASAR 会明知故犯地交付渲染器启动失败。

## Consequences

普通用户无需手动构造终端命令即可查看和配置桌面网络与子代理权限。主进程而非页面 JavaScript 继续承担校验、登录命令选择与无限制访问确认的安全边界。现有代理偏好迁移时不会删除旧文件。权限变更会持久化并用于后续 provider 启动。ASAR 关闭期间安装包体积与文件数量较高，但已知可用的 preload 路径得以保留，重新评估 ASAR 的条件也已明确。
