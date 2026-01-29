# Notes: v0.15.4 → v0.16.0 Cherry-Pick

**Branch:** `20260129gmerge`
**Completed:** 2026-01-29

---

## Key Decisions Made During Planning

### Safety Checker Framework - PERMANENTLY SKIPPED

Commit `1ed163a66` introduces a safety checker framework. After deep research, we decided to **skip permanently** because:

1. **Shell bypass**: Only checks file tool paths. `run_shell_command` arguments bypass all path checking.
2. **Incomplete solution**: Even with later shell parsing (post-v0.16.0), it's pattern-matching whack-a-mole.
3. **Sandbox is the answer**: Container isolation (#1036) provides real security.
4. **Git not protected**: No built-in rules for dangerous git commands.
5. **Security theater**: 2600+ lines for marginal protection.

Focus instead on fixing sandbox (#1036).

### Selection Warning - SKIPPED

Commit `3cb670fe3` adds "Press Ctrl-S to enter selection mode" warning. Skipped because LLxprt already has `/mouse off` command - different UX approach, same functionality.

### Mouse Button Tracking - SKIPPED

Commit `6f34e2589` adds button field to MouseEvent. Skipped because it's primarily for selection warning feature we're skipping.

---

## Batch Execution Notes

### Batch 1
- Skipped e8038c727 (test file deleted in LLxprt)
- Skipped 1c87e7cd2 (LLxprt uses @lvce-editor/ripgrep via getRipgrepPath)
- Skipped 540f60696 (LLxprt keeps read-many-files tool)
- Applied: d3cf28eb4, cab9b1f37, 1c8fe92d0, 1ffb9c418

### Batch 2
- Skipped 4d85ce40b (console.clear buffer fix already in LLxprt)
- Skipped 0075b4f11 (ToolsList.tsx deleted in LLxprt)
- Added CoreEvent.ModelChanged and emitModelChanged() to events.ts
- Added Command enum values: SHOW_FULL_TODOS, TOGGLE_SHELL_INPUT_FOCUS, EXPAND_SUGGESTION, COLLAPSE_SUGGESTION
- Added missing commandDescriptions entries
- Applied: aa9922bc9, ad1f0d995, a810ca80b, 43916b98a, 13d8d9477

### Batch 3 (Sticky Headers)
- Created StickyHeader.tsx component
- Full integration with ToolMessage/ToolGroupMessage deferred - requires significant architecture changes
- Component ready for use when tool message refactoring happens

### Batch 4 (UI Improvements) - SKIPPED
All three features already implemented in LLxprt:
- **ThemedGradient (3cbb170aa)**: Already in packages/cli/src/ui/components/ThemedGradient.tsx with tmux-safe gradient handling
- **Animated Scroll (60fe5acd6)**: Already in ScrollableList.tsx with smoothScrollTo, smoothScrollState, ease-in-out animation
- **Drag Scrollbar (2b8adf8cf)**: Already in ScrollProvider.tsx with full drag state management (dragStateRef, handleLeftPress, handleMove)

### Batch 5 (MALFORMED_FUNCTION_CALL)
- Added MALFORMED_FUNCTION_CALL to InvalidStreamError type union
- Imported FinishReason from @google/genai
- Changed hasFinishReason boolean to finishReason: FinishReason | undefined
- Added explicit check for MALFORMED_FUNCTION_CALL to trigger retry
- Did NOT update telemetry (recordContentRetry, recordContentRetryFailure) - LLxprt has different telemetry structure

---

## Follow-ups Created

1. **StickyHeader Integration**: Need to integrate StickyHeader.tsx into ToolMessage and ToolGroupMessage components. See `STICKYHEADER-INTEGRATION-PLAN.md` for detailed plan.

2. **Interactive Shell Feature**: Major feature from upstream commit `181898cb` that enables vim, less, htop, git rebase -i, etc. to run interactively. LLxprt has PTY infrastructure but missing UI rendering layer. See `INTERACTIVE-SHELL-PLAN.md` for detailed plan.

---

## Discovery: Interactive Shell Feature

During StickyHeader integration research, discovered that upstream has a significant feature LLxprt is missing:

**Commit:** `181898cb` - feat(shell): enable interactive commands with virtual terminal (#6694)
**Date:** 2025-09-11

This feature was added early in gemini-cli's history and enables:
- Running interactive commands (vim, less, htop, git rebase -i)
- ANSI-styled output rendering via xterm.js
- Shell focus/input handling (ctrl+f to focus)

**What LLxprt already has:**
- `@lydell/node-pty` and `@xterm/headless` dependencies
- PTY spawn in ShellExecutionService
- `shouldUseNodePtyShell` setting
- `headlessTerminal` instance in ShellExecutionService

**What LLxprt is missing:**
- `terminalSerializer.ts` - Serializes xterm buffer to AnsiOutput
- `AnsiOutput.tsx` - Renders ANSI-styled output in Ink
- `ShellInputPrompt.tsx` - Input prompt for focused shell
- `keyToAnsi.ts` - Converts keypresses to ANSI sequences
- UI integration for shell focus state

This is a high-priority feature request from the user.

---

## Conflicts Encountered

None - all changes applied cleanly or were skipped appropriately.

---

## Deviations from Plan

1. **Batch 4 entirely skipped**: Research found all three features (ThemedGradient, animated scroll, drag scrollbar) were already implemented in LLxprt from previous sync or independent development.

2. **Telemetry updates skipped in Batch 5**: The upstream commit also updates recordContentRetry and recordContentRetryFailure to pass error_type, but LLxprt has a different telemetry structure. The core functionality (MALFORMED_FUNCTION_CALL detection and retry) is implemented.
