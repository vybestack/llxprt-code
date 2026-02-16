# SUMMARY.md — gmerge-0.18.4 (upstream v0.17.1 → v0.18.4)

## Overview

Syncing LLxprt Code from upstream gemini-cli **v0.17.1** to **v0.18.4**.

- **Branch**: `gmerge/0.18.4`
- **Upstream range**: 64 commits
- **Decisions**: 26 PICK · 28 SKIP · 10 REIMPLEMENT
- **Batches**: 17 (6 PICK batches + 1 PICK SOLO + 10 REIMPLEMENT batches)

## What's Coming In (PICK — 26 commits)

### Major Changes

1. **stdout/stderr protection** (`d1e35f86`) — 82 files, the largest commit. Monkey-patches `process.stdout.write`/`process.stderr.write` early in startup to capture stray output, preventing it from corrupting Ink's terminal rendering. Creates `stdio.ts` utility with `patchStdio()`, `writeToStdout()`, `createInkStdio()`. Adds `Output` and `ConsoleLog` events to `coreEvents` with backlog support. **SOLO batch, high risk.**

2. **genai 1.16 → 1.30 bump** (`25f84521`) — Dependency version bump with coupled MCP prompt loader and prompt-registry API changes.

3. **Session recording improvements** (`e1c711f5`) — Records interactive errors and warnings to chat recording JSON files.

4. **Preview features toggle** (`ade9dfee`) — Switch preview features on/off without restart.

### Keyboard / Terminal Fixes

- Keyboard code parsing + modifyOtherKeys (`b916d79f`, `90c764ce`)
- Keyboard mode restoration after editor exit (`84573992`)
- Duplicated mouse code removal (`d15970e1`)
- PTY resize error handling for Windows (`c5498bbb`)

### Bug Fixes

- `showLineNumbers` wrong default (`e8d0e0d3`)
- NO_COLOR mode crash fix (`1e8ae5b9`)
- MCP prompts with spaces (`61f0f3c2`)
- Compress threshold → 0.5 for API key users (`c7b5dcd2`)
- Thinking mode exclude gemini-2.0 (`e4c4bb26`)
- Remove unneeded log (`d0a845b6`)

### IDE / Zed Integration

- `read_many_files` available in Zed (`10003a64`)
- Cancellation error handling (`300205b0`)
- Zed classified as interactive (`6c126b9e`)
- Default model routing for Zed (`83d0bdc3`)

### Other

- CONTRIBUTING.md cleanup (`fd9d3e19`)
- MCP transport refactor (`5c475921`)
- Session utility followup (`0d89ac74`)
- Header colored on non-gradient terminals (`f8a86273`)
- write_todos typo fix (`0f845407`)
- setup-github copy commands (`4adfdad4`)
- MCP dependency bump patch (`4b19a833`)

## What's Being Reimplemented (10 commits)

### Click-to-focus + ToolMessage refactor (`2231497b`) — HIGH PRIORITY
17 files, 1071+/415−. Upstream split the monolithic `ToolMessage.tsx` into `ToolShared.tsx` + `ToolResultDisplay.tsx`, added `useMouseClick` hook, and refactored `ShellToolMessage.tsx`. LLxprt should adopt this cleaner component structure AND add click-to-focus support.

### Escape key clears input (`b644f037`)
LLxprt already handles Escape to cancel. This adds "Escape while idle = clear text" using a `shouldRestorePrompt` parameter. Must adapt to LLxprt's `() => void` cancel handler.

### Synchronous keyboard writes (`9ebf3217`)
LLxprt's `kittyProtocolDetector.ts` diverged significantly from upstream. Apply `fs.writeSync` pattern and try/catch blocks to our own restructured code. Clean up and follow upstream's pattern.

### Context overflow race condition (`b1258dd5`)
LLxprt uses `inputHistoryStore` not `userMessages`. The race condition concept (stale state during async history update) may apply but fix must use our architecture.

### Loading indicator + inactivity timer (`843b019c`)
LLxprt's usePhraseCycler/useLoadingIndicator have diverged (WittyPhraseStyle system). Upstream adds useInactivityTimer + shell focus hints. Take the new hooks while preserving LLxprt's phrase style system.

