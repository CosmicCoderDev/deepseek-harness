# Agent Note: Electron desktop proof of concept over a supervised loopback carrier

Status: implemented

English | [中文](2026-08-15-electron-desktop-poc.zh.md)

## Problem

The repository has a complete browser GUI and reserves Electron IPC as its desktop transport, but it had no runnable desktop application. Implementing IPC, local asset boot-manifest composition, packaging, and signing as one change would make window lifecycle and transport correctness inseparable and provide no early executable proof that the existing UI works inside the desktop security model.

## Decision

`apps/desktop` is a development-only Electron proof of concept. `pnpm desktop` builds the existing Host and Web artifacts, compiles the desktop main process, starts the built `dsh web` CLI on an OS-assigned loopback port, and shows the window only after the CLI emits its readiness line. The desktop process owns the child lifecycle and sends a bounded graceful shutdown when the app exits.

The renderer keeps `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`; denies permission requests; prevents navigation away from the owned backend origin; and hands only HTTP, HTTPS, and mail links to the operating system. The parsed readiness URL must be unauthenticated loopback HTTP, so a compromised or malformed child line cannot redirect the privileged shell to a remote origin.

## Temporary transport boundary

The loopback HTTP/WebSocket carrier is an isolated development bridge, not the production Electron architecture. The launcher requires a compatible `node` executable from `PATH` (or `DSH_NODE_EXECUTABLE`) and is neither packaged nor signed. The existing [GUI layering decision](2026-07-19-gui-layering-and-rpc-protocol.md) still owns the destination: built assets load locally and an Electron IPC carrier replaces Web HTTP/WebSocket, eliminating both the listening port and the external Node-runtime dependency.

## Alternatives considered

**Implement IPC and packaging before creating a window.** This preserves the final carrier from the first commit but couples boot-manifest delivery, plugin-bundle execution, unary calls, two streaming channels, runtime embedding, signing, and window lifecycle into one untestable milestone. The POC isolates lifecycle and security behavior while leaving the carrier replacement explicit.

**Load an already running fixed URL.** This is shorter but gives the desktop app no ownership of readiness, configuration, port collisions, crashes, or shutdown and can silently attach to the wrong process. The supervised child uses an OS-assigned port and a validated readiness signal instead.

**Run Electron itself with `ELECTRON_RUN_AS_NODE`.** This removes the development dependency on `node`, but Electron's Node mode does not preserve the checkout's pnpm plugin-resolution environment; the Loader cannot resolve profile plugins from its dynamic import site. The POC therefore uses the supported checkout runtime and leaves runtime embedding to the packaging phase.

## Consequences

The macOS checkout now has a runnable desktop surface that exercises the actual boot manifest, plugin bundles, configured local model, API handshake, and native window lifecycle. It is intentionally not a distributable application: production work still includes the IPC carrier, local asset and plugin-bundle loading, packaged runtime closure, application identity and icon, signing/notarization, updater policy, and platform acceptance. Unit coverage pins URL and external-navigation trust boundaries; the ordinary full build plus a live `host.describe` call pins the assembled proof of concept.
