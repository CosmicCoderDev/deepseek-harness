# Agent Note: Desktop delivery hardening

Status: proposed

English | [中文](2026-08-21-desktop-delivery-hardening.zh.md)

## Problem

The desktop application can start, persist settings, expose provider status, and launch Codex and Claude Code, but several controls are still advisory or incomplete. A user-visible permission preset does not by itself prove that every Host operation is capped, project proxy preferences are not yet enforced throughout provider execution, filesystem boundaries need end-to-end verification, low-level failures are still difficult for ordinary users to act on, and the packaged application has not passed a repeatable multi-provider acceptance suite. Installing another build before these boundaries are pinned would create a package that looks finished without being reliably safe or supportable.

## Proposal

Complete the desktop delivery work in five ordered stages. Each stage must preserve the existing main-process trust boundary: renderers submit validated intent, while the desktop Host derives executable paths, provider arguments, environment, permissions, and filesystem policy.

### 1. Enforce permission ceilings in the Host

Treat the three desktop permission profiles as enforceable upper bounds rather than UI labels:

- **Read-only analysis** may inspect the selected project but may not modify files, execute mutating commands, or bypass approval and sandbox controls.
- **Project development** may modify files and run ordinary development commands inside the selected project, while destructive, privileged, or out-of-scope operations remain blocked or require an explicit supported approval flow.
- **Full access** remains unavailable without explicit confirmation at the main-process boundary and must never be inferred from a renderer value, model request, preset, or persisted project policy alone.

The Host must compute the effective permission as the most restrictive applicable value across the global desktop setting, project policy, task/session request, and provider capability. Provider-native permission strings are an implementation detail derived after that calculation. A provider must not be able to broaden the effective permission through prompts, environment variables, or child-process arguments.

### 2. Enforce project proxy policy

Apply the persisted proxy mode consistently to Host networking and all provider child processes. Support system proxy, validated manual proxy, and direct connection. Refresh system proxy changes without restarting the application, expose the effective non-secret endpoint, and test OpenAI, Anthropic, DeepSeek, and Ollama independently.

Loopback addresses, `localhost`, and local Ollama endpoints must always bypass external proxies. Proxy credentials must not appear in renderer state, logs, diagnostics, or copied reports. A project policy may choose among allowed modes but must not inject arbitrary environment variables or shell fragments.

### 3. Enforce read/write sandbox boundaries

Bind every task to a canonical project root and derive provider working directories and filesystem grants from that root. Resolve symlinks and path traversal before authorization. Read-only analysis must receive a read-only project view; project development must receive write access only to approved project paths and explicitly managed temporary locations. Access outside those roots must fail closed with an actionable error.

The enforcement must cover direct Host tools, Codex, Claude Code, shell subprocesses, file attachments, and any reconnect or task-resume path. UI badges and prompt instructions may explain the boundary but do not count as enforcement.

### 4. Provide actionable diagnostics and observability

Replace generic startup and tool failures with stable categories and user actions. At minimum, distinguish missing installation, expired login, provider permission denial, proxy/network failure, Host startup failure, project-policy rejection, sandbox denial, timeout, cancellation, and unexpected failure.

The settings and task surfaces should show provider readiness, current permission profile, effective proxy mode, project root, task stage, and the last safe error. Provide retry, re-login, connection test, open-log-location, and one-click copy actions where applicable. Copied diagnostics must be bounded and redact tokens, OAuth codes, proxy credentials, email addresses, and other known secrets before leaving the main process.

### 5. Run packaged desktop acceptance tests

Validate the installed macOS package rather than only source-mode or browser execution. The acceptance matrix must cover the local Qwen3 Coder 30B endpoint, Codex, and Claude Code individually and in the combined preset. It must verify provider selection, explicit provider requests, tool-call success, truthful failure reporting, permission denial, project-root isolation, proxy switching, localhost bypass, authentication expiry, restart/recovery behavior, and diagnostic redaction.

Automate every deterministic scenario and keep a short manual checklist for browser authorization and other account-dependent flows. A failed subagent call must never be presented as a successful verified result. The package is eligible to replace the copy in `/Applications` only after the acceptance matrix passes and duplicate application bundles are accounted for.

Apple Developer ID signing, notarization, and production auto-update remain outside this proposal until credentials are available. Their absence must be stated in release notes and does not relax the five delivery gates above.

## Delivery sequence and dependencies

The stages are intentionally sequential:

1. Host permission enforcement defines the maximum authority available to later components.
2. Proxy enforcement establishes deterministic provider connectivity without weakening local bypass rules.
3. Sandbox enforcement binds that authority to concrete project paths and subprocesses.
4. Diagnostics expose the decisions and failures produced by the first three stages.
5. Packaged acceptance validates the complete behavior at the same boundary users will run.

Implementation may be split into separate commits, but a stage is not marked complete from UI work alone. Each stage must add or update its owning Agent Note, tests, and user documentation in the same change.

## Alternatives considered

**Package and install after each visible improvement.** Rejected because frequent unsigned packages make regressions and duplicate installations harder to distinguish, while advisory controls can appear complete before the Host enforces them.

**Rely on provider-native permissions and prompts.** Rejected because provider vocabularies differ, small local models can invent or misuse tools, and prompt text is not a security boundary. The desktop Host must own the common ceiling and derive provider-specific modes.

**Implement diagnostics before enforcement.** Rejected because diagnostics need stable permission, proxy, and sandbox outcomes to classify. Building them first would encode temporary errors and require avoidable rework.

**Wait for Apple Developer credentials before hardening.** Rejected because signing and notarization address distribution trust, not runtime authorization, isolation, connectivity, or truthful failure behavior. The unsigned test package can and should satisfy these gates first.

## Acceptance criteria

- Automated tests prove that no renderer, project policy, preset, model request, or provider argument can exceed the Host-computed permission ceiling.
- Proxy settings affect Host and provider traffic consistently, refresh without restart, redact credentials, and always bypass loopback/Ollama traffic.
- Read-only and project-development tasks are confined to their canonical authorized roots across direct tools and both cloud subagents, including symlink and resume/reconnect cases.
- Known failures produce stable, actionable categories, and copied diagnostics contain no seeded secrets in redaction tests.
- The packaged macOS application passes the documented Qwen, Codex, and Claude Code acceptance matrix; failures remain visibly failures and do not trigger fabricated fallback claims.
- Only after all five gates pass is a new package installed into `/Applications`; signing, notarization, and auto-update remain explicitly deferred.

## Risks

Permission and sandbox enforcement can expose assumptions that currently work only because providers receive broader access. Proxy refresh can interrupt in-flight work unless changes are applied at a defined task boundary. Provider CLIs and authentication output can change independently of this repository, so status and error parsing need conservative fallbacks. Full packaged acceptance depends on local accounts and network availability; account-dependent cases therefore require explicit skip reasons rather than false passes. Deferring Apple signing means testers will continue to encounter normal macOS trust warnings for unsigned builds.
