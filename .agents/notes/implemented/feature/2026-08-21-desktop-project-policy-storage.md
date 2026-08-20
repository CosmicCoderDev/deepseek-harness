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

## Alternatives considered

**Write a policy file into every repository.** Rejected because customer repositories should not be mutated merely by opening desktop settings and teams may not want local product policy committed.

**Create an implicit permissive policy for every opened project.** Rejected because missing configuration must preserve existing global behavior and corrupt configuration must fail closed.

**Store arbitrary provider modules or commands.** Rejected because the renderer boundary must remain a closed product configuration rather than a code-loading mechanism.

## Consequences

The storage, validation, settings surface, and default execution-mode resolution are independently testable and credential-free. Permission caps, project proxy overrides, and read/write roots remain policy drafts until the Host execution and sandbox layers consume them; the application must not claim those fields are enforced yet.
