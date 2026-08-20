# Agent Note: Desktop settings and subagent permissions

Status: implemented

English | [中文](2026-08-20-desktop-settings-and-permissions.zh.md)

## Problem

The desktop application exposed proxy controls through transient dialogs, while Codex and Claude Code permission behavior was fixed in configuration. Users could not inspect provider readiness and networking in one place, select a task-appropriate authority tier, or understand the security boundary before granting unrestricted access. A packaged build also lacked an automated check for the settings surface and its IPC boundary.

## Decision

The desktop shell owns a sandboxed local settings page served from packaged assets. A narrow preload bridge exposes only validated settings reads and writes, credential-free connectivity checks, diagnostic copying, and log-folder opening. The page combines provider status, proxy configuration, permission selection, and diagnostic actions without granting Node access to its renderer.

Three product-level permission tiers map to provider-native modes: Read-only Analysis maps to Codex `never` and Claude Code `plan`; Project Development maps to Codex `approve-for-me` and Claude Code `acceptEdits`; Full Access maps to Codex `dangerously-bypass-approvals-and-sandbox` and Claude Code `bypassPermissions`. Full Access is rejected at the main-process IPC boundary unless the caller supplies an explicit second confirmation. Settings use a versioned, validated, atomically replaced private file, and the former proxy-only preference is migrated on first read.

The packaged smoke test opens the real settings asset, verifies its controls, proves that an unconfirmed Full Access write is rejected, and round-trips a safe setting through IPC. ASAR remains disabled: two packaging experiments reached Host startup but broke the parser preload for `@deepseek-ai/dsh-client-modules/client.js`. It may be enabled only after custom-protocol bundle paths and preload ordering have dedicated packaged regression coverage.

Provider login actions are a closed IPC enum. The main process derives the packaged executable paths and opens Terminal with the corresponding official login command; renderer input can select Codex or Claude Code but cannot supply shell text or a path. A separate opt-in live smoke script uses read-only/no-tool invocations, reports unauthenticated products as `SKIP`, and requires a fixed sentinel from each authenticated product.

## Alternatives considered

**Continue adding native message boxes.** This would minimize new UI code, but Electron message boxes cannot provide a coherent editable form and had already forced manual proxy input through the clipboard.

**Expose raw Codex and Claude permission strings.** This would be flexible for experts but easy to misconfigure and would make the cross-provider security meaning unclear. Fixed product tiers preserve a small, reviewable mapping.

**Enable ASAR and broadly unpack dependencies.** Both selective and complete `node_modules` unpacking were tested. They did not restore the parser preload, so retaining ASAR would knowingly ship a renderer boot failure.

## Consequences

Ordinary users can inspect and configure desktop networking and subagent authority without manually constructing terminal commands. The main process, rather than page JavaScript, remains the security boundary for validation, login command selection, and unrestricted-access confirmation. Existing proxy preferences migrate without deleting their legacy source. Permission changes are persisted for subsequent provider starts. Package size and file count remain higher while ASAR is disabled, but the known-working preload path is preserved and the condition for revisiting ASAR is explicit.
