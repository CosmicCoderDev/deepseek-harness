# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

DeepSeek Harness 原生 Electron 应用。它在 Electron 主进程内启动 Host，通过 `file://` 加载已构建的 Web UI，以私有 `dsh-plugin://` 协议提供客户端插件 bundle，并通过上下文隔离的 IPC Fetch 桥承载单次 RPC 与流式 RPC。应用不会打开 HTTP 或 WebSocket 监听端口，打包后也不依赖外部 Node.js 运行时。

## 当前状态

桌面端目前处于开发者预览阶段。现有打包流程只在 Apple 芯片（`arm64`）macOS 上完成验证，生成未签名、未公证且不含自动更新的应用；Windows、Linux 和 Intel Mac 暂时不是发布目标。

从源码运行需要 Node.js `^22.19.0` 或 `>=24.0.0`，并使用仓库固定的 pnpm 版本。打包应用已经包含自身运行时，不需要另行安装 Node.js。

## 从源码仓库运行

在仓库根目录运行：

```sh
pnpm install
pnpm desktop
```

渲染进程关闭 Node 注入，启用上下文隔离和 Chromium 沙箱，拒绝所有权限请求，采用限制性内容安全策略，并将页面导航限制为本地应用资源。现有客户端插件运行器需要在运行时执行由 Host 提供的插件 bundle，因此策略允许动态脚本求值；三个内置主题启动脚本则使用精确哈希授权，不会开放通用内联脚本执行。对象、表单、任意导航和未列出的资源类别仍被阻止。只有普通 HTTP、HTTPS 和邮件链接可以交给操作系统打开。正常启动使用 Electron 单实例锁；再次打开应用时会恢复现有窗口并将其置于前台，不会针对同一个 `$DSH_HOME` 启动第二个 Host。

## 配置本地模型

桌面端和 Web 端使用同一套 `$DSH_HOME` 配置。打开**设置 → 模型**，选择**添加自定义提供方**，然后填写端点、协议、凭据和至少一个模型。

以本地 Ollama 的 `qwen3-coder:30b` 为例：

| 字段 | 填写值 |
| --- | --- |
| Provider ID | `ollama` |
| 显示名称 | `Ollama` |
| 基础 URL | `http://127.0.0.1:11434/v1` |
| API 协议 | `openai-completions` |
| API Key | 未启用身份校验时填写任意非空占位值 |
| 模型 | `qwen3-coder:30b` |

请先确认 Ollama 正在运行，而且模型已经下载到本机。保存提供方，在输入框的模型选择器中选中该模型，然后创建新会话。配置变更会在下一次请求时生效，无需重启应用。其他提供方、凭据、模型发现和排错方法请参阅[模型配置指南](../../docs/user/guide/providers.md)。

## 构建 macOS 安装包

```sh
pnpm dist:desktop:mac
```

应用 bundle、DMG 和 ZIP 会生成在 `apps/desktop/dist` 下。当前本地构建有意不签名（`identity: null`），因此 macOS Gatekeeper 可能要求首次显式确认打开。若要公开分发，仍需 Apple Developer ID 证书、Hardened Runtime 签名和公证。

安装本地构建：

1. 打开 `DeepSeek Harness-<version>-arm64.dmg`。
2. 将 **DeepSeek Harness** 拖到 **Applications**；如果出现提示，覆盖旧的预览版本。
3. 推出磁盘映像。
4. 首次启动时，如果 Gatekeeper 拦截该未签名构建，请右键 **DeepSeek Harness**、选择**打开**，然后确认 macOS 提示。

打包应用把运行时依赖树保留在真实文件系统中，而不是放进 ASAR。profile loader 会通过软链接维护动态配置插件的 `node_modules` 回退路径，因此这些包目录必须是实体目录。macOS 打包命令最后会使用空的临时 `DSH_HOME` 启动 Host 与渲染进程；任何静态依赖、peer dependency 或 profile 动态依赖缺失都会直接使构建失败。

如需在不重新打包的情况下再次运行安装包冒烟测试：

```sh
pnpm --filter @deepseek-ai/dsh-desktop smoke:packaged:mac
```

测试会使用隔离的临时用户目录，启动完整 Host，加载渲染进程和私有插件 bundle，等待 React 根节点出现，然后退出。因此它不会因为源码仓库中的链接包或已有用户 profile 而错误通过。

## 传输边界

preload 只暴露启动元数据和三个有界载体操作：请求、流订阅与中止。主进程仅接受指向合成地址 `http://dsh.internal` 的 GET/POST 请求，校验请求标识并限制请求体大小，然后直接分派给进程内 Host。客户端 bundle 只允许从 Host 生成的插件清单中读取，绝不通过通用文件系统协议暴露。

## 排错

- **macOS 提示应用无法打开**：本地构建尚未签名，请使用右键 → **打开**。公开分发需要签名和公证。
- **启动时提示缺少 JavaScript 模块**：确认已安装应用的版本与新构建的 DMG 一致。运行 `pnpm dist:desktop:mac` 重新打包；隔离冒烟测试未通过时，该命令不会成功。
- **无法连接本地模型**：确认本地服务正在运行、基础 URL 包含 `/v1`，并且所选模型确实存在。如果端点没有实现 `GET /models`，请手工填写模型。
- **已保存的提供方或模型没有出现在旧对话中**：请在输入框中重新选择模型并创建新会话；已经发送过请求的会话会保留其日志中记录的模型。
