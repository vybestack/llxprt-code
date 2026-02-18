# Phase 20: /continue Command — Implementation

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P20`

## Prerequisites
- Required: Phase 19a completed
- Verification: `test -f project-plans/issue1385/.completed/P19a.md`
- Expected files:
  - `packages/cli/src/ui/commands/continueCommand.ts` (stub from P18)
  - `packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts` (tests from P19)
  - `packages/cli/src/services/performResume.ts` (impl from P11)
  - `packages/cli/src/ui/commands/types.ts` (DialogType updated in P18)

## Requirements Implemented

This phase makes all P19 tests pass by implementing the `/continue` command action.

### REQ-EN-001: /continue opens browser
### REQ-EN-002: /continue latest direct resume
### REQ-EN-003: /continue <ref> direct resume
### REQ-RC-001 through REQ-RC-013: All command behaviors
### REQ-CV-001: Client history conversion via restoreHistory
### REQ-CV-002: UI history conversion via iContentToHistoryItems

**NOTE**: REQ-MP-004 (in-flight request check) is NOT implemented in the command.
The slashCommandProcessor already blocks input during model processing (isProcessing state
in useSlashCommandProcessor hook). No other command checks isProcessing, and we follow
the same pattern.

## Implementation Tasks

### Algorithm (from pseudocode continue-command.md lines 45-120)

```
ACTION continueCommand(ctx, args):
  1. GET config from ctx.services.config — GUARD if null
  2. PARSE args: trim whitespace
  3. IF no args:
     a. CHECK interactive: if !config.isInteractive() → error "Session browser requires interactive mode."
     b. RETURN { type: 'dialog', dialog: 'sessionBrowser' }
  4. IF args present (direct resume path):
     a. GET currentSessionId from config.getSessionId()
     b. CHECK same-session: if ref matches currentSessionId → error "That session is already active."
     c. CHECK active conversation in non-interactive: derive from geminiClient state
        - If non-interactive with active conversation → error
     d. RETURN { type: 'perform_resume', sessionRef: args }
        - slashCommandProcessor handles this action type
        - Processor has access to AppContainer refs → builds RecordingSwapCallbacks
        - Processor calls performResume() and converts result to load_history or message
```

**Why 'perform_resume' action?** The command cannot access RecordingSwapCallbacks directly
(they're in AppContainer refs, not CommandContext). The slashCommandProcessor CAN access
these via its closure over AppContainer state. This follows the same pattern as other
actions that need AppContainer state (e.g., dialog opening).

### Files to Modify

- `packages/cli/src/ui/commands/continueCommand.ts`
  - Replace stub action with full implementation
  - ADD: `@plan PLAN-20260214-SESSIONBROWSER.P20`
  - Import `performResume`, `PerformResumeResult` from `../../services/performResume.js`
  - Import `iContentToHistoryItems` from `../utils/iContentToHistoryItems.js`
  - Import `SessionDiscovery`, `getProjectHash` from `@vybestack/llxprt-code-core`
  - Import `path` for joining chatsDir path

### Tab Completion Implementation (pseudocode continue-command.md lines 105-125)

```typescript
completer: async (ctx: CommandContext) => {
  const completions = [{ value: 'latest', description: 'Most recent session' }];
  try {
    const sessions = await SessionDiscovery.listSessions(chatsDir, projectHash);
    for (const session of sessions.slice(0, 10)) {
      completions.push({
        value: session.sessionId.slice(0, 12),
        description: `${session.provider}/${session.model}`,
      });
    }
  } catch {
    // Completion failures are non-fatal
  }
  return completions;
},
```

### Key Integration Points

1. **slashCommandProcessor** — Handles 'perform_resume' action type, has access to RecordingSwapCallbacks
2. **performResume()** — Handles session resolution, lock checking, replay, recording swap (called by processor)
3. **iContentToHistoryItems()** — Converts IContent[] to HistoryItemWithoutId[] for UI (called by processor)
4. **config.getSessionId()** — Provides current session ID for same-session check
5. **config.isInteractive()** — Interactive mode check
6. **config.getGeminiClient()?.hasChatInitialized()** — Check for active conversation (for non-interactive error)

### Do NOT Modify
- `packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts` — tests must pass unmodified
- `packages/cli/src/services/performResume.ts` — already complete
- `packages/cli/src/ui/hooks/useSessionBrowser.ts` — already complete

## Verification Commands

```bash
# All tests pass
cd packages/cli && npx vitest run src/ui/commands/__tests__/continueCommand.spec.ts
# Expected: ALL PASS

# Tests unchanged
git diff --name-only packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts
# Expected: no output

# Plan markers
grep "@plan PLAN-20260214-SESSIONBROWSER.P20" packages/cli/src/ui/commands/continueCommand.ts || echo "FAIL"

# Uses performResume
grep "performResume" packages/cli/src/ui/commands/continueCommand.ts || echo "FAIL"

# Uses iContentToHistoryItems
grep "iContentToHistoryItems" packages/cli/src/ui/commands/continueCommand.ts || echo "FAIL"

# Deferred implementation detection
grep -n "TODO\|FIXME\|HACK\|STUB\|XXX" packages/cli/src/ui/commands/continueCommand.ts && echo "FAIL" || echo "OK"

# Full test suite
npm run test 2>&1 | tail -5
```

## Success Criteria
- All P19 tests pass without modification
- Command correctly routes no-args → dialog, args → direct
- All error conditions handled with clear messages
- Tab completion returns session list
- TypeScript compiles

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/commands/continueCommand.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P20.md`
