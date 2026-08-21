# Agent Note: Desktop direct Provider execution

Status: proposed

English | [中文](2026-08-21-desktop-direct-provider-execution.zh.md)

## Problem

The desktop “Codex Direct” and “Claude Code Direct” modes still run a first-layer Agent on the selected local model, then rely on persona text asking that model to call `subagent_codex` or `subagent_claude_code`. This path inherits the local model's tool-selection, context, and modality limits. The model may skip or invent a tool; an image can be rejected by non-vision Qwen before delegation; and a Provider failure can be followed by an unverified substitute answer. “Direct” therefore means prompted delegation rather than an execution route.

The native desktop Host disables `web_search`, which requires `DEEPSEEK_API_KEY`, but a source Web Host, stale installation, old Host, or existing session can retain a different tool snapshot. Built-in presets are copied only when files are absent, so installed templates also remain stale across application upgrades. The UI can consequently disagree with the effective execution capability.

## Proposal

Make the executor a structured Host-owned session property and provide direct Codex and Claude Code paths that do not invoke a local model. Prompt text remains useful for ordinary Agent behavior but does not own Provider routing, security policy, or failure classification.

### Execution modes and UI

A new session fixes one `executionTarget`: `local-model`, `codex`, `claude-code`, or `orchestrated`. The selector presents local/API models and external executors as distinct groups. Selecting Codex or Claude Code sends input directly to that Provider; Qwen does not parse, rewrite, choose tools, or summarize it. Only `orchestrated` may use a local model to call multiple Providers or a fixed workflow. A running session cannot silently change target; a change creates a new session or uses an explicit migration operation.

The UI displays both the execution target and actual model information instead of presenting a Provider as a local model. Missing installation, authentication, network, or input capability is reported before send where possible. A failed direct execution never falls back to Qwen or another Provider.

### Host and protocol

Add a Host capability registry such as `ExternalExecutorRuntime`, with stable `codex` and `claude-code` registrations. It accepts a normalized workspace, content blocks, permission ceiling, proxy environment, cancellation signal, and diagnostic sink, and returns normalized streaming events plus a terminal outcome. It does not require a parent `Agent` or fabricate a subagent relationship.

The Codex and Claude Code packages factor process launch, authentication, protocol handling, and error classification into reusable executors. Their `SubagentProvider` implementations become adapters that call the same executor and add parent/child session semantics. Direct sessions and delegation then share official CLIs, permission mapping, project proxy policy, termination, and error classification without duplicate product implementations.

Session creation adds a closed `executionTarget` field persisted in immutable `SessionHeader`. The Host dispatches `session.prompt` from that field: ordinary targets enter the existing Agent inbox, while external targets enter a direct-execution controller. The renderer cannot submit executable paths, arguments, environment variables, or Provider modules. Restoration uses the persisted target rather than inferring it from the current UI.

### Transcript and concurrency

Direct execution still uses the standard Session log for user input, Provider output, cancellation, failure, and Provider/model source, without fabricating local-model steps or tool calls. The Host owns one active run per direct session; queueing, cancellation, retry, restoration, and busy behavior remain predictable alongside ordinary sessions. Provider output travels over the existing event stream and final text is recorded once.

Failures have structured terminal categories: `not-installed`, `not-authenticated`, `network`, `proxy`, `permission-denied`, `unsupported-input`, `timeout`, `cancelled`, and `unknown`. A failure may be retried but cannot append a local-model-generated success-looking answer.

### Images and attachments

Executors declare `text`, `image`, and file-attachment capabilities at registration. The composer validates against the current execution target rather than Qwen. The first delivery exposes only modalities proven through the official protocol and automated tests. If an adapter remains text-only, the UI says that the direct executor currently supports text only; it does not route through Qwen or silently convert the image.

Image support requires explicit Provider-layer content mapping, size and type limits, temporary-file lifetime, project read-authority checks, and diagnostic redaction. A capability becomes available only after a real end-to-end test proves that the target CLI received and used the image.

### Offline local vision model

The desktop product must support a separate local-vision role instead of requiring Codex, Claude Code, or a network service to understand images. The recommended default is Ollama `qwen3-vl:8b`, with `qwen3-vl:30b` available on sufficiently capable machines; `qwen3-coder:30b` remains the coding role. After the initial model download, image understanding, OCR, screenshot analysis, and the subsequent local coding path must work without a network connection.

Vision inference reuses the existing `llm-pi-ai` OpenAI-compatible path and sends image content through Ollama's `/v1` endpoint. Capability discovery is separate: an Ollama-specific Service Provider queries the native `/api/show` endpoint because `/v1/models` does not expose reliable `vision` metadata. The result is `supported`, `unsupported`, or `unknown`; an unreachable native endpoint, an old Ollama response without `capabilities`, or a failed probe remains `unknown` rather than being treated as unsupported. Model-name matching may provide installation guidance but cannot enable image input.

Settings configure local coding and local vision models independently and display installation status, disk size, minimum Ollama version, current residency and load state from `/api/ps`, latest image-recognition test result, and offline readiness. The page provides an explicit image test action. If no vision model is installed, image input gives installation guidance instead of attempting DeepSeek Search or a cloud Provider. A model download shows the expected size and requires confirmation before it starts, especially for the approximately 20 GB `qwen3-vl:30b` option.

