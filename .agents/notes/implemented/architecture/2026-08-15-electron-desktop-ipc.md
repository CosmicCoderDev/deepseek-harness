# Agent Note: Portless Electron desktop carrier and packaged Host runtime

Status: implemented

English | [中文](2026-08-15-electron-desktop-ipc.zh.md)

## Problem

The browser application was complete, and the first Electron proof of concept established window and lifecycle behavior by supervising `dsh web` on a loopback port. That bridge still exposed an HTTP/WebSocket listener, depended on an external Node.js executable, loaded renderer resources from a server origin, and could not become a self-contained macOS application. The production desktop needed to preserve the existing RPC protocol and plugin composition while replacing only the physical carrier.

## Decision

`apps/desktop` is the production Electron assembly. Electron starts the ordinary Web profile Host inside its main process with a desktop patch that disables the Web server, frontend server, Web HMR, and automatic Web directory picker. The patch selects the native directory-picker provider and keeps the rest of the Host and client plugin graph unchanged.

The renderer loads the built Web shell from `file://`. Boot metadata crosses synchronously through the sandboxed preload, while client bundles are served by a privileged private `dsh-plugin://bundle/<id>/client.js` protocol. The protocol resolves only bundle identifiers present in the Host-generated manifest; it is not a general file bridge.

`DesktopApiClient` retains `AbstractApiClient`'s envelope validation, unary correlation, SSE parsing, and reconnect behavior. Its Fetch-shaped physical carrier is an isolated preload API with only `request`, `subscribe`, and `abort`. The main process accepts GET/POST only, requires the synthetic `http://dsh.internal` authority, validates request identifiers and headers, bounds request bodies, and dispatches to `HostConnectionHandle.createLocalFetchHandler`. Streaming responses are relayed as bounded IPC chunk events. Generic connection RPC channels use the same local dispatcher, so no HTTP or WebSocket listener exists.

The preload is a single CommonJS bundle because Electron's sandboxed preload runtime cannot follow arbitrary local imports. Renderer code runs with Node integration disabled, context isolation and Chromium sandboxing enabled, all permission requests denied, external navigation blocked, and only safe HTTP/HTTPS/mail destinations handed to the operating system.

## Packaged runtime closure

The stable CLI `profile-boot` export lets Electron reuse the supported profile loader without invoking a CLI or starting user-layer HMR watchers. Bare configured plugins are resolved at the config-tree base URL before entering Node's internal module loader. This explicit resolution is required because Electron's embedded loader may otherwise replace the caller-provided parent URL and skip the packaged profile's `node_modules` fallback.

Electron Builder packages the Host closure, compiled preload/main process, Web dist, and application icon into `DeepSeek Harness.app`, plus DMG and ZIP artifacts. The runtime tree remains on the physical filesystem instead of inside ASAR because profile boot maintains a symlinked `node_modules` fallback for config-loaded plugins; an ASAR virtual directory cannot be a valid operating-system symlink target. The desktop manifest explicitly carries the required peer-service closure that Electron Builder would otherwise omit. Packaging ends with an isolated-home smoke launch that boots the Host, loads the renderer shell, and waits for its React root, so neither workspace links nor an existing user profile can hide an incomplete artifact. The current configuration deliberately sets signing identity to null for local testing. Public distribution remains a release operation requiring Developer ID signing, hardened runtime, notarization, and an updater policy; these release credentials do not change the runtime architecture.

## Alternatives considered

**Keep the supervised loopback server in the packaged app.** It reused the browser carrier but retained an avoidable local attack surface, port lifecycle, server-origin navigation, and a second runtime process. It also violated the repository's established desktop boundary.

**Create a second desktop RPC protocol.** This would duplicate envelopes, validation, stream parsing, and reconnect semantics. A Fetch-shaped carrier lets the existing abstract client and Host handler remain the single protocol implementation.

**Expose filesystem paths or Node APIs directly to the renderer.** This would make every UI plugin part of the native trust boundary. The private bundle protocol and least-authority preload keep filesystem and Electron capabilities in the main process.

**Bundle all client plugins into one renderer artifact.** This would discard the dynamic Cordis boot graph and make Web and desktop composition drift. Serving only manifest-selected bundles preserves the same plugin identities and ordering on both surfaces.

## Consequences

Development and packaged macOS applications now run the complete existing UI and configured local model without opening a listener or requiring an external Node process. Web mode remains unchanged and continues using HTTP/WebSocket. The desktop carrier adds one platform subclass, one local Host dispatcher, a private bundle protocol, and Electron packaging, while the logical RPC contract remains shared. Focused tests cover internal-authority selection, unary payload carriage, IPC streams, cancellation, request trust, and external-navigation trust; packaged acceptance also starts the Host and renderer from a clean Harness home, while live acceptance checks that neither development nor packaged main processes own a listening TCP socket.