### System instruction memory reload (`1d2e27a6`)
Update system instruction when LLXPRT.md memory is reloaded. Adapt from GEMINI.md to LLXPRT.md.

### Alternate buffer default change (`316349ca`)
LLxprt already has alternate buffer (in AppContainer.tsx + inkRenderOptions.ts). Apply the default-to-false change and test helper updates.

### Banner hook extraction (`ea3d022c`)
Extract banner logic into `useBanner` hook with per-content tracking. LLxprt needs `persistentState.ts` first. Good architectural improvement.

### Extensions exitCli pattern (`013f9848`) — HIGH PRIORITY
30 files. Add `exitCli()` clean shutdown function and `initializeOutputListenersAndFlush` middleware to extensions. Depends on stdout protection (`d1e35f86`).

### stdio → core move + terminal utils (`2e8d7831`)
Move `stdio.ts` from cli to core, add `terminal.ts` utility. Take non-auth improvements, drop auth dialog changes (LLxprt's auth is completely different).

## What's Being Skipped (28 commits)

- **12 release/version bumps** — LLxprt has independent versioning
- **3 Gemini-specific docs** — gemini-3.md, model.md, Code Wiki link
- **1 ClearcutLogger** — Google telemetry removed from LLxprt
- **1 LICENSE fix** — LLxprt has own LICENSE
- **1 Banner design** — Gemini branding; LLxprt has own
- **1 FlashFallback patch** — Feature disabled/slated for removal
- **4 reverted commit pairs** — build bun + revert, model override fix + revert (net-zero)
- **1 User email in about box** — Google-specific auth telemetry / privacy concern
- **1 Gemini 3 thinking level** — LLxprt handles in provider layer, not geminiChat. See #1330
- **1 Gemini 3 thinking patch** — geminiChat thinkingLevel fix, same reason as above. See #1330
- **1 Gemini 3 model config hierarchy** — No model config infra in LLxprt. See #1329
- **1 Model config wiring** (`257cd07a`) — Incompatible with LLxprt's multi-provider routing; uses ModelConfigService/nextSpeakerChecker

## Issues Created

| Issue | Description |
| ----- | ----------- |
| [#1329](https://github.com/vybestack/llxprt-code/issues/1329) | Display model profile/provider name on each message |
| [#1330](https://github.com/vybestack/llxprt-code/issues/1330) | GeminiProvider: support thinkingLevel for Gemini 3 models |

## Gemini 3 Thinking Level Gap (from analysis)

LLxprt's `GeminiProvider.ts` reads `reasoning.effort` from ephemerals but discards it (`void reasoningEffort`). The `thinkingConfig` always uses `thinkingBudget` (numeric), never `thinkingLevel` (string: HIGH/MEDIUM/LOW). For Gemini 3 models, the API expects `thinkingLevel`. This gap is tracked in #1330 and should be fixed in the provider layer, not by cherry-picking upstream's geminiChat.ts approach.

## High-Risk Items

| Commit | Risk | Mitigation |
| ------ | ---- | ---------- |
| `d1e35f86` (stdout/stderr) | 82 files, broad test changes, touches a2a-server | Solo batch; a2a-server change is 1-line removal |
| `2231497b` (click-to-focus) | 1071+/415− massive refactor | REIMPLEMENT: adopt component structure, not blind pick |
| `013f9848` (extensions) | 30 files, depends on stdout protection | REIMPLEMENT after d1e35f86 is applied |
| `843b019c` (loading indicator) | LLxprt's WittyPhraseStyle diverged from upstream | REIMPLEMENT — keep phrase style system |
| `25f84521` (genai bump) | Major dependency version jump (1.16→1.30) | Cherry-pick; verify API compatibility |
| `2e8d7831` (stdio→core) | Auth dialog completely different | REIMPLEMENT: take non-auth parts only |

## Dependency Chain

```
d1e35f86 (stdout/stderr protection — cli/utils/stdio.ts)
    ↓
013f9848 (extensions exitCli — depends on initializeOutputListenersAndFlush)
    ↓
2e8d7831 (stdio → core move — moves stdio.ts from cli to core, adds terminal.ts)
```

These must be processed in order.
