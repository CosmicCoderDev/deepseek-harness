# Agent Note: 通过受监管回环载体实现 Electron 桌面验证版

Status: implemented

[English](2026-08-15-electron-desktop-poc.md) | 中文

## 问题

仓库已有完整的浏览器 GUI，并为桌面传输预留了 Electron IPC，但没有可运行的桌面应用。如果在一次变更中同时实现 IPC、本地资源启动 manifest（元数据清单）组合、打包和签名，窗口生命周期与传输正确性将无法分开验证，也不能尽早用可执行产物证明现有 UI 能在桌面安全模型中工作。

## 决策

`apps/desktop` 是仅供开发使用的 Electron 验证版。`pnpm desktop` 构建现有 Host 和 Web 产物、编译桌面主进程、在操作系统分配的回环端口启动已构建的 `dsh web` CLI（命令行界面），并且只在 CLI 输出就绪行后显示窗口。桌面进程拥有子进程生命周期，并在应用退出时发起有界的优雅关闭。

渲染进程保持 `nodeIntegration: false`、`contextIsolation: true` 和 `sandbox: true`，拒绝权限请求，阻止页面离开自己持有的后端源，并且只将 HTTP、HTTPS 和邮件链接交给操作系统。解析出的就绪 URL 必须是没有身份信息的回环 HTTP 地址，因此被攻陷或格式错误的子进程输出不能把高权限桌面外壳重定向到远程源。

## 临时传输边界

回环 HTTP/WebSocket 载体是隔离的开发桥接，并非正式 Electron 架构。启动器需要 `PATH` 中存在兼容的 `node` 可执行文件，也可以通过 `DSH_NODE_EXECUTABLE` 指定；它尚未打包或签名。现有 [GUI 分层决策](2026-07-19-gui-layering-and-rpc-protocol.md)仍然规定最终形态：在本地加载构建产物，由 Electron IPC 载体替代 Web HTTP/WebSocket，从而同时移除监听端口和外部 Node 运行时依赖。

## 考虑过的替代方案

**先实现 IPC 和打包，再创建窗口。** 这能从首次提交起就采用最终载体，但会把启动 manifest 交付、插件 bundle 执行、单次调用、两条流式通道、运行时嵌入、签名和窗口生命周期耦合成一个无法分段验证的里程碑。验证版隔离了生命周期与安全行为，同时明确保留后续载体替换。

**加载一个已经运行的固定 URL。** 这种方式更短，但桌面应用无法负责就绪、配置、端口冲突、崩溃或关闭，还可能悄悄连接到错误进程。受监管子进程使用操作系统分配的端口和经过验证的就绪信号。

**通过 `ELECTRON_RUN_AS_NODE` 让 Electron 自身运行后端。** 这样可以去掉开发阶段对 `node` 的依赖，但 Electron 的 Node 模式不会保留源码仓库的 pnpm 插件解析环境；Loader 无法从动态 import 所在位置解析 profile 插件。因此验证版使用仓库支持的运行时，并将运行时嵌入留给打包阶段。

## 后果

macOS 源码仓库现在具有可运行的桌面表层，能够验证真实启动 manifest、插件 bundle、已配置的本地模型、API 握手和原生窗口生命周期。它有意不作为可分发应用；正式工作仍包括 IPC 载体、本地资源与插件 bundle 加载、打包后的运行时闭包、应用身份和图标、签名与公证、更新策略及各平台验收。单元测试固定 URL 与外部导航的信任边界；常规完整构建和实时 `host.describe` 调用固定组装后的验证版。
