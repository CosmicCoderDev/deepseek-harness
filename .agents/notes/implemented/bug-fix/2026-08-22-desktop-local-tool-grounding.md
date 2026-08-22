# Agent Note: Desktop local-tool evidence grounding

Status: implemented

English | [中文](2026-08-22-desktop-local-tool-grounding.zh.md)

## Problem

The desktop local Qwen route could execute `bash` and filesystem tools successfully, then answer with a generic claim that it could not inspect or run software on the user's machine. The permission selector was working; the contradiction was generated after successful tool results. Copy-only built-in preset installation also left already installed prompts stale after an application upgrade.

## Decision

Desktop composition enables optional successful-tool evidence grounding in `repeat-tool-reminder` for shell and filesystem tools. The first matching success in each user turn adds a logged plugin context stating that the result came from the actual local runtime, must be treated as direct evidence, and must not be contradicted by a generic capability disclaimer. Failed and denied calls do not produce successful-evidence context. The mechanism is advisory and grants no authority.

The local-only and automatic desktop personas now state the distinction between permission policy and model capability: Full access authorizes the broadest available tool operations, environment facts must be checked with tools, successful results are direct observations, and failures must be reported exactly.

The desktop preset installer migrates only files whose digest matches a known previously shipped built-in. Unknown content remains user-owned and is never overwritten. This upgrades existing unmodified local-only and automatic prompts while preserving custom presets.

## Alternatives considered

**Rely on persona text only.** Rejected as too weak for smaller local models: the observed contradiction happened after valid tool use, where a timely post-result reminder provides stronger grounding.

**Treat Full access as the fix.** Rejected because the tools already executed successfully. Expanding authority cannot repair an answer-generation contradiction and would weaken security without changing the cause.

**Overwrite all installed presets.** Rejected because copied presets are editable user files. Digest-gated migration updates known built-ins without destroying customization.

## Consequences

Desktop local tool successes add one small model-visible context per user turn. The message is durable and attributable in the session log, but consumes a small number of tokens. The existing repeat-loop behavior is unchanged unless `evidenceInclude` is configured. Future built-in prompt migrations must add their prior digests before changing source templates.

## Verification

- A real session log showed successful `ls`, `which python3`, and `python3 --version` calls, proving the reported issue was not a permission denial.
- Guard tests cover one grounding notice per user turn and no notice for a failed tool.
- Desktop installer tests cover known managed migration and preservation of modified files.
- Desktop composition validation confirms that the installed prompt and grounding plugin configuration are active.