A local image task first sends the original image and user question to the vision model. The first implementation keeps the complete image-bearing turn, including tool steps, on that vision-capable model and records the actual Provider/model in the ordinary request header; the next text-only turn returns to the coding role. This avoids an unlogged or lossy handoff and already supports recognition, OCR, explanation, and vision-guided edits offline. A later orchestrated mode may send a structured observation, the original request, and a controlled local image reference to the coding model, but it must mark that observation as model analysis rather than image-ground-truth. Resource-constrained systems rely on Ollama's `keep_alive` unloading and serial model loading rather than implementing a second model scheduler in the Host. The Host sets policy, avoids concurrent requests that would intentionally keep both 30B roles resident, and reports residency from `/api/ps` to the UI.

Routing follows structured capability and offline state. `local-model` uses the local vision role for image tasks. `codex` and `claude-code` receive original images only after their adapters prove image support; otherwise they may receive the local vision model's structured observation only after the user explicitly enables local visual preprocessing. Provenance must say that preprocessing occurred and must not claim that Codex or Claude directly viewed the image. `orchestrated` may compose these stages.

### Search tools and preset upgrades

The desktop Host continues to reject a resolved composition containing `web_search`. The product identifies whether the current carrier is Desktop Host or Web Host so a source Web page is not mistaken for desktop execution. A Web Host without usable search credentials also defaults to not registering a guaranteed-failure search tool; explicit online-search enablement registers it together with visible Provider status.

Built-in presets become versioned managed resources. The application records template versions and content digests, replacing a file only when it still matches a known older built-in digest; modified files remain and are marked custom. The upgrade removes persona-delegation definitions of `codex-direct` and `claude-direct`; structured `executionTarget` supplies those modes. Existing sessions restore their immutable configuration while new sessions use the new definitions.

### Delivery sequence

Stage one adds the executor registry, session field, and text-only Codex direct execution. Stage two adds Claude Code, streaming, cancellation, and structured errors. Stage three adds the local vision role, offline image routing, versioned preset migration, and Web Search credential gating. Stage four enables separately verified external-Provider image and attachment capabilities through official protocols. Stage five validates the installed application across local Qwen Coder, Qwen VL, Codex, Claude Code, proxies, offline mode, expired authentication, restoration, and no-fallback failures.

## Alternatives considered

**Strengthen the direct-mode persona.** Rejected because prompt text cannot guarantee a tool call or bypass local-model image, context, and tool-capability checks.

**Fabricate a parent Agent inside `session.prompt` and call the existing subagent.** Rejected because a fake relationship corrupts session trees, authority provenance, lifecycle, and diagnostics while making direct execution depend on the Agent loop.

**Wrap Codex and Claude Code as ordinary LLM adapters.** Not preferred because they are workspace, tool, and permission-bearing Agent executors rather than stateless completion models. The UI may display them beside models while the Host keeps a separate capability boundary.

**Fall back to a local model after failure.** Rejected because direct Provider selection is an explicit execution and trust decision; silent fallback misstates provenance and produces unverified results.

## Acceptance criteria

- With Codex or Claude Code selected, a text task succeeds while Ollama is stopped or Qwen is unavailable, and the transcript contains no local-model call or `subagent_*` tool call.
- A direct session persists its target across restoration, and the renderer cannot use the field to inject commands, modules, or environment variables.
- Provider absence, expired authentication, proxy failure, cancellation, and timeout produce stable errors without local-model or alternate-Provider fallback.
- The composer accepts only modalities declared and verified by the current executor; unsupported images are rejected accurately before send.
- With a local vision model installed, image description, OCR, screenshot questions, and “inspect then modify local code” succeed after external networking and both cloud Providers are disabled; the transcript distinguishes vision observations from coding output.
- The OpenAI-compatible inference path can send images without depending on native Ollama discovery; the separate native probe reports `supported`, `unsupported`, or `unknown`, and only `supported` enables image input without an explicit successful test override.
- The Settings image test distinguishes discovery failure from inference failure, shows current model residency, and an absent or unknown model never causes search to substitute for image understanding.
- The desktop Host tool catalog excludes `web_search`, and a default Web Host without search credentials does not expose a guaranteed-failure search tool.
- Upgrade tests prove that unmodified old built-in presets migrate, user-modified presets remain untouched, and old sessions still restore.
- The installed macOS application passes independent Codex, Claude Code, local-model, and combined-workflow acceptance with true execution provenance visible for every result.

## Risks

Bypassing the ordinary Agent loop requires deliberate reuse of transcript, queueing, cancellation, and restoration semantics or it can create an incompatible second session system. Official Codex and Claude Code attachment protocols can change, so capability declarations must remain conservative and adapter-tested. Native Ollama capability discovery can be unavailable even while OpenAI-compatible inference works, so the UI must preserve the `unknown` state and offer an explicit image test instead of guessing from a model name. Local dual-model routing adds disk usage, large downloads, cold-load latency, and model-switch latency; downloads require size confirmation, low-memory machines must default to a smaller vision model, and Host policy must avoid concurrent 30B residency while leaving load and idle-unload mechanics to Ollama. A first managed-preset migration may lack enough historical digests to classify every file; it needs backups and manual recovery. Placing external executors near model choices can obscure billing and authority, so the UI must keep Provider, account status, permission tier, and proxy mode visible.
