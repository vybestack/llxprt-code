# Phase 24: /stats Session Section — Stub

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P24`

## Prerequisites

- Required: Phase 23 completed and verified
- Verification: `test -f project-plans/issue1385/.completed/P23a.md`
- Expected files from previous phase:
  - `packages/cli/src/ui/contexts/UIStateContext.tsx` — modified with `isSessionBrowserDialogOpen`
  - `packages/cli/src/ui/contexts/UIActionsContext.tsx` — modified with open/close session browser
  - `packages/cli/src/ui/components/DialogManager.tsx` — renders `SessionBrowserDialog`
  - `packages/cli/src/ui/types/SessionRecordingMetadata.ts` — created in P21
- Preflight verification: Phase 0.5 completed

## Requirements Implemented (Expanded)

### REQ-ST-001: /stats Session Section
**Full Text**: The `/stats` command shall include a "Session" section in its output.
**Behavior**:
- GIVEN: The user has an active session
- WHEN: The user runs `/stats`
- THEN: The output includes a "Session" section with session recording info
**Why This Matters**: Users need visibility into their session recording state to understand their recording context.

### REQ-ST-006: No Active Session Fallback
**Full Text**: If no session recording is active, the section shall display "No active session recording."
**Behavior**:
- GIVEN: No session recording is active (metadata is null)
- WHEN: The user runs `/stats`
- THEN: The session section displays "No active session recording."
**Why This Matters**: Clear indication when recording is not active prevents confusion.

## Implementation Tasks

### Files to Create

- `packages/cli/src/ui/commands/formatSessionSection.ts` — Stub for the session stats formatter
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P24`
  - MUST include: `@requirement:REQ-ST-001`
  - Exports `formatSessionSection(metadata: SessionRecordingMetadata | null): Promise<string[]>`
  - Stub: throws `new Error('NotYetImplemented')` or returns empty array

### Files to Modify

- `packages/cli/src/ui/commands/statsCommand.ts`
  - Import `formatSessionSection`
  - Import `SessionRecordingMetadata` type
  - In `defaultSessionView()`, add call to `formatSessionSection(context.session.recordingMetadata ?? null)` after existing stats display
  - The stats action must become `async` (it already is for the quota subcommand, but `defaultSessionView` is currently sync — it will need to be made async or the section appended separately)
  - ADD comment: `@plan PLAN-20260214-SESSIONBROWSER.P24`

### Required Code Markers

Every function/class/test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P24
 * @requirement REQ-ST-001
 * @pseudocode stats-session-section.md lines 12-44
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist
grep -r "@plan PLAN-20260214-SESSIONBROWSER.P24" packages/cli/src/ | wc -l
# Expected: 2+ occurrences (formatSessionSection.ts + statsCommand.ts)

# Check the stub file exists
test -f packages/cli/src/ui/commands/formatSessionSection.ts && echo "OK" || echo "MISSING"

# Check formatSessionSection is imported in statsCommand
grep "formatSessionSection" packages/cli/src/ui/commands/statsCommand.ts
# Expected: import line present

# TypeScript compiles
npm run typecheck
# Expected: Pass

# No TODO in production code
grep -rn "TODO" packages/cli/src/ui/commands/formatSessionSection.ts
# Expected: No matches
```

### Structural Verification Checklist

- [ ] Previous phase markers present (P23)
- [ ] `formatSessionSection.ts` created with correct export signature
- [ ] `statsCommand.ts` imports the function
- [ ] TypeScript compiles cleanly
- [ ] No `TODO` markers in stub code
- [ ] Plan and requirement markers added to all changes

### Semantic Verification Checklist (MANDATORY)

1. **Does the stub define the correct API surface?**
   - [ ] `formatSessionSection` accepts `SessionRecordingMetadata | null`
   - [ ] Returns `Promise<string[]>`
   - [ ] Function is exported

2. **Is this a proper stub (not implementation)?**
   - [ ] Either throws NotYetImplemented or returns empty/minimal value
   - [ ] No business logic implemented

3. **Is the function reachable from existing code?**
   - [ ] `statsCommand.ts` calls `formatSessionSection`
   - [ ] The call site passes the right argument type

## Success Criteria

- `formatSessionSection.ts` exists with correct type signature
- `statsCommand.ts` imports and calls the function (even if result is discarded in stub)
- TypeScript compiles

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/ui/commands/formatSessionSection.ts`
2. `git checkout -- packages/cli/src/ui/commands/statsCommand.ts`
3. Re-run Phase 24 with corrected approach

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P24.md`
Contents:
```markdown
Phase: P24
Completed: YYYY-MM-DD HH:MM
Files Created: [list with line counts]
Files Modified: [list with diff stats]
Tests Added: 0 (stub phase)
Verification: [paste of verification command outputs]
```
