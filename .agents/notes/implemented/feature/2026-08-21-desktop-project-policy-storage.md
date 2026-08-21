# Agent Note: Desktop project policy storage

Status: implemented

English | [中文](2026-08-21-desktop-project-policy-storage.zh.md)

## Problem

Desktop settings were global. The next product phase requires per-project execution defaults and authority boundaries without writing product metadata into customer repositories or persisting credentials. Invalid project policy must fail closed rather than silently granting a permissive default.

## Decision

The desktop application stores configured policies in `$DSH_HOME/desktop-project-policies.json`, keyed by normalized absolute project root. The versioned file is written with the shared `writeFileAtomic` utility, which uses an exclusive random sibling and atomic rename. Missing storage means no project override. Invalid storage is preserved under a timestamped corrupt filename and replaced with an empty store.

Each policy validates a closed desktop execution preset, optional bounded provider and model identifiers, a subagent permission cap, network policy, credential-free proxy override, cross-review default, and absolute read/write roots. The project root must be readable, every write root must be within a read root, and manual proxy URLs containing user information are rejected.

A narrow settings preload API lets the renderer select a directory, load its safe draft or configured policy, save a validated policy, and disable its override. The main process owns directory selection and storage. Any policy that permits more than read-only authority, explicitly enables networking, or contains a write root requires a separate confirmation flag that is enforced again at IPC.

The main-window preload additionally exposes only policy resolution by absolute project root. The Connection client owns that native carrier detail and publishes a transport-neutral `resolveProjectPolicy` service method; the agent-preset UI consumes the declared Connection service instead of reading Electron globals. Resolution applies only to a blank session. An explicit session choice has priority, including when it is applied while a policy lookup is pending. Network denial resolves to the local-only preset and cross-review resolves to the fixed Codex-to-Claude review preset.

The shared subagent runtime also exposes an effect-scoped permission-ceiling registry. At Host boot, the desktop carrier registers a synchronous resolver backed by the current in-memory project-policy map. Every Codex and Claude Code start derives the task workspace from the immutable parent-session `cwd`, resolves the most specific containing project root, and applies that project's logical permission cap after the globally configured provider mode. Ceiling contributions compose in registration order and may only retain or reduce authority; an invalid tier or attempted increase fails closed. When no project policy contains the task workspace, the exact configured native provider mode is preserved.

The same runtime exposes an effect-scoped child-environment policy registry. The desktop Host resolves the most specific project policy from the same parent-session `cwd` and computes the proxy environment immediately before every Codex or Claude Code start: `inherit` uses the current global desktop proxy snapshot, `system` rereads the macOS system proxy at start time, `manual` accepts only a validated credential-free URL, and `direct` uses explicit deletion tombstones to remove proxy values inherited from the parent process. Network-denied projects are forced to `direct`. Every mode sets both cases of `NO_PROXY`, keeping loopback addresses, `localhost`, and local services off the external proxy. Project policy can select only these closed fields and cannot inject arbitrary environment variables or shell content.

## Alternatives considered

**Write a policy file into every repository.** Rejected because customer repositories should not be mutated merely by opening desktop settings and teams may not want local product policy committed.

**Create an implicit permissive policy for every opened project.** Rejected because missing configuration must preserve existing global behavior and corrupt configuration must fail closed.

**Store arbitrary provider modules or commands.** Rejected because the renderer boundary must remain a closed product configuration rather than a code-loading mechanism.

## Consequences

The storage, validation, settings surface, default execution-mode resolution, cloud-subagent permission ceiling, and Provider proxy projection are independently testable, while project policy remains credential-free. A global full-access setting can therefore be narrowed to project-development or read-only for a specific project, while a project can never use its policy to broaden a safer global setting. The bundled one-shot Codex and Claude Code providers now consume both permission and proxy policy. System proxy changes are polled globally, while project `system` mode also rereads them at each Provider start. Per-project routing for core LLM requests and read/write roots still need consumption by the later Host networking and sandbox layers; direct Host tool confinement likewise belongs to that later sandbox stage rather than this Provider boundary.
