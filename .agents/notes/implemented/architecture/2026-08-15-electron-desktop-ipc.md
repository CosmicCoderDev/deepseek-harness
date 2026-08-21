# Agent Note: Portless Electron desktop carrier and packaged Host runtime

Status: implemented

English | [中文](2026-08-15-electron-desktop-ipc.zh.md)

## Problem

The browser application was complete, and the first Electron proof of concept established window and lifecycle behavior by supervising `dsh web` on a loopback port. That bridge still exposed an HTTP/WebSocket listener, depended on an external Node.js executable, loaded renderer resources from a server origin, and could not become a self-contained macOS application. The production desktop needed to preserve the existing RPC protocol and plugin composition while replacing only the physical carrier.

## Decision

`apps/desktop` is the production Electron assembly. Electron starts the ordinary Web profile Host inside its main process with a desktop patch that disables the Web server, frontend server, Web HMR, and automatic Web directory picker. The patch selects the native directory-picker provider and keeps the rest of the Host and client plugin graph unchanged.

The renderer loads the built Web shell from `dsh-app://app`. That private protocol serves only the packaged Web root and injects the Host-generated boot facade into `index.html`, preserving rc.8's parser-preloaded module-system and runtime bundles. Boot metadata also crosses synchronously through the sandboxed preload, while client bundles are served by `dsh-plugin://bundle/<id>/client.js`. The bundle protocol resolves only identifiers present in the Host-generated manifest; neither protocol is a general file bridge.

`DesktopApiClient` retains `AbstractApiClient`'s envelope validation, unary correlation, SSE parsing, and reconnect behavior. Its Fetch-shaped physical carrier is an isolated preload API with only `request`, `subscribe`, and `abort`. The main process accepts GET/POST only, requires the synthetic `http://dsh.internal` authority, validates request identifiers and headers, bounds request bodies, and dispatches to `HostConnectionHandle.createLocalFetchHandler`. Streaming responses are relayed as bounded IPC chunk events. Generic connection RPC channels use the same local dispatcher, so no HTTP or WebSocket listener exists.

The preload is a single CommonJS bundle because Electron's sandboxed preload runtime cannot follow arbitrary local imports. Renderer code runs with Node integration disabled, context isolation and Chromium sandboxing enabled, a Content Security Policy limits document capabilities, all permission requests are denied, external navigation is blocked, and only safe HTTP/HTTPS/mail destinations are handed to the operating system. The policy retains `unsafe-eval` because the existing client-plugin runner evaluates Host-provided bundles at runtime; the Web Host carries its boot graph as inert Base64 metadata, and only the three exact built-in theme bootstrap variants receive script hashes. General inline scripts, objects, forms, and arbitrary navigation remain unavailable. Normal launches acquire Electron's single-instance lock so a second activation restores and focuses the existing window instead of starting another Host against the same Harness home. The isolated packaged smoke process does not acquire that user-instance lock.

## Packaged runtime closure

The stable CLI `profile-boot` export lets Electron reuse the supported profile loader without invoking a CLI or starting user-layer HMR watchers. The desktop Host supplies its installed module URL through the existing host-owned bare-module base seam, so packaged plugins resolve from the application while relative profile entries still resolve beside the profile configuration. The shared Loader keeps its ordinary source and test semantics.

Electron Builder packages the Host closure, compiled preload/main process, Web dist, and application icon into `DeepSeek Harness.app`, plus DMG and ZIP artifacts. JavaScript application and plugin code stays in ASAR; only executable and native Codex, Claude Code, and terminal dependencies are unpacked. Profile-loaded bare plugins use the installed application URL both for Loader imports and client package metadata, while relative profile rows remain profile-relative. This keeps one Cordis module identity and prevents the writable profile from shadowing client bundles. The desktop manifest explicitly carries the required peer-service closure that Electron Builder would otherwise omit. Packaging ends with an isolated-home smoke launch that boots the Host, loads the renderer shell, and waits for the registered root UI slot; a rendered boot failure rejects immediately instead of satisfying a generic non-empty-root check. Neither workspace links nor an existing user profile can hide an incomplete artifact. The current configuration deliberately sets signing identity to null for local testing. Public distribution signing and notarization remain release operations and do not change the runtime architecture.

## Alternatives considered

**Keep the supervised loopback server in the packaged app.** It reused the browser carrier but retained an avoidable local attack surface, port lifecycle, server-origin navigation, and a second runtime process. It also violated the repository's established desktop boundary.

**Create a second desktop RPC protocol.** This would duplicate envelopes, validation, stream parsing, and reconnect semantics. A Fetch-shaped carrier lets the existing abstract client and Host handler remain the single protocol implementation.

**Expose filesystem paths or Node APIs directly to the renderer.** This would make every UI plugin part of the native trust boundary. The private bundle protocol and least-authority preload keep filesystem and Electron capabilities in the main process.

**Bundle all client plugins into one renderer artifact.** This would discard the dynamic Cordis boot graph and make Web and desktop composition drift. Serving only manifest-selected bundles preserves the same plugin identities and ordering on both surfaces.

## Consequences

Development and packaged macOS applications run the complete existing UI and configured local model without opening a listener or requiring an external Node process. Web mode continues using HTTP/WebSocket. The desktop carrier adds one platform subclass, one local Host dispatcher, a private bundle protocol, and Electron packaging, while the logical RPC contract remains shared. Focused tests cover internal-authority selection, unary payload carriage, IPC streams, cancellation, Fetch request validation, plugin-resource selection, and external-navigation trust; packaged acceptance also starts the Host and renderer from a clean Harness home, while live acceptance checks that neither development nor packaged main processes own a listening TCP socket.

The desktop layer also owns two entry points that touch local-machine state only. The first-launch assistant probes only the Ollama tags list at the fixed loopback address; it sends no prompt and writes no setting. Its result presents and copies the fields consumed by the existing Models form, and the Help menu can reopen it. Main-process diagnostics redact common credential shapes before disk writes. An exported report contains only explicit platform/version facts and a bounded log tail, is written to a user-selected path, and is never uploaded. Startup failures can therefore be investigated without a developer terminal while the shared Settings owner retains exclusive configuration-write authority.

The desktop patch uses a local-model-first tool roster. It retains the DeepSeek search provider and settings surface but disables `tool-web.search`, so a local model without `DEEPSEEK_API_KEY` never sees and repeatedly calls a guaranteed-failure `web_search`. The base composition already disables `web_fetch` at its SSRF boundary, and the desktop patch keeps that state explicit. Packaged smoke acceptance reads the resolved Host tool roster and rejects any unexpected `web_search`, pinning this product boundary.
