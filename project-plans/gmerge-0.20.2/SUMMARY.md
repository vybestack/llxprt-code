# SUMMARY.md — gmerge-0.20.2 (upstream v0.19.4 → v0.20.2)

## Overview

This pass covers upstream `v0.19.4..v0.20.2` (66 commits total). v2 reflects 24 decision changes after deep code analysis and user review.

## Decision Counts

| Decision | Count |
| --- | ---: |
| PICK | 13 |
| SKIP | 40 |
| REIMPLEMENT | 13 |
| **Total** | **66** |

## What is being pulled forward (PICK)

- **Reliability/bugfixes:** exit codes, hook-runner EPIPE guard, async error handling, React render-state fix.
- **MCP Google auth completion:** McpAuthProvider interface + header injection for Google Cloud-hosted MCP servers.
- **Local telemetry enrichment:** finish_reasons field on API response events (confirmed file-only, no Google transmission).
- **License cleanup:** revert to Apache 2.0 boilerplate.
- **CLI usability:** extensions link consent flag, markdown table rendering fix, setup-github strict-mode conditionals.
- **IDE auth robustness:** env token fallback patch.
- **Test deflaking:** globalSetup cleanup error handling, schema validation test improvement.

## What is intentionally skipped (SKIP, 40 items)

- All release/version commits (13).
- Upstream-only docs/branding/workflow/template updates (8).
- Commits depending on absent upstream architecture (fallback/availability stack, ConfigInitDisplay, startup profiler, semantic telemetry) (5).
- Already-present behavior in LLxprt (pager cat, /clear history, read-only policy rules, Zed ACP schema, executor stateless tools, web-fetch already disabled) (6).
- Absent test targets (extensions-reload.test.ts doesn't exist in LLxprt) (2).
- Session menu WIP by another agent (1).
- Upstream auth UI not present (1), emoji-themed holiday changes (1), upstream hook test harness (2), A2A logging patch (1).

## REIMPLEMENT focus areas (13 items)

Ordered by priority/impact:

1. **Interactive/non-interactive/subagent prompt mode** (`4a82b0d8`) — HIGH PRIORITY. Fixes root cause of subagent models stopping to ask for instructions. Add `interactionMode` to PromptEnvironment with template variables following SUBAGENT_DELEGATION pattern.
2. **Gemini 3.0 prompt overrides** (`1187c7fd`) — Model-specific prompt variant for "explain before tools" + remove "No Chitchat". Follow existing gemini-2.5-flash/gemini-3-pro-preview pattern.
3. **Auto-execute slash commands** (`f918af82`) — Add `autoExecute` boolean per SlashCommand for immediate execution on Enter.
4. **Shell inactivity timeout** (`0d29385e`) — Distinct from total timeout; resets on output events. Control via /set ephemeral or /setting.
5. **MCP server instructions** (`bc365f1e` + `844d3a4d`) — Plumb getMcpInstructions/useInstructions through config and memory system.
6. **Hook integration into scheduler/model** (`558c8ece`, `5bed9706`) — Wire hooks into coreToolScheduler and geminiChat via LLxprt hook architecture.
7. **Stats quota display** (`69188c85`) — Generic provider quota display treating Gemini like Anthropic/Codex.
8. **A2A modelInfo propagation** (`806cd112`) — Port through private A2A architecture.
9. **JIT context manager** (`752a5214`) — Settings/config/service wiring around existing memoryDiscovery.
10. **Stdio hardening** (`f9997f92`) — Selective adoption of createWorkingStdio intent via LLxprt createInkStdio.
11. **Shell env sanitization** (`8872ee0a`) — CI env cleanup preserving LLXPRT_TEST variables.

## Notable conflict hotspots

- `packages/core/src/config/config.ts` — multiple features touch settings.
- `packages/core/src/tools/mcp-client.ts` — MCP auth header injection.
- `packages/core/src/hooks/hookRunner.ts` — EPIPE fix.
- Prompt template files — interactive/non-interactive + model-specific variants.
- `packages/cli/src/ui/commands/types.ts` — autoExecute field.

## Validation

- All 66 upstream SHAs represented exactly once.
- v2 revision history documented in CHERRIES.md.
