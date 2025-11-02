# Stateless Foreground Agent Phase 5 – Overview

## Context
- Previous stateless hardening passes eliminated provider singletons but `GeminiClient`/`GeminiChat` still hold mutable links to `Config` for provider/model/auth data.
- CLI runtime helpers (`runtimeSettings`, slash commands, `--profile-load`) continue to mutate `Config`, preventing independent runtime instances.
- Forthcoming subagent orchestration needs per-agent runtime states; this phase focuses strictly on making the foreground agent’s Gemini pipeline stateless (except for `HistoryService`).

## Objectives
1. Introduce an explicit runtime state container that replaces `Config` for provider/model/auth data in the foreground agent.
2. Update CLI runtime helpers and slash commands to operate on the runtime state rather than mutating `Config` directly.
3. Refactor `GeminiClient` and `GeminiChat` to consume injected runtime state so provider/model selection is per-instance while continuing to use `HistoryService` as an injectable dependency.
4. Maintain existing UI diagnostics, history persistence, and provider switching flows without regression.
5. Deliver comprehensive TDD coverage and verification to prevent regression in stateless guarantees.

## Non-Goals
- Subagent orchestration or Task tool launchers (future phases).
- Changes to shared `HistoryService` beyond making its ownership explicit per `GeminiChat` instance.
- Provider implementations (already hardened in previous plan).

## Success Metrics
- `GeminiClient`/`GeminiChat` contain no direct `Config` reads for provider/model/auth selection.
- Slash commands and CLI flags mutate/query the new runtime state abstraction.
- Existing integration tests for runtime isolation extended to confirm foreground agent state separation.
- Full lint/typecheck/format/build/test suite passes after implementation phases.

## Requirements
- REQ-STAT5-001: Provide runtime state abstraction decoupled from `Config` for provider/model/auth data.
- REQ-STAT5-002: CLI runtime helpers and slash commands operate on runtime state while keeping UI diagnostics intact.
- REQ-STAT5-003: `GeminiClient` consumes runtime state for all provider/model/auth decisions.
- REQ-STAT5-004: `GeminiChat` uses injected runtime state/`HistoryService`, retaining no `Config` linkage for provider/model/auth.
- REQ-STAT5-005: Integration ensures foreground agent retains history/diagnostics while stateless behavior is preserved and regression tests cover the flow.
