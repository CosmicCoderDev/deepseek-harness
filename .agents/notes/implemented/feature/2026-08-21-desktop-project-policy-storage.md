# Agent Note: Desktop project policy storage

Status: implemented

English | [中文](2026-08-21-desktop-project-policy-storage.zh.md)

## Problem

Desktop settings were global. The next product phase requires per-project execution defaults and authority boundaries without writing product metadata into customer repositories or persisting credentials. Invalid project policy must fail closed rather than silently granting a permissive default.

## Decision

The desktop application stores configured policies in `$DSH_HOME/desktop-project-policies.json`, keyed by normalized absolute project root. The versioned file is written through a private temporary file and atomic rename. Missing storage means no project override. Invalid storage is preserved under a timestamped corrupt filename and replaced with an empty store.

Each policy validates a closed desktop execution preset, optional bounded provider and model identifiers, a subagent permission cap, network policy, credential-free proxy override, cross-review default, and absolute read/write roots. The project root must be readable, every write root must be within a read root, and manual proxy URLs containing user information are rejected.

## Alternatives considered

**Write a policy file into every repository.** Rejected because customer repositories should not be mutated merely by opening desktop settings and teams may not want local product policy committed.

**Create an implicit permissive policy for every opened project.** Rejected because missing configuration must preserve existing global behavior and corrupt configuration must fail closed.

**Store arbitrary provider modules or commands.** Rejected because the renderer boundary must remain a closed product configuration rather than a code-loading mechanism.

## Consequences

The storage and validation foundation is independently testable and credential-free. Runtime enforcement and the project settings UI remain separate follow-up layers; until they consume this store, creating the module alone does not change task behavior.
