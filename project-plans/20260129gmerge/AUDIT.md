# Audit: v0.15.4 → v0.16.0 Cherry-Pick

**Branch:** `20260129gmerge`
**Upstream range:** `v0.15.4..v0.16.0`
**Completed:** 2026-01-29

---

## Reconciliation Table

| Upstream SHA | Decision | LLxprt Commit(s) | Notes |
|--------------|----------|------------------|-------|
| e8038c727 | SKIP | N/A | Test file deleted in LLxprt |
| d3cf28eb4 | PICK | 1587bf8f0 | Use PascalCase for tool display names |
| cab9b1f37 | PICK | 1587bf8f0 | Fix extensions await handler |
| 1c8fe92d0 | PICK | 1587bf8f0 | Hook Result Aggregation |
| 1c87e7cd2 | SKIP | N/A | RipGrep - LLxprt uses @lvce-editor/ripgrep |
| 1ffb9c418 | PICK | 1587bf8f0 | FileCommandLoader abort fix |
| 540f60696 | SKIP | N/A | LLxprt keeps read-many-files tool |
| 4d85ce40b | SKIP | N/A | console.clear() buffer fix already in LLxprt |
| 0075b4f11 | SKIP | N/A | ToolsList.tsx deleted in LLxprt |
| aa9922bc9 | PICK | 29ac8b252 | Keyboard shortcuts docs autogen |
| ad1f0d995 | PICK | 29ac8b252 | toml-loader test refactor |
| a810ca80b | PICK | 29ac8b252 | Reset to auto in fallback mode |
| 43916b98a | PICK | 29ac8b252 | Buffer cleanup fix |
| 13d8d9477 | PICK | 29ac8b252 | Editor setting immediate update |
| 11a0a9b91 | SKIP | N/A | clearcut-logger telemetry |
| 408b88568 | SKIP | N/A | clearcut telemetry |
| c961f2740 | SKIP | N/A | Version bump |
| 396b427cc | SKIP | N/A | Version bump |
| 570ccc7da | SKIP | N/A | code_assist metadata |
| 7ec78452e | SKIP | N/A | Different todo system |
| d26b828ab | SKIP | N/A | Gemini-specific model config |
| 2987b473d | SKIP | N/A | Gemini-specific model config |
| a05e0ea3a | SKIP | N/A | Version bump |
| 0f9ec2735 | SKIP | N/A | Already have useAlternateBuffer=true |
| 1ed163a66 | SKIP | N/A | Safety checker - security theater, sandbox is real protection |
| fe1bfc64f | SKIP | N/A | ASCII art branding |
| 102905bbc | SKIP | N/A | ASCII art normalization |
| 54c1e1385 | SKIP | N/A | Package lock only |
| 5d27a62be | SKIP | N/A | LLxprt keeps read-many-files |
| 48e3932f6 | SKIP | N/A | Gemini auth types |
| eb9ff72b5 | SKIP | N/A | Incremental update experiment |
| 1c6568925 | SKIP | N/A | Preview release |
| 3cb670fe3 | SKIP | N/A | Selection warning - LLxprt has /mouse off |
| ea4cd98e2 | SKIP | N/A | Preview release |
| cc608b9a9 | SKIP | N/A | Google A/B testing infra |
| 6f34e2589 | SKIP | N/A | Tied to selection warning |
| dcc2a4993 | SKIP | N/A | Preview release |
| a2b66aead | SKIP | N/A | Preview release |
| 47642b2e3 | SKIP | N/A | Preview patch |
| c9e4e571d | SKIP | N/A | Preview release |
| 670f13cff | SKIP | N/A | Preview release |
| 56f9e597c | SKIP | N/A | Gemini 3 launch branding |
| aefbe6279 | SKIP | N/A | Final release |
| ee7065f66 | REIMPLEMENT | e0d9a129a | Sticky headers - StickyHeader.tsx created |
| fb99b9537 | REIMPLEMENT | e0d9a129a | Header truncation (part of StickyHeader) |
| d30421630 | REIMPLEMENT | e0d9a129a | Polish sticky headers (part of StickyHeader) |
| 3cbb170aa | NO_OP | N/A | ThemedGradient already in LLxprt |
| 60fe5acd6 | NO_OP | N/A | Animated scroll already in LLxprt |
| 2b8adf8cf | NO_OP | N/A | Drag scrollbar already in LLxprt |
| fb0324295 | REIMPLEMENT | 6bf8dbabf | MALFORMED_FUNCTION_CALL handling |

