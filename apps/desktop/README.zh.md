# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

DeepSeek Harness 原生 Electron 应用。它在 Electron 主进程内启动 Host，通过私有 `dsh-app://` 协议提供已构建的 Web UI，以 `dsh-plugin://` 提供客户端插件 bundle，并通过上下文隔离的 IPC Fetch 桥承载单次 RPC 与流式 RPC。应用不会打开 HTTP 或 WebSocket 监听端口，打包后也不依赖外部 Node.js 运行时。

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

桌面应用首次启动时会读取 Ollama 的本地 `GET /api/tags` 列表，但不会发送提示词、下载模型或改写 Harness 配置。如果检测到 Ollama，它会区分“推荐模型已安装”和“Ollama 已运行但缺少推荐模型”两种状态，并给出上表中的精确配置；选择**复制配置**即可粘贴到模型设置表单。若暂时关闭引导，可随时从**帮助 → 本地模型设置**重新打开。

桌面构建默认采用本地模型优先策略，不向模型暴露需要 `DEEPSEEK_API_KEY` 的 `web_search` 工具。这样只配置 Ollama 时，模型不会反复调用一个必然失败的 DeepSeek 搜索。官方基础组合出于 SSRF 安全考虑同样没有启用 `web_fetch`，桌面端不会绕过这一边界。DeepSeek 搜索配置页仍予保留，供未来明确启用联网搜索时使用。

## 诊断日志

桌面主进程会把启动、Host 生命周期、渲染器加载错误和异常状态写入操作系统日志目录。日志在写入磁盘前会遮蔽常见的 API Key、Bearer Token、授权头和密码格式；不会收集环境变量或模型对话内容。

- 选择**帮助 → 打开日志目录**查看原始桌面日志。
- 选择**帮助 → 导出诊断**生成一个文本报告，其中包含应用版本、Electron/Chromium/Node 版本、平台信息和最多 256 KiB 的日志尾部。
- 诊断文件会提示在分享前自行检查；只有用户明确选择保存位置时才会生成，不会自动上传。

选择**帮助 → 代理设置**可在“自动读取系统代理”“手动代理”和“不使用代理”之间切换。手动模式读取剪贴板中的 `http://`、`https://` 或 `socks5://` 地址，保存后立即生效；自动模式每五秒检查一次 macOS 系统代理变化。三种模式都强制让 `localhost`、`127.0.0.1`、`::1` 和 `.local` 地址直连，因此 Ollama 不会误走外部代理。该界面还可以分别测试 OpenAI、Anthropic、DeepSeek 和 Ollama 的可达性，测试不会发送提示词或凭据。

代理设置中的**复制诊断**会把报告直接写入剪贴板。文件导出和剪贴板复制使用同一套脱敏逻辑，会隐藏 API Key、Bearer Token、密码、OAuth 授权码、登录状态参数和邮箱地址。已知的登录、代理、超时、Node 包装器和打包依赖错误会显示可操作的中文原因；未知错误只保留经过脱敏和长度限制的技术摘要。

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

测试会使用隔离的临时用户目录，启动完整 Host，加载渲染进程和私有插件 bundle，等待已注册的根 UI 插槽出现，然后退出。出现可见启动错误时会立即失败，因此错误页面不能造成假阳性。它不会因为源码仓库中的链接包或已有用户 profile 而错误通过。

## 传输边界

preload 只暴露启动元数据和三个有界载体操作：请求、流订阅与中止。主进程仅接受指向合成地址 `http://dsh.internal` 的 GET/POST 请求，校验请求标识并限制请求体大小，然后直接分派给进程内 Host。`dsh-app://app` 只提供打包后的 Web 根目录，并向 `index.html` 注入 Host 生成的 rc.8 启动 facade；`dsh-plugin://` 只读取该清单中的 bundle。两种协议都不是通用文件系统桥。

## 排错

- **macOS 提示应用无法打开**：本地构建尚未签名，请使用右键 → **打开**。公开分发需要签名和公证。
- **启动时提示缺少 JavaScript 模块**：确认已安装应用的版本与新构建的 DMG 一致。运行 `pnpm dist:desktop:mac` 重新打包；隔离冒烟测试未通过时，该命令不会成功。
- **无法连接本地模型**：确认本地服务正在运行、基础 URL 包含 `/v1`，并且所选模型确实存在。如果端点没有实现 `GET /models`，请手工填写模型。
- **已保存的提供方或模型没有出现在旧对话中**：请在输入框中重新选择模型并创建新会话；已经发送过请求的会话会保留其日志中记录的模型。
- **需要提交启动问题**：先选择**帮助 → 导出诊断**，检查报告中没有不希望分享的路径或内容，再随问题说明一并提供。
