# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

> [!IMPORTANT]
>
> **`feat/electron-desktop-rc8` 分支提供原生 macOS 桌面预览版。**它在 Electron 窗口中运行完整 Harness UI，不开放本地 HTTP/WebSocket 端口。详见[桌面应用指南](apps/desktop/README.md)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.md)。

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

### 桌面应用（macOS Apple 芯片预览版）

桌面应用是同一套 Harness 产品的原生分发方式，并非单独制作的简化 UI。它保留现有 Agent、会话、工具、插件图、模型提供方设置和本地模型支持，仅将浏览器通信载体替换为 Electron 边界。

| | Web | 桌面版 |
| --- | --- | --- |
| 用户界面 | 浏览器标签页 | 独立 Electron 窗口 |
| Host 进程 | `dsh web` CLI 进程 | 嵌入 Electron 主进程 |
| RPC 载体 | 回环地址上的 HTTP 和 WebSocket | 上下文隔离的 Electron IPC |
| 监听端口 | 默认 `127.0.0.1:3080` | 无 |
| 安装后是否需要 Node.js | 运行 CLI 时需要 | 已包含在应用中 |
| 当前打包目标 | Node.js 支持的平台 | Apple 芯片 macOS（`arm64`） |

从 Fork 的 rc.8 功能分支构建桌面应用：

```sh
git clone https://github.com/CosmicCoderDev/deepseek-harness.git
cd deepseek-harness
git switch feat/electron-desktop-rc8
corepack enable
pnpm install
pnpm dist:desktop:mac
```

该命令会构建共享 Host 和 Web UI、创建 Electron 应用、在 `apps/desktop/dist` 下生成 DMG 和 ZIP，并使用空的临时 `DSH_HOME` 对打包后的 Host 与渲染进程做冒烟测试。安装时打开生成的 arm64 DMG，将 **DeepSeek Harness** 拖入**应用程序**，推出镜像后启动应用。预览版未签名；若 Gatekeeper 阻止首次启动，请右键应用并选择**打开**。

不创建安装包的开发运行方式是 `pnpm desktop`。当前仅验证 Apple 芯片 macOS；签名、公证、自动更新、Windows、Linux 和 Intel macOS 打包尚未实现。架构、安全、本地模型配置、测试及故障排除详见[桌面应用指南](apps/desktop/README.md)。

## 配置模型

打开**设置 → 模型**，可以配置 DeepSeek、内置目录提供方或自定义 OpenAI 兼容端点。例如，本地 Ollama 可填写：

- Provider ID：`ollama`
- 基础 URL：`http://127.0.0.1:11434/v1`
- API 协议：`openai-completions`
- API Key：如果本地端点不校验身份，填写任意非空占位值
- 模型：`qwen3-coder:30b`

保存提供方，在输入框的模型选择器中选中该模型，然后创建新会话。Web 与桌面应用共用同一套 `$DSH_HOME` 设置和凭据。提供方发现、凭据、视觉模型和排错方法请参阅[模型配置指南](docs/user/guide/providers.md)。

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
