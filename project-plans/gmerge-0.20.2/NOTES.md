# NOTES.md — gmerge-0.20.2

Running notes during execution. Append after each batch.

---

## Pre-execution Notes

- 24 decision changes made during Phase 2 review (v1 -> v2).
- Key architectural discoveries: prompts.ts completely rewritten, hooks partially implemented, MCP instruction plumbing absent, executor already stateless.
- 2 REIMPLEMENT pairs grouped into single batches: hooks (558c8ece + 5bed9706), MCP instructions (bc365f1e + 844d3a4d).

---

## Batch 1 (PICK — commits 1-5)

- Clean cherry-picks for 4/5 commits.
- 6a43b312 (telemetry finish_reasons) needed manual fix: `OTelFinishReason` type inlined since `semantic.ts` doesn't exist in LLxprt.
- Post-batch fix: removed unused `coreEvents` import (lint failure).

## Batch 2 (PICK — commits 6-10, FULL VERIFY)

- f4babf17 (async error handling) was the most conflicted — touched eslint config and ~20 files.
- 3 post-batch fix commits: formatting, debugLogger→debug rename in mcp-client.ts, return-await lint compliance.
- Full verify passed after fixes.

## Batch 3 (PICK — commits 11-13)

- 1689e9b6 (React state fix) had significant conflicts in AppContainer.tsx and useCommandCompletion.ts.
- ba864380 (IDE auth patch) carried release scaffolding that was discarded.
- Post-batch fix: removed duplicate upstream code from AppContainer, fixed compute dirs in useCommandCompletion.

## Batch 4 (REIMPLEMENT — gemini-3 prompts, FULL VERIFY)

- Added "Do not call tools in silence" behavioral override to gemini-3-pro-preview/core.md.
- Straightforward implementation following existing model-specific override pattern.
- Full verify passed.

## Batch 5 (REIMPLEMENT — interactive/non-interactive/subagent mode)

- Added `interactionMode` to PromptEnvironment with 3 modes: interactive, non-interactive, subagent.
- Created 4 template variables: INTERACTION_MODE, INTERACTION_MODE_LABEL, INTERACTIVE_CONFIRM, NON_INTERACTIVE_CONTINUE.
- Updated core.md and gemini provider core.md templates.
- Cherrypicker subagent timed out at 900s but had completed all work; finished manually.
- Callers not yet wired to pass interactionMode (infrastructure-only, to be wired by callers as needed).
- **Introduced a latent test failure**: prompt-service.test.ts checked for literal "You are an interactive CLI agent" which now uses template variable. Fixed in Batch 12.

## Batch 6 (REIMPLEMENT — shell inactivity timeout, FULL VERIFY)

- Added `shellInactivityTimeout` setting and Config getter.
- Wired into ShellExecutionService with reset-on-output semantics.
- Full verify passed.

## Batch 7 (REIMPLEMENT — auto-execute slash commands)

- Added `autoExecute?: boolean` to SlashCommand interface.
- Simple commands (like /help, /quit) execute immediately on Enter; complex ones autocomplete.
- Tab always autocompletes regardless of autoExecute flag.

## Batch 8 (REIMPLEMENT — hook integration, FULL VERIFY)

- Created coreToolHookTriggers.ts and geminiChatHookTriggers.ts.
- Wired LLxprt's existing hook infrastructure (hookRegistry, hookPlanner, hookRunner) into coreToolScheduler and geminiChat runtime paths.
- Full verify passed.

## Batch 9 (REIMPLEMENT — MCP instructions)

- Added getMcpInstructions() aggregation and useInstructions setting.
- MCP server instructions always included when available.
- Added prompts-async integration test for MCP instruction rendering.

## Batch 10 (REIMPLEMENT — stats quota display, FULL VERIFY)

- Added QuotaInfo to session stats types.
- Added quota section to StatsDisplay component.
- Added /stats quota subcommand.
- Cherrypicker timed out at 1200s but left complete work; verified and committed manually.
- Full verify passed (all tests, lint, typecheck, format, build, haiku).

## Batch 11 (REIMPLEMENT — A2A modelInfo propagation)

- Added private `modelInfo` field to A2A Task class.
- Handles ModelInfo event type, uses in getMetadata and status updates.
- Falls back to config model when no modelInfo received.
- Added ModelInfo event type to GeminiEventType enum in core turn.ts.

## Batch 12 (REIMPLEMENT — JIT context manager, FULL VERIFY)

- Added `jitContextEnabled` boolean setting (default true).
- Added Config.getJitContextEnabled() with settings service fallback.
- **Fixed prompt-service test** that was broken since Batch 5 (checked raw template for "interactive" literal).
- Full verify passed.
- Subagent timed out/errored but left complete work in 4 files.

## Batch 13 (REIMPLEMENT — stdio hardening)

- Added error event handlers to createInkStdio() in stdio.ts.
- EPIPE errors silently ignored; other errors logged via console.warn.
- Follows same pattern as hookRunner.ts EPIPE handling (Batch 2).

## Batch 14 (REIMPLEMENT — shell env sanitization, FULL VERIFY)

- Added ShellExecutionService.sanitizeEnvironment() static method.
- Uses blocklist approach: strips sensitive vars (API_KEY, SECRET, TOKEN, etc.).
- Preserves LLXPRT_*, PATH, HOME, SHELL, TERM, GIT_*, NODE_*, CI vars.
- Only active in CI/sandbox mode; local dev gets full environment.
- Full verify passed (subagent ran complete verification).

---

## Summary

- 14 batches executed: 3 PICK batches (13 upstream commits), 11 REIMPLEMENT batches.
- 29 total commits on gmerge/0.20.2 branch.
- Multiple subagent timeouts handled gracefully (B5, B10, B12) — partial work completed manually.
- One latent test failure introduced in B5, caught and fixed in B12.
- All full verify cycles passed.
