# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

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

### Run the desktop app (macOS preview)

The desktop app embeds the Harness Host in Electron, loads the same plugin-driven UI locally, and does not open an HTTP or WebSocket listening port. From a source checkout:

```sh
pnpm install
pnpm dist:desktop:mac
```

The Apple silicon application, DMG, and ZIP are generated under `apps/desktop/dist`. The current preview build is unsigned, so macOS may require you to right-click the application and choose **Open** on first launch. See the [desktop application guide](apps/desktop/README.md) for installation, packaging, security boundaries, and current limitations.

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
