# Agent Note: Fixed Codex Development → Claude Code Review Workflow

Status: implemented

English | [中文](2026-08-21-codex-claude-review-workflow.zh.md)

## Problem

The desktop preview exposed separate Codex and Claude Code tools and relied on a local model to choose and order them. Smaller local models could invent tool names, skip a stage, silently fall back to local work, or continue after a failed review. Prompt text alone was not a reliable execution boundary.

## Decision

`@deepseek-ai/dsh-tool-workflow` accepts the opt-in `reviewToolName` setting. When configured, it registers one fixed tool that starts provider `codex`, waits for completion, and only then starts provider `claude-code`. The reviewer receives the original objective and Codex output, is instructed not to modify files, and must return `VERDICT: PASS`, `VERDICT: NEEDS_CHANGES`, or `VERDICT: BLOCKED`.

The desktop `codex-claude-review` preset enables this fixed tool and disables the two direct provider tools in the model-facing catalog. Stage-specific failures are preserved; a Codex failure short-circuits the review. Needs-changes, blocked, and malformed verdicts stop for user direction. There is no automatic repair loop.

## Alternatives considered

- A model-authored generic workflow was rejected because one workflow run binds a single subagent provider and cannot safely enforce the provider transition.
- Persona-only sequencing was rejected because observed local models could ignore or invent tool contracts.
- An automatic Codex repair loop was deferred because it can change files repeatedly without a fresh user decision.

## Consequences

The formal workflow is deterministic and testable, but requires registered `codex` and `claude-code` providers. Direct and preview modes remain separate choices. Review output is intentionally conservative: a missing verdict is blocked rather than inferred as success.
