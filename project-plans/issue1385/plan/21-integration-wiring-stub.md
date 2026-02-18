# Phase 21: Integration Wiring — Stub

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P21`

## Prerequisites
- Required: Phase 20a completed
- Verification: `test -f project-plans/issue1385/.completed/P20a.md`
- Expected files:
  - `packages/cli/src/ui/commands/continueCommand.ts` (impl from P20)
  - `packages/cli/src/ui/components/SessionBrowserDialog.tsx` (impl from P17)
  - `packages/cli/src/ui/commands/types.ts` (DialogType updated in P18)

## Requirements Implemented (Expanded)

### REQ-DI-001: DialogType Extension
**Status**: COMPLETED in P18 (continue-command-stub)
**Verification**: This phase verifies that 'sessionBrowser' exists in DialogType.
The command processor depends on this to route to the browser dialog.

### REQ-DI-002: UIState Extension
**Full Text**: The system shall add `isSessionBrowserDialogOpen: boolean` to UIState.
**Behavior**:
- GIVEN: UIState interface exists
- WHEN: isSessionBrowserDialogOpen is added
- THEN: DialogManager can conditionally render the browser

### REQ-DI-003: UIActions Extension
**Full Text**: The system shall add `openSessionBrowserDialog()` and `closeSessionBrowserDialog()` to UIActions.

### REQ-DI-004: DialogManager Rendering
**Full Text**: DialogManager shall render SessionBrowserDialog when isSessionBrowserDialogOpen is true.

### REQ-DI-005: SlashCommandProcessor Handling
**Full Text**: The command processor's dialog-open switch shall handle 'sessionBrowser' by calling openSessionBrowserDialog().

### REQ-DI-006: BuiltinCommandLoader Registration
**Full Text**: Register continueCommand in BuiltinCommandLoader.registerBuiltinCommands().

### REQ-SM-001: Session Metadata Type
**Full Text**: SessionRecordingMetadata interface with sessionId, filePath, startTime, isResumed.

### REQ-SM-002: Metadata Populated at Startup
**Full Text**: Metadata is populated from existing recording service during app startup.

### REQ-SM-003: Metadata Updated on Resume
**Full Text**: Metadata is updated when a session is resumed.

## Implementation Tasks

### Files to Modify (Stub Changes)

1. **`packages/cli/src/ui/contexts/UIStateContext.tsx`**
   - ADD `isSessionBrowserDialogOpen: boolean` to UIState interface (default: `false`)
   - ADD: `@plan PLAN-20260214-SESSIONBROWSER.P21`

2. **`packages/cli/src/ui/contexts/UIActionsContext.tsx`**
   - ADD `openSessionBrowserDialog: () => void` to UIActions interface
   - ADD `closeSessionBrowserDialog: () => void` to UIActions interface
   - ADD: `@plan PLAN-20260214-SESSIONBROWSER.P21`

3. **`packages/cli/src/ui/hooks/slashCommandProcessor.ts`**
   - ADD case `'sessionBrowser'` to the dialog-open switch (stub: no-op or call openSessionBrowserDialog)
   - ADD: `@plan PLAN-20260214-SESSIONBROWSER.P21`

4. **`packages/cli/src/services/BuiltinCommandLoader.ts`**
   - ADD import for `continueCommand`
   - ADD `continueCommand` to the commands array
   - ADD: `@plan PLAN-20260214-SESSIONBROWSER.P21`

5. **`packages/cli/src/ui/components/DialogManager.tsx`**
   - ADD import for `SessionBrowserDialog`
   - ADD conditional rendering block for `uiState.isSessionBrowserDialogOpen`
   - Stub: render `<Text>Session Browser (integration stub)</Text>`
   - ADD: `@plan PLAN-20260214-SESSIONBROWSER.P21`

### Files to Create

6. **`packages/cli/src/ui/types/SessionRecordingMetadata.ts`**
   - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P21`
   - MUST include: `@requirement REQ-SM-001`
   - Export `SessionRecordingMetadata` interface

```typescript
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P21
 * @requirement REQ-SM-001
 */
export interface SessionRecordingMetadata {
  sessionId: string;
  filePath: string | null;
  startTime: string;
  isResumed: boolean;
}
```

## Verification Commands

```bash
# UIState has new field
grep "isSessionBrowserDialogOpen" packages/cli/src/ui/contexts/UIStateContext.tsx || echo "FAIL"

# UIActions has new methods
grep "openSessionBrowserDialog" packages/cli/src/ui/contexts/UIActionsContext.tsx || echo "FAIL"
grep "closeSessionBrowserDialog" packages/cli/src/ui/contexts/UIActionsContext.tsx || echo "FAIL"

# slashCommandProcessor handles sessionBrowser
grep "sessionBrowser" packages/cli/src/ui/hooks/slashCommandProcessor.ts || echo "FAIL"

# BuiltinCommandLoader registers resume
grep "continueCommand" packages/cli/src/services/BuiltinCommandLoader.ts || echo "FAIL"

# DialogManager imports SessionBrowserDialog
grep "SessionBrowserDialog" packages/cli/src/ui/components/DialogManager.tsx || echo "FAIL"

# Metadata type exists
test -f packages/cli/src/ui/types/SessionRecordingMetadata.ts || echo "FAIL"
grep "SessionRecordingMetadata" packages/cli/src/ui/types/SessionRecordingMetadata.ts || echo "FAIL"

# Plan markers in modified files
grep "@plan PLAN-20260214-SESSIONBROWSER.P21" packages/cli/src/ui/contexts/UIStateContext.tsx || echo "FAIL"
grep "@plan PLAN-20260214-SESSIONBROWSER.P21" packages/cli/src/services/BuiltinCommandLoader.ts || echo "FAIL"

# TypeScript compiles
cd packages/cli && npx tsc --noEmit
```

## Success Criteria
- All 6 integration touchpoints have stub changes
- `SessionRecordingMetadata` type exported
- `continueCommand` registered in BuiltinCommandLoader
- DialogManager has a rendering block (even if stub)
- TypeScript compiles

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/contexts/UIStateContext.tsx
git checkout -- packages/cli/src/ui/contexts/UIActionsContext.tsx
git checkout -- packages/cli/src/ui/hooks/slashCommandProcessor.ts
git checkout -- packages/cli/src/services/BuiltinCommandLoader.ts
git checkout -- packages/cli/src/ui/components/DialogManager.tsx
rm -f packages/cli/src/ui/types/SessionRecordingMetadata.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P21.md`
