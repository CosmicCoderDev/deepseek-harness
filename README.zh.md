# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

> [!IMPORTANT]
>
> **`feat/electron-desktop` 分支已经提供原生 macOS 桌面预览版。** 它在独立 Electron 窗口中运行完整 Harness UI，不会打开本地 HTTP/WebSocket 端口。详见[英文桌面指南](apps/desktop/README.md)或[完整中文桌面指南](apps/desktop/README.zh.md)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令会启动 Web UI，默认地址为 `http://127.0.0.1:3080`。详见 [Web UI 指南](docs/user/guide/index.md)。

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

### 桌面应用（macOS Apple 芯片预览版）

桌面应用是同一套 Harness 产品的原生发行方式，不是功能精简版 UI。它保留现有 Agent、会话、工具、插件图、提供方设置和本地模型能力，只将浏览器载体替换为 Electron 边界。

| | Web 版 | 桌面版 |
| --- | --- | --- |
| 用户界面 | 浏览器标签页 | 独立 Electron 窗口 |
| Host 进程 | `dsh web` CLI 进程 | 嵌入 Electron 主进程 |
| RPC 载体 | 回环地址上的 HTTP 和 WebSocket | 上下文隔离的 Electron IPC |
| 监听端口 | 默认 `127.0.0.1:3080` | 无 |
| 安装后是否需要 Node.js | 运行 CLI 时需要 | 已包含在应用内 |
| 当前打包目标 | Node.js 支持的平台 | Apple 芯片 macOS（`arm64`） |

桌面端源码目前位于 Fork 的功能分支。全新检出时请执行：

```sh
git clone https://github.com/CosmicCoderDev/deepseek-harness.git
cd deepseek-harness
git switch feat/electron-desktop
corepack enable
pnpm install
pnpm dist:desktop:mac
```

该命令会构建共享 Host 与 Web UI、生成 Electron 应用、为 Apple 芯片重新构建原生依赖，在 `apps/desktop/dist` 下生成 DMG 和 ZIP，最后使用空的临时 `DSH_HOME` 启动打包后的 Host 与渲染进程。只要静态依赖、peer dependency、配置插件、IPC preload 或渲染 bundle 有一项缺失，构建就会失败，不会留下未经验证的安装包。

安装步骤：

1. 打开 `apps/desktop/dist/DeepSeek Harness-0.1.0-rc.6-arm64.dmg`。
2. 将 **DeepSeek Harness** 拖到 **Applications**；如果出现提示，覆盖旧预览版。
3. 推出磁盘映像，然后从 **Applications** 启动应用。
4. 本地预览版尚未签名；如果 macOS Gatekeeper 首次启动时拦截，请右键应用并选择**打开**。

如需开发调试而不生成安装包，运行 `pnpm desktop`。开发窗口与打包应用使用同一套进程内 Host 和 IPC 载体。

当前限制：只验证了 Apple 芯片 macOS；本地构建尚未签名和公证；没有自动更新；Windows、Linux 和 Intel Mac 安装包属于后续工作。架构、本地模型配置、安全边界、冒烟测试和排错方法请参阅[英文桌面指南](apps/desktop/README.md)或[完整中文桌面指南](apps/desktop/README.zh.md)。

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
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
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
