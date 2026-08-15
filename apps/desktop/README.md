# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Native Electron application for DeepSeek Harness. It starts the Host inside the Electron main process, loads the built Web UI from `file://`, serves client plugin bundles through the private `dsh-plugin://` protocol, and carries unary plus streaming RPC over a context-isolated IPC Fetch bridge. It does not open an HTTP or WebSocket listening port and does not require an external Node.js runtime after packaging.

## Current status

The desktop surface is a developer preview. The current packaging workflow is validated for Apple silicon (`arm64`) macOS. It produces an unsigned, non-notarized application without automatic updates; Windows, Linux, and Intel macOS packages are not release targets yet.

Running from source requires Node.js `^22.19.0` or `>=24.0.0` and the repository's pinned pnpm version. The packaged application includes its runtime and does not require a separate Node.js installation.

## Run from a checkout

From the repository root:

```sh
pnpm install
pnpm desktop
```

The renderer has Node integration disabled, context isolation and Chromium sandboxing enabled, all permission requests denied, a restrictive Content Security Policy, and navigation restricted to local application resources. The policy permits dynamic script evaluation because the existing client-plugin runner evaluates Host-provided plugin bundles at runtime, and it hashes the three exact built-in theme bootstrap variants instead of granting general inline-script execution. It still blocks objects, forms, arbitrary navigation, and unlisted resource classes. Only ordinary HTTP, HTTPS, and mail links may be handed to the operating system. Normal launches use Electron's single-instance lock; opening the application again restores and focuses the existing window instead of starting a second Host against the same `$DSH_HOME`.

## Configure a local model

Desktop and Web use the same `$DSH_HOME` configuration. In **Settings → Models**, choose **Add a custom provider** and enter the endpoint, protocol, credential, and at least one model.

For a local Ollama server with `qwen3-coder:30b`:

| Field | Value |
| --- | --- |
| Provider ID | `ollama` |
| Display name | `Ollama` |
| Base URL | `http://127.0.0.1:11434/v1` |
| API protocol | `openai-completions` |
| API key | Any non-empty placeholder when authentication is disabled |
| Model | `qwen3-coder:30b` |

Make sure Ollama is running and the model is already available locally. Save the provider, select the model in the composer, and create a new session. Configuration changes apply to the next request without restarting the application. The [model configuration guide](../../docs/user/guide/providers.md) covers other providers, credentials, model discovery, and troubleshooting.

On first launch, the desktop application reads Ollama's local `GET /api/tags` list. It does not send a prompt, download a model, or rewrite Harness configuration. When Ollama is detected, the assistant distinguishes between an installed recommended model and a running server that is missing it, then presents the exact values above. Choose **Copy Configuration** to paste them into the Models form. If you dismiss the assistant, reopen it at any time from **Help → Local Model Setup**.

## Diagnostic logs

The desktop main process records startup, Host lifecycle, renderer-load errors, and exceptional states in the operating system log directory. Common API-key, bearer-token, authorization-header, and password shapes are redacted before disk writes. Environment variables and model conversation content are not collected.

- Choose **Help → Open Logs Folder** to inspect the raw desktop log.
- Choose **Help → Export Diagnostics** to create a text report containing application, Electron, Chromium, and Node versions, platform facts, and at most the last 256 KiB of the log.
- The report asks you to review it before sharing. Nothing is uploaded, and a report exists only after you choose its destination.

## Build for macOS

```sh
pnpm dist:desktop:mac
```

The application bundle, DMG, and ZIP are written under `apps/desktop/dist`. The current local build is intentionally unsigned (`identity: null`), so macOS Gatekeeper may require an explicit first launch. Public distribution still requires an Apple Developer ID certificate, hardened-runtime signing, and notarization.

To install the local build:

1. Open `DeepSeek Harness-<version>-arm64.dmg`.
2. Drag **DeepSeek Harness** to **Applications**, replacing an older preview if prompted.
3. Eject the disk image.
4. On the first launch, right-click **DeepSeek Harness**, choose **Open**, and confirm the macOS prompt if Gatekeeper blocks the unsigned build.

The packaged application keeps its runtime dependency tree on the real filesystem instead of inside ASAR. The profile loader maintains a `node_modules` fallback with symlinks for dynamically configured plugins, so those package directories must remain physical. The macOS packaging command finishes by starting both the Host and renderer with an empty temporary `DSH_HOME`; a missing static, peer, or profile-loaded dependency fails the build.

Run the packaged smoke test again without rebuilding:

```sh
pnpm --filter @deepseek-ai/dsh-desktop smoke:packaged:mac
```

The test uses an isolated temporary home, boots the complete Host, loads the renderer and private plugin bundles, waits for the React root, and then exits. It cannot pass because of packages linked from the checkout or an existing user profile.

## Transport boundary

The preload exposes only boot metadata and three bounded carrier operations: request, stream subscription, and abort. The main process accepts only GET/POST requests to the synthetic `http://dsh.internal` authority, enforces request identifiers and a body-size limit, and dispatches them directly to the in-process Host. Client bundles are read only from the Host-generated plugin manifest and are never exposed through a general filesystem protocol.

## Troubleshooting

- **macOS says the application cannot be opened** — Use right-click → **Open** for this unsigned local build. Public distribution needs signing and notarization.
- **A JavaScript module is missing at startup** — Confirm that the installed application version matches the newly built DMG. Rebuild with `pnpm dist:desktop:mac`; the isolated smoke test must pass before the command succeeds.
- **The local model cannot be reached** — Confirm the local server is running, the base URL includes `/v1`, and the selected model exists. Enter the model manually if the endpoint does not implement `GET /models`.
- **A saved provider or model does not appear in an existing conversation** — Select it in the composer and start a new session; sessions that have already sent a request retain their recorded model.
- **You need to report a startup problem** — Choose **Help → Export Diagnostics**, review the report for paths or content you do not want to share, and attach it to the problem description.
