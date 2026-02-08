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

## Interactive Shell Feature - COMPLETED

During StickyHeader integration research, discovered that upstream has a significant feature. This has now been implemented:

**Commits Applied:**
- `6df7e5f99` - feat(shell): Add interactive shell UI support (181898cb) - Phases 1-3
- `612101d0c` - feat(shell): Complete Interactive Shell Phase 4 wiring
- `18cb40ceb` - feat(shell): Port AnsiOutput rendering from upstream for PTY mode
- `8fdfcd3e0` - fix(shell): Pass AnsiOutput directly to resultDisplay instead of stringifying
- `8b4ba4cbc` - fix(shell): Sync AnsiOutput component with upstream to fix dimColor and color handling
- `0dc3c0317` - fix(shell): Add full AnsiOutput type support through tool execution chain

**What was implemented:**
- `terminalSerializer.ts` - Serializes xterm buffer to AnsiOutput
- `AnsiOutput.tsx` - Renders ANSI-styled output in Ink
- `ShellInputPrompt.tsx` - Input prompt for focused shell
- `keyToAnsi.ts` - Converts keypresses to ANSI sequences
- UI integration for shell focus state (embeddedShellFocused)
- Config.getEnableInteractiveShell() returning shouldUseNodePtyShell setting
- `ShellExecutionConfig` interface for terminal dimensions and options
- `SCROLLBACK_LIMIT` constant (300k lines) for large outputs
- AnsiOutput emission from ShellExecutionService when PTY mode active

**Issues discovered and fixed:**
1. Original implementation was emitting plain strings instead of AnsiOutput. Fixed in commit `18cb40ceb`:
   - `serializeTerminalToObject()` integration in ShellExecutionService
   - Proper `render()` and `renderFn()` pattern from upstream
   - Terminal dimensions passed through useGeminiStream

2. resultDisplay was being JSON.stringify'd instead of passed as AnsiOutput. Fixed in commit `8fdfcd3e0`:
   - Removed conditional JSON.stringify wrapper
   - AnsiOutput now passed directly to ToolMessage component
   
3. AnsiOutput component was missing dimColor prop and had incorrect color handling. Fixed in commit `8b4ba4cbc`:
   - Added `dimColor={token.dim}` prop
   - Removed `color=""` from outer Text (was overriding token colors)
   - Removed `|| ''` fallback on color prop (was causing issues)

4. Type system didn't support AnsiOutput through execution chain. Fixed in commit `0dc3c0317`:
   - Updated OutputUpdateHandler type to accept `string | AnsiOutput`
   - Updated ExecutingToolCall.liveOutput type
   - Updated ToolInvocation.execute() and buildAndExecute() signatures
   - Updated shell.ts execute method signature
   - Updated shellCommandProcessor.ts setPendingHistoryItem
   - Updated useReactToolScheduler.ts updatePendingHistoryItem and updateToolCallOutput
   - Updated schedulerSingleton.ts SchedulerCallbacks interface
   - Updated subagent.ts to convert AnsiOutput to text for message display
   - Updated a2a-server/task.ts to convert AnsiOutput to text for A2A protocol
   - Fixed AnsiOutput.tsx lint errors (add Colors.Foreground, remove dimColor prop)

---

## Settings Scope Fix - COMPLETED

**Commit:** `c0202daea` - fix(settings): Exclude Session scope from forScope() iteration

Fixed `/settings` command crash where iterating over all scopes would try to call `forScope(Session)` which is not supported. Now excludes Session scope from the iteration.

---

## Conflicts Encountered

None - all changes applied cleanly or were skipped appropriately.

---

## Deviations from Plan

1. **Batch 4 entirely skipped**: Research found all three features (ThemedGradient, animated scroll, drag scrollbar) were already implemented in LLxprt from previous sync or independent development.

2. **Telemetry updates skipped in Batch 5**: The upstream commit also updates recordContentRetry and recordContentRetryFailure to pass error_type, but LLxprt has a different telemetry structure. The core functionality (MALFORMED_FUNCTION_CALL detection and retry) is implemented.

3. **ShellExecutionResult interface change**: Removed `stdout` and `stderr` fields since PTY mode combines output streams. Updated test files accordingly.

---

## Ctrl+F Interactive Shell Fix Plan - READY

Created detailed implementation plan for fixing the Ctrl+F interactive shell feature. When the LLM invokes the shell tool (e.g., `bash` with no arguments), pressing Ctrl+F should toggle focus to that shell so the user can type commands that get sent to the PTY.

**Plan location:** `INTERACTIVE_SHELL_FIX_PLAN.md`

**Root cause:** `ptyId` is never set on `IndividualToolCallDisplay` for LLM-invoked shell tools because there's no mechanism to propagate PID from ShellExecutionService through the scheduler to the UI.

**Key changes:**
1. Add `pid?: number` to `ExecutingToolCall` type
2. Add `setPidCallback` parameter to `ToolInvocation.execute()` interface
3. Add `isActivePty(pid)` method to `ShellExecutionService`
4. Update `shell.ts` to call setPidCallback with PID after isActivePty check
5. Map `pid` to `ptyId` in `useReactToolScheduler.ts`

**Plan verified by deepthinker:** Ready for implementation.

**Files to modify:**
- packages/core/src/tools/tools.ts
- packages/core/src/core/coreToolScheduler.ts
- packages/core/src/services/shellExecutionService.ts
- packages/core/src/tools/shell.ts
- packages/core/src/tools/ast-edit.ts (direct ToolInvocation implementations)
- packages/core/src/tools/tools.test.ts (test implementation)
- packages/cli/src/ui/hooks/useReactToolScheduler.ts
