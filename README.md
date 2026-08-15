# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

> [!IMPORTANT]
>
> **A native macOS desktop preview is available on the `feat/electron-desktop-rc8` branch.** It runs the complete Harness UI in an Electron window without opening a local HTTP/WebSocket port. See the [desktop guide](apps/desktop/README.md).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

### Desktop application (macOS Apple silicon preview)

The desktop application is a native distribution of the same Harness product, not a separate simplified UI. It keeps the existing Agent, session, tools, plugin graph, provider settings, and local-model support while replacing the browser carrier with an Electron boundary.

| | Web | Desktop |
| --- | --- | --- |
| User interface | Browser tab | Independent Electron window |
| Host process | `dsh web` CLI process | Embedded in the Electron main process |
| RPC carrier | HTTP and WebSocket on loopback | Context-isolated Electron IPC |
| Listening port | `127.0.0.1:3080` by default | None |
| Node.js after installation | Required to run the CLI | Included in the application |
| Current packaged target | Any supported Node.js platform | Apple silicon macOS (`arm64`) |

Build the desktop application from the fork's rc.8 feature branch:

```sh
git clone https://github.com/CosmicCoderDev/deepseek-harness.git
cd deepseek-harness
git switch feat/electron-desktop-rc8
corepack enable
pnpm install
pnpm dist:desktop:mac
```

The command builds the shared Host and Web UI, creates the Electron application, generates DMG and ZIP artifacts under `apps/desktop/dist`, and smoke-tests the packaged Host and renderer with an empty temporary `DSH_HOME`. To install it, open the generated arm64 DMG, drag **DeepSeek Harness** to **Applications**, eject the image, and launch the application. The preview is unsigned, so use right-click → **Open** on first launch if Gatekeeper blocks it.

For development without an installer, run `pnpm desktop`. Only Apple silicon macOS is currently validated; signing, notarization, automatic updates, Windows, Linux, and Intel macOS packaging remain future work. See the [desktop guide](apps/desktop/README.md) for architecture, security, local-model setup, testing, and troubleshooting.

## Configure a model

Open **Settings → Models** to configure DeepSeek, a catalog provider, or a custom OpenAI-compatible endpoint. For example, a local Ollama route can use:

- Provider ID: `ollama`
- Base URL: `http://127.0.0.1:11434/v1`
- API protocol: `openai-completions`
- API key: any non-empty placeholder if the local endpoint does not authenticate
- Model: `qwen3-coder:30b`

Save the provider, select the model in the composer, and start a new session. The Web and desktop applications share the same `$DSH_HOME` settings and credentials. See the [model configuration guide](docs/user/guide/providers.md) for provider discovery, credentials, vision models, and troubleshooting.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
