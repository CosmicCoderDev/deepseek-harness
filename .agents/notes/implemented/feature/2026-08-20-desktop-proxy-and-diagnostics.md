# Agent Note: Desktop proxy control and actionable diagnostics

Status: implemented

English | [中文](2026-08-20-desktop-proxy-and-diagnostics.zh.md)

## Problem

The packaged desktop application inherited a macOS proxy only at startup and exposed provider failures as raw subprocess text. Users could not deliberately select direct or manual networking, observe system-proxy changes without restarting, distinguish reachability from authentication, or safely copy a useful report when Codex and Claude Code failed.

## Decision

The desktop shell owns a small persistent proxy preference under `DSH_HOME`. It supports system, manual, and direct modes; projects the selected mode into conventional upper- and lower-case subprocess variables; always bypasses loopback and `.local` destinations; and polls the macOS system proxy while system mode is active. The Help menu displays the effective credential-free address, applies mode changes immediately, and runs credential-free reachability checks for OpenAI, Anthropic, DeepSeek, and Ollama.

Codex and Claude Code startup boundaries classify recognized authentication, timeout, network, missing-package, and Node-wrapper failures with fixed safe categories while retaining `unknown` for unrecognized details. Desktop diagnostics translate those classes into a cause and suggested action. File export and clipboard copy share one bounded report builder. Redaction happens before log persistence and again when building a report, and covers common credentials, OAuth query parameters, and email addresses. The report never enumerates the process environment or sends itself over the network.

## Alternatives considered

**Rely only on macOS system settings.** This avoids a product preference but cannot support direct mode, per-application manual proxies, observable effective state, or stable troubleshooting when a user changes networks.

**Send authenticated API requests as connectivity tests.** This would distinguish account validity, but it would require reading credentials and could create cost or expose secrets. Reachability tests intentionally treat any HTTP response as network success and leave authentication to provider-specific status checks.

**Keep raw provider errors as the primary UI.** Raw details remain valuable in the redacted report, but presenting them alone makes known failures unactionable and can expose authorization material. The UI therefore leads with categorized text and retains only a bounded safe summary for unknown cases.

## Consequences

Users can change and verify desktop networking without restarting or opening a terminal, while Ollama and other loopback services stay direct. Support reports become easier to share and safer by default. The formal desktop settings page accepts manual proxy addresses directly and reuses the same validated preference and environment-projection functions. Reachability checks prove transport availability, not subscription state or API authorization.
