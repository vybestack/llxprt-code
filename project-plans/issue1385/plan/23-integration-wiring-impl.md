# Phase 23: Integration Wiring — Implementation

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P23`

## Prerequisites
- Required: Phase 22a completed
- Verification: `test -f project-plans/issue1385/.completed/P22a.md`
- Expected files:
  - All stubs from P21
  - `packages/cli/src/ui/__tests__/integrationWiring.spec.ts` (tests from P22)

## Requirements Implemented

This phase completes the integration wiring to make all P22 tests pass.

### REQ-DI-001: DialogType already done in P18
### REQ-DI-002: UIState.isSessionBrowserDialogOpen
### REQ-DI-003: UIActions open/close
### REQ-DI-004: DialogManager rendering
### REQ-DI-005: slashCommandProcessor handling
### REQ-DI-006: BuiltinCommandLoader registration
### REQ-SM-001: SessionRecordingMetadata type (already done in P21)
### REQ-SM-002: Metadata populated at startup
### REQ-SM-003: Metadata updated on resume

## Implementation Tasks

### 1. UIState Implementation (pseudocode integration-wiring.md lines 15-25)
In `UIStateContext.tsx`:
- Add `isSessionBrowserDialogOpen: false` to default state
- Ensure reducer handles OPEN_SESSION_BROWSER / CLOSE_SESSION_BROWSER actions

### 2. UIActions Implementation (pseudocode integration-wiring.md lines 30-45)
In `UIActionsContext.tsx`:
- Implement `openSessionBrowserDialog()`: sets `isSessionBrowserDialogOpen: true`
- Implement `closeSessionBrowserDialog()`: sets `isSessionBrowserDialogOpen: false`
- Follow existing open/close pattern for other dialogs

### 3. DialogManager — Full Rendering (pseudocode integration-wiring.md lines 50-80)
In `DialogManager.tsx`:
- Replace stub with real rendering
- Import `SessionBrowserDialog` from `./SessionBrowserDialog.js`
- Add conditional block:
```tsx
if (uiState.isSessionBrowserDialogOpen) {
  return (
    <SessionBrowserDialog
      chatsDir={chatsDir}
      projectHash={projectHash}
      currentSessionId={currentSessionId}
      hasActiveConversation={hasActiveConversation}
      onSelect={handleSessionResume}
      onClose={() => actions.closeSessionBrowserDialog()}
    />
  );
}
```
- `handleSessionResume` calls `performResume()`, updates recording state, restores history
- Prop computation follows existing dialog prop plumbing pattern

### 4. slashCommandProcessor — Dialog Handling (pseudocode integration-wiring.md lines 85-100)
In `slashCommandProcessor.ts`:
- In the dialog-open switch, add:
```typescript
case 'sessionBrowser':
  actions.openSessionBrowserDialog();
  break;
```

### 5. BuiltinCommandLoader — Registration (pseudocode integration-wiring.md lines 105-115)
Already stubbed in P21. Verify `continueCommand` is in the returned array.

### 6. Session Metadata Lifecycle (pseudocode integration-wiring.md lines 120-150)
In `AppContainer.tsx` or `gemini.tsx`:
- Create React state for `SessionRecordingMetadata`
- Populate during startup from recording service initialization
- Update during resume flow (from `performResume()` result)
- Pass to `DialogManager` for prop plumbing to `SessionBrowserDialog`
- Pass to `statsCommand` context for display

### Key Integration Points

1. **DialogManager → SessionBrowserDialog**: Props plumbing (chatsDir, projectHash, currentSessionId from config/recording state)
2. **DialogManager → performResume**: `onSelect` callback calls performResume, handles result
3. **AppContainer → Recording State**: Recording service, lock handle, and metadata as React state
4. **slashCommandProcessor → UIActions**: Dialog action routes to openSessionBrowserDialog
5. **Recording swap → React state update**: After successful resume, update recording state (service, lock, metadata)

### Files to Modify
- `packages/cli/src/ui/contexts/UIStateContext.tsx` — real reducer/state
- `packages/cli/src/ui/contexts/UIActionsContext.tsx` — real open/close
- `packages/cli/src/ui/components/DialogManager.tsx` — real rendering with props
- `packages/cli/src/ui/hooks/slashCommandProcessor.ts` — dialog case
- `packages/cli/src/services/BuiltinCommandLoader.ts` — already done in P21
- `packages/cli/src/ui/AppContainer.tsx` — recording state management
- ADD: `@plan PLAN-20260214-SESSIONBROWSER.P23`

### Do NOT Modify
- `packages/cli/src/ui/__tests__/integrationWiring.spec.ts` — tests must pass unmodified
- `packages/cli/src/ui/commands/continueCommand.ts` — already complete
- `packages/cli/src/services/performResume.ts` — already complete
- `packages/cli/src/ui/hooks/useSessionBrowser.ts` — already complete
- `packages/cli/src/ui/components/SessionBrowserDialog.tsx` — already complete

## Verification Commands

```bash
# All integration tests pass (note .spec.ts)
cd packages/cli && npx vitest run src/ui/__tests__/integrationWiring.spec.ts
# Expected: ALL PASS

# Tests unchanged
git diff --name-only packages/cli/src/ui/__tests__/integrationWiring.spec.ts
# Expected: no output

# Deferred implementation detection
for f in packages/cli/src/ui/contexts/UIStateContext.tsx packages/cli/src/ui/contexts/UIActionsContext.tsx packages/cli/src/ui/components/DialogManager.tsx packages/cli/src/ui/hooks/slashCommandProcessor.ts; do
  grep -n "TODO\|FIXME\|HACK\|STUB" "$f" && echo "FAIL in $f"
done
echo "OK"

# Full test suite
npm run test 2>&1 | tail -5

# TypeScript compiles
npm run typecheck
```

## Success Criteria
- All P22 tests pass without modification
- `/continue` → dialog open → SessionBrowserDialog rendered with real props
- Recording state managed as React state
- Metadata lifecycle works (startup → resume → update)
- Existing dialogs unaffected
- TypeScript compiles

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/contexts/UIStateContext.tsx
git checkout -- packages/cli/src/ui/contexts/UIActionsContext.tsx
git checkout -- packages/cli/src/ui/components/DialogManager.tsx
git checkout -- packages/cli/src/ui/hooks/slashCommandProcessor.ts
git checkout -- packages/cli/src/ui/AppContainer.tsx
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P23.md`