---

## Summary

| Decision | Count |
|----------|-------|
| PICKED | 9 |
| REIMPLEMENTED | 4 (in 2 commits) |
| SKIPPED | 34 |
| NO_OP | 3 (already implemented) |

**LLxprt Commits Created:**
1. `1587bf8f0` - Batch 1: 4 commits applied
2. `29ac8b252` - Batch 2: 5 commits applied  
3. `e0d9a129a` - Batch 3: StickyHeader component
4. `6bf8dbabf` - Batch 5: MALFORMED_FUNCTION_CALL handling

**Additional Work Beyond Plan:**
5. `6df7e5f99` - Interactive Shell UI support (from 181898cb)
6. `612101d0c` - Interactive Shell Phase 4 wiring
7. `e77e438e3` - StickyHeader integration in ToolGroupMessage
8. `c0202daea` - Settings Session scope fix
9. `18cb40ceb` - AnsiOutput rendering for PTY mode
10. `8fdfcd3e0` - Pass AnsiOutput directly to resultDisplay
11. `8b4ba4cbc` - Sync AnsiOutput dimColor and color handling
12. `0dc3c0317` - Full AnsiOutput type support through tool execution chain

---

## Key Architectural Decisions

1. **Safety Checker Framework**: Permanently skipped. Focus on sandbox for real security.
2. **Selection Warning**: Skipped. LLxprt has `/mouse off` as alternative UX.
3. **Sticky Headers**: Reimplemented. Created StickyHeader.tsx component.
4. **UI Improvements (Batch 4)**: Already implemented in LLxprt - no work needed.
5. **Interactive Shell**: Implemented from older upstream commit (181898cb) to enable vim, htop, less, etc.

---

## Features Already in LLxprt (NO_OP)

The following features were found to already exist in LLxprt, either from previous syncs or independent development:

1. **ThemedGradient (3cbb170aa)**: `packages/cli/src/ui/components/ThemedGradient.tsx` with tmux-safe gradient handling
2. **Animated Scroll (60fe5acd6)**: `packages/cli/src/ui/components/shared/ScrollableList.tsx` with smoothScrollTo, smoothScrollState, ANIMATION_FRAME_DURATION_MS
3. **Drag Scrollbar (2b8adf8cf)**: `packages/cli/src/ui/contexts/ScrollProvider.tsx` with dragStateRef, handleLeftPress, handleMove

---

## Interactive Shell Implementation

Implemented the Interactive Shell feature from upstream commit `181898cb`:

**Components Added:**
- `terminalSerializer.ts` - Serializes xterm buffer to AnsiOutput tokens
- `AnsiOutput.tsx` - Renders ANSI-styled output in Ink
- `ShellInputPrompt.tsx` - Input prompt for focused shell
- `keyToAnsi.ts` - Converts keypresses to ANSI sequences

**Core Changes:**
- `ShellExecutionService.ts` - Added serializeTerminalToObject() integration
- Added `ShellExecutionConfig` interface for terminal dimensions and options
- Added `SCROLLBACK_LIMIT` constant (300k lines)
- `shellCommandProcessor.ts` - Handles both string and AnsiOutput types
- `useGeminiStream.ts` - Added setShellInputFocused and terminal dimension parameters
- `AppContainer.tsx` - Passes terminal dimensions to useGeminiStream

**Behavior:**
- When PTY mode is active, emits AnsiOutput (array of token arrays) instead of plain strings
- Enables proper ANSI color/style rendering for interactive shell commands

**Bug Fixes:**
- `8fdfcd3e0` - Fixed JSON.stringify wrapper that was converting AnsiOutput to string
- `8b4ba4cbc` - Fixed missing dimColor prop and incorrect color handling in AnsiOutputText component
- `0dc3c0317` - Fixed type system to support AnsiOutput through entire execution chain:
  - Updated OutputUpdateHandler, ExecutingToolCall.liveOutput, ToolInvocation.execute() signatures
  - Updated shell.ts, shellCommandProcessor.ts, useReactToolScheduler.ts, schedulerSingleton.ts
  - Updated subagent.ts and a2a-server/task.ts to convert AnsiOutput to text
  - Fixed AnsiOutput.tsx lint errors
