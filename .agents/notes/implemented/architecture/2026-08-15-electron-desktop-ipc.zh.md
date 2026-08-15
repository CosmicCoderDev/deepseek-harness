# Agent Note：无端口 Electron 桌面载体与打包 Host 运行时

Status: implemented

[English](2026-08-15-electron-desktop-ipc.md) | 中文

## 问题

浏览器应用已经完整，首个 Electron 验证版也通过监管回环端口上的 `dsh web` 验证了窗口与生命周期行为。但该桥接仍会暴露 HTTP/WebSocket 监听端口，依赖外部 Node.js 可执行文件，从服务器 origin 加载渲染资源，也无法成为自包含的 macOS 应用。正式桌面端需要保留现有 RPC 协议与插件组合，只替换物理载体。

## 决策

`apps/desktop` 是正式 Electron 组装层。Electron 在主进程中启动普通 Web profile 的 Host，并应用桌面补丁，关闭 Web 服务器、前端服务器、Web HMR 和自动 Web 目录选择器。补丁选择原生目录选择器 provider，其余 Host 与客户端插件图保持不变。

渲染进程通过 `file://` 加载已构建的 Web 外壳。启动元数据由沙箱 preload 同步传递；客户端 bundle 则通过高权限私有协议 `dsh-plugin://bundle/<id>/client.js` 提供。该协议只能解析 Host 生成清单中存在的 bundle 标识，不能作为通用文件桥。

`DesktopApiClient` 保留 `AbstractApiClient` 的信封校验、单次调用关联、SSE 解析与重连行为。其 Fetch 形态的物理载体是隔离 preload API，只包含 `request`、`subscribe` 与 `abort`。主进程只接受 GET/POST，强制使用合成地址 `http://dsh.internal`，校验请求标识和请求头，限制请求体大小，再分派给 `HostConnectionHandle.createLocalFetchHandler`。流式响应以有界 IPC 数据块事件中继。通用 connection RPC channel 也使用同一本地分派器，因此不存在 HTTP 或 WebSocket 监听端口。

preload 被构建为单个 CommonJS bundle，因为 Electron 的沙箱 preload 运行时不能跟随任意本地 import。渲染进程关闭 Node 注入，启用上下文隔离和 Chromium 沙箱，由内容安全策略限制文档能力，拒绝所有权限请求，阻止外部导航，并且只把安全的 HTTP、HTTPS 和邮件目标交给操作系统。现有客户端插件运行器会在运行时执行 Host 提供的 bundle，因此策略保留 `unsafe-eval`；Web Host 把启动图携带为不可执行的 Base64 元数据，只有三个内置主题启动脚本变体通过精确脚本哈希获准执行。通用内联脚本、对象、表单和任意导航仍不可用。正常启动会获取 Electron 单实例锁，因此第二次激活只会恢复现有窗口并将其置于前台，不会针对同一个 Harness home 启动另一个 Host。隔离的打包冒烟进程不获取该用户实例锁。

## 打包运行时闭包

稳定的 CLI `profile-boot` 导出让 Electron 可以复用受支持的 profile loader，而不需要调用 CLI，也不会启动用户层 HMR watcher。桌面 Host 通过现有的“宿主拥有裸模块”接口传入自身安装模块 URL，使打包插件从应用安装目录解析，而 profile 内的相对路径条目仍在 profile 配置旁解析。共享 Loader 因而继续保持普通源码与测试语义。

Electron Builder 将 Host 闭包、已编译的 preload/主进程、Web dist 与应用图标打入 `DeepSeek Harness.app`，同时生成 DMG 和 ZIP。运行时依赖树保留在真实文件系统中，而不是放进 ASAR，因为 profile 启动会为配置加载的插件维护带软链接的 `node_modules` 回退路径；ASAR 虚拟目录不能成为有效的操作系统软链接目标。桌面 manifest 显式携带 Electron Builder 原本会遗漏的必需 peer service 闭包。打包最后会在隔离用户目录中进行冒烟启动，依次启动 Host、加载渲染外壳并等待 React 根节点，因此工作区链接和已有用户 profile 都不能掩盖不完整的产物。当前配置为本地测试而明确把签名 identity 设为 null。公开分发仍属于发布操作，需要 Developer ID 签名、Hardened Runtime、公证和更新策略；这些发布凭据不会改变运行时架构。

## 考虑过的替代方案

**在打包应用中保留受监管回环服务器。** 它能复用浏览器载体，但会继续保留不必要的本地攻击面、端口生命周期、服务器源导航与第二个运行时进程，也违背仓库既定桌面边界。

**创建第二套桌面 RPC 协议。** 这会重复信封、校验、流解析和重连语义。Fetch 形态载体让现有抽象客户端与 Host handler 继续作为唯一协议实现。

**向渲染进程直接暴露文件系统路径或 Node API。** 这样会让每个 UI 插件都进入原生信任边界。私有 bundle 协议与最小权限 preload 把文件系统和 Electron 能力留在主进程。

**把所有客户端插件打成一个渲染 bundle。** 这会丢弃动态 Cordis 启动图，并导致 Web 与桌面组合发生漂移。只提供清单选中的 bundle，可以在两种表层上保留相同的插件身份与顺序。

## 后果

开发态和打包后的 macOS 应用都能运行完整现有 UI 与已配置本地模型，无需打开监听端口，也无需外部 Node 进程。Web 模式继续使用 HTTP/WebSocket。桌面载体新增一个平台子类、一个本地 Host 分派器、一个私有 bundle 协议和 Electron 打包层，而逻辑 RPC 约定仍然共享。聚焦测试覆盖内部地址选择、单次请求载体、IPC 流、中止、Fetch 请求校验、插件资源选择和外部导航信任；打包验收还会从空的 Harness home 启动 Host 与渲染进程，实时验收则检查开发态和打包态主进程都没有持有 TCP 监听 socket。

桌面层还拥有两个只涉及本机状态的操作入口。首次启动助手只探测固定回环地址上的 Ollama 标签列表，不发送提示词，也不改写设置；结果用于展示并复制现有模型表单所需的字段。帮助菜单可以再次打开该助手。主进程诊断日志在落盘前遮蔽常见凭据形态，导出报告只包含明确的平台／版本事实与有界日志尾部，由用户选择目标路径，不会自动上传。这样启动失败在没有开发者终端时仍可排查，同时模型配置继续由共享 Settings owner 独占写权限。
