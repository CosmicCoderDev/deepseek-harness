# @deepseek-ai/dsh-repeat-tool-reminder

English | [中文](README.zh.md)

An advisory post-tool guard, not a model-facing tool: it never appears in the tool list and never vetoes or rewrites a call. Its default behavior watches each agent's stream of tool calls, counts runs of consecutive calls to the same tool with identical canonicalized arguments, and at configured run lengths injects an escalating advisory reminder. Deployments may also opt successful tools into local-evidence grounding: the first matching success in a user turn tells the model that the result is a direct observation and must not be contradicted by a generic “I cannot access the machine” disclaimer. Both behaviors remain advisory and logged. Decision records: [the repeat-tool-reminder Agent Note](../../../.agents/notes/archived/feature/2026-07-08-repeat-tool-guard.md) and [desktop local-tool grounding](../../../.agents/notes/implemented/bug-fix/2026-08-22-desktop-local-tool-grounding.md).

## Config

```yaml
- id: repeat-tool-reminder
  name: '@deepseek-ai/dsh-repeat-tool-reminder'
  config:
    thresholds: [3, 5, 8]        # default; consecutive counts that trigger a reminder
    include: []                  # tool-name patterns to track; empty ⇒ all tools
    exclude: [todo_write]        # tool-name patterns transparent to the chain
    argumentsPreviewChars: 500   # default; cap on arguments quoted in the detailed reminder
    evidenceInclude: []          # successful tool patterns that establish direct local evidence
```

`thresholds` fails loud at plugin load: an empty list, a non-integer, a value below 2, or a duplicate throws, never a silent fall-back to defaults; `argumentsPreviewChars` equally rejects anything but an integer >= 1. The list is normalized to ascending order; the FIRST threshold delivers a short generic nudge, every later threshold delivers the detailed form naming the tool, the run length, and the canonical arguments — head-truncated at `argumentsPreviewChars` with an omitted-count marker, so a looping `write`/`edit` payload cannot ride into the next request unbounded (the chain key always compares the FULL canonical string; the cap bounds the reminder, never the detection).

`include`/`exclude` entries support `*` wildcards and are predicates over whatever tools exist at call time, not references to registry entries — a pattern matching no currently registered tool is NOT an error (`exclude: [mcp_*]` stays valid in a deployment that loads no MCP tools), unlike `toolOrder`'s referent check.

`evidenceInclude` uses the same wildcard rules and defaults to empty, preserving the loop-only package behavior. When enabled, only a successful matching execution with a live agent emits the grounding context, at most once per user turn. It does not grant authority, convert failures to successes, or infer facts beyond the tool result.

## Chain semantics

The chain key is `(tool name, canonical arguments)` — canonicalization is a deep key-sort plus `JSON.stringify`, so argument objects differing only in property order count as identical. A call identical to the previous tracked call increments the agent's consecutive counter; a different tracked call resets it to 1.

- **Untracked calls are transparent to the chain.** A call excluded by `include`/`exclude` neither increments nor resets the counter, so `grep X → todo_write → grep X` still counts as two consecutive `grep X` when `todo_write` is excluded. This is what makes exclusion useful: bookkeeping tools interleaved into a loop must not launder it.
- **Denied calls count.** Detection sits on `tools/post-execute`, which also runs for calls a `tools/pre-execute` listener denied — a model hammering a denied call is exactly the loop worth breaking.
- **Calls without an agent are ignored.** A direct `ctx.tools.execute()` caller has no model to remind and no live agent object to key on.
- **Per-agent keying.** The tool registry is context-level and subagents interleave through the same waterfall, so a `WeakMap<Agent, Chain>` keys each chain by the live agent object; one agent's repetition never trips another's reminder. A user prompt (`agent/pre-step`) resets the submitting agent's chain, and object lifetime bounds the weak entry without a disposal listener.
- **In-memory only.** A session resumed from persistence starts with a fresh chain — the guard is a heuristic nudge, not a logged invariant, later reminders are the accepted cost.

## Reminder delivery

Reminders ride the post-execute decision's `additionalContexts` (source `{kind: 'plugin', plugin: 'repeat-tool-reminder'}`), never a `content` replacement: the `tool/result` event stays the tool's own output for audit. The loop buffers the context and appends it as an injected `user/message` after the step's tool results, which the session renders as a plain synthetic user message — so the reminder is model-visible, source-attributed, and reconstructable from the session log with no new session event. The guard always delegates via `next()` and prepends its reminder to the downstream decision's context array (both variants — a blocked call still gets the nudge); every entry retains its own source and metadata.

The optional evidence reminder uses the same delivery path and carries the notice summary `<tool>: local evidence`. A failed or denied execution never produces that notice.

## Model Experience

### Successful local-evidence context message

When configured through `evidenceInclude`, the first matching success in a user turn adds a bounded reminder that the preceding tool result came from the actual runtime. It tells the model to rely only on what the result proves, gather more evidence when needed, and report exact later failures instead of erasing successful evidence with a generic disclaimer.

### First-threshold context message

#### What the model sees

At the first configured consecutive-repeat threshold, that agent receives the reminder below. No tool schema or normal-call text is added.

##### First-threshold reminder

```markdown
You are repeating the exact same tool call with identical arguments. Carefully analyze the previous result before calling again: if the task is not complete, try a different approach or different arguments instead of repeating the call.
```

#### Token effect

Zero tokens before the threshold. The reminder is retained history for that agent.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Later-threshold context message

#### What the model sees

A later threshold receives the detailed reminder template below. A capped argument preview ends exactly `… (+<omitted> more chars)`.

##### Later-threshold reminder

```markdown
Repeated tool call detected:
- tool: <toolName>
- consecutive_calls: <count>
- arguments: <canonicalArguments>
The repeated calls are not making progress. Do not call this tool with these exact arguments again. Inspect the latest result and choose a different action, different arguments, or finish the task if enough evidence has been gathered.
```

#### Token effect

Each reminder is retained history; `argumentsPreviewChars` bounds its data-dependent argument text, while agents keep independent counters.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Exact-match detection only** — canonicalization is a deep key-sort, so near-identical variants (a tweaked path, extra whitespace inside a value) evade the chain; fuzzy matching is rejected pending evidence of need.
- **Compaction does not reset chains** — a chain spanning a compaction checkpoint keeps counting.
- **Advisory only** — escalating to `block` at a high threshold is not implemented, though `PostToolDecision` already supports blocking.
- **No subagent chain-sharing** — chains stay isolated per agent; a parent and its subagent repeating the same call never combine.
- **Legitimate idempotent polling still draws nudges** past the thresholds — the pressure valves are `thresholds`/`exclude` config.
- **Past the highest threshold a chain goes silent** — reminders fire only at exact configured counts, never beyond them.
- **Evidence grounding is advisory** — it prevents no hallucination mechanically; product presets should pair it with an explicit tool-capability persona and behavioral tests.
