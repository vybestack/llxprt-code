# Phase 18: /continue Command — Stub

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P18`

## Prerequisites
- Required: Phase 17a completed
- Verification: `test -f project-plans/issue1385/.completed/P17a.md`
- Expected files:
  - `packages/cli/src/ui/components/SessionBrowserDialog.tsx` (impl from P17)
  - `packages/cli/src/services/performResume.ts` (impl from P11)

## Requirements Implemented (Expanded)

### REQ-RC-001: /continue latest
**Full Text**: When the user types `/continue latest`, the system shall resume the most recent unlocked, non-current, non-empty session without opening the browser.
**Behavior**:
- GIVEN: User types `/continue latest`
- WHEN: Command executes
- THEN: Most recent resumable session is resumed directly

### REQ-RC-003: /continue <session-id>
**Full Text**: When the user types `/continue <session-id>`, the system shall resume the session matching the full ID or unique prefix.

### REQ-RC-004: /continue <number>
**Full Text**: When the user types `/continue <number>`, the system shall resume the Nth session (1-based, newest-first).

### REQ-RC-009: Same-Session Check
**Full Text**: If the referenced session is the current active session, return "That session is already active."

### REQ-RC-012: Non-Interactive No-Args
**Full Text**: When `/continue` with no arguments is invoked in non-interactive mode, return error.

### REQ-RC-013: Tab Completion
**Full Text**: The `/continue` command shall provide tab completion with "latest" plus session previews.

### REQ-EN-001: /continue Opens Browser
**Full Text**: `/continue` with no args returns OpenDialogActionReturn to open browser.

### REQ-EN-002: /continue latest Direct Resume
**Full Text**: `/continue latest` resumes directly, no browser.

### REQ-EN-003: /continue <ref> Direct Resume
**Full Text**: `/continue <ref>` resumes directly.

### REQ-DI-001: DialogType Extension
**Full Text**: Add 'sessionBrowser' to the DialogType union.

### REQ-DI-007: PerformResumeActionReturn Type
**Full Text**: Add a new action return type for the command to delegate resume execution to the processor.
**Why This Matters**: The command cannot call performResume() directly because it lacks access to
RecordingSwapCallbacks (which are in AppContainer). The processor receives this action type and
handles the actual resume flow with proper callback access.

## Implementation Tasks

### Files to Create

- `packages/cli/src/ui/commands/continueCommand.ts`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P18`
  - MUST include: `@requirement REQ-RC-001, REQ-EN-001`
  - MUST include: `@pseudocode continue-command.md`
  - Export `continueCommand: SlashCommand`
  - Stub: action returns `{ type: 'message', messageType: 'info', content: 'Not yet implemented' }`

### Type Definitions

```typescript
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P18
 * @requirement REQ-RC-013
 */
const continueSchema: CommandArgumentSchema = [
  {
    kind: 'value' as const,
    name: 'session',
    description: 'Session ID, index, or "latest"',
    completer: async (_ctx: CommandContext) => {
      return [{ value: 'latest', description: 'Most recent session' }];
    },
  },
];
```

### Command Definition (Stub)

```typescript
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P18
 * @requirement REQ-EN-001, REQ-RC-001
 * @pseudocode continue-command.md lines 10-16
 */
export const continueCommand: SlashCommand = {
  name: 'continue',
  description: 'Browse and resume previous sessions',
  kind: CommandKind.BUILT_IN,
  schema: continueSchema,
  action: async (_ctx: CommandContext, _args: string): Promise<SlashCommandActionReturn> => {
    return { type: 'message', messageType: 'info', content: 'Not yet implemented' };
  },
};
```

### Files to Modify

- `packages/cli/src/ui/commands/types.ts`
  - ADD `'sessionBrowser'` to `DialogType` union
  - ADD `PerformResumeActionReturn` interface:
    ```typescript
    export interface PerformResumeActionReturn {
      type: 'perform_resume';
      sessionRef: string;
    }
    ```
  - ADD `PerformResumeActionReturn` to `SlashCommandActionReturn` union
  - ADD: `@plan PLAN-20260214-SESSIONBROWSER.P18`

## Verification Commands

```bash
# File exists
test -f packages/cli/src/ui/commands/continueCommand.ts || echo "FAIL"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P18" packages/cli/src/ui/commands/continueCommand.ts
# Expected: 2+

# Command exported
grep "export.*continueCommand" packages/cli/src/ui/commands/continueCommand.ts || echo "FAIL"

# DialogType updated
grep "sessionBrowser" packages/cli/src/ui/commands/types.ts || echo "FAIL"

# Command has correct kind (BUILT_IN, not Standard which doesn't exist)
grep "CommandKind.BUILT_IN" packages/cli/src/ui/commands/continueCommand.ts || echo "FAIL"

# Schema defined
grep "continueSchema" packages/cli/src/ui/commands/continueCommand.ts || echo "FAIL"

# TypeScript compiles
cd packages/cli && npx tsc --noEmit
```

## Success Criteria
- `continueCommand` exported with correct SlashCommand shape
- DialogType union includes 'sessionBrowser'
- Tab completion schema defined
- TypeScript compiles

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/commands/continueCommand.ts
git checkout -- packages/cli/src/ui/commands/types.ts
rm -f packages/cli/src/ui/commands/continueCommand.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P18.md`
