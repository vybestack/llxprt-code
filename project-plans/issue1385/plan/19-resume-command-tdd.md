# Phase 19: /continue Command — TDD

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P19`

## Prerequisites
- Required: Phase 18a completed
- Verification: `test -f project-plans/issue1385/.completed/P18a.md`
- Expected files: `packages/cli/src/ui/commands/continueCommand.ts` (stub from P18)

## Requirements Implemented (Expanded)

### REQ-EN-001: /continue Opens Browser
**Behavior**: `/continue` with no args in interactive mode returns `{ type: 'dialog', dialog: 'sessionBrowser' }`.

### REQ-EN-002: /continue latest Direct
**Behavior**: `/continue latest` returns `{ type: 'perform_resume', sessionRef: 'latest' }`.

### REQ-EN-003: /continue <ref> Direct
**Behavior**: `/continue <ref>` returns `{ type: 'perform_resume', sessionRef: '<ref>' }`.

### REQ-RC-010: Active Conversation Confirmation (Interactive)
**Behavior**: When active conversation exists and terminal is interactive, command must check.

### REQ-RC-011: Active Conversation Rejection (Non-Interactive)
**Behavior**: Non-interactive mode with active conversation returns error.

### REQ-RC-012: Non-Interactive No-Args Error
**Behavior**: `/continue` no args in non-interactive returns error about requiring interactive mode.

### REQ-MP-004: In-Flight Request Guard
**Behavior**: If `isProcessing` is true, `/continue` returns error "Cannot resume while a request is in progress."

## Architecture Note

The `/continue` command is a **thin router**:
- It parses arguments and checks pre-conditions (interactive mode, isProcessing, active conversation)
- It returns action objects that the slashCommandProcessor handles
- Error resolution (locked, not-found, ambiguous, out-of-range) happens in `performResume()`, called by the processor

Tests for error conditions (locked, not-found, etc.) belong in P10 (performResume) and P22 (processor integration), NOT here.

## Test Cases

### File to Create
- `packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P19`

### Test Strategy

Tests exercise the command's `action()` function with a real `CommandContext`. The command returns action objects:
- `{ type: 'dialog', dialog: 'sessionBrowser' }` for no-args path
- `{ type: 'perform_resume', sessionRef }` for direct resume path
- `{ type: 'message', ... }` for pre-condition errors

**CRITICAL**: Use real temp directories with JSONL files. No mocking core APIs.

### BEHAVIORAL Tests — No-Args Path

1. **No args, interactive → open browser dialog**: Given interactive terminal with no args, returns `{ type: 'dialog', dialog: 'sessionBrowser' }`. Verified by checking `result.type === 'dialog'` and `result.dialog === 'sessionBrowser'`.

2. **No args, non-interactive → error message**: Given non-interactive terminal with no args, returns message containing "interactive mode".

### BEHAVIORAL Tests — Direct Resume Path

3. **`/continue latest` → perform_resume**: Returns `{ type: 'perform_resume', sessionRef: 'latest' }`.

4. **`/continue abc123` → perform_resume with ID**: Returns `{ type: 'perform_resume', sessionRef: 'abc123' }`.

5. **`/continue 3` → perform_resume with index**: Returns `{ type: 'perform_resume', sessionRef: '3' }`.

6. **`/continue abc` → perform_resume with prefix**: Returns `{ type: 'perform_resume', sessionRef: 'abc' }`.

### BEHAVIORAL Tests — Active Conversation Guard

7. **Active conversation, interactive → perform_resume with confirm flag**: When messages exist in current session and terminal is interactive, returned action includes `requiresConfirmation: true`.

8. **Active conversation, non-interactive → error**: When messages exist and non-interactive, returns error message about replacing conversation.

9. **No active conversation → no confirmation flag**: When no messages exist, returned action does not have confirmation flag.

### BEHAVIORAL Tests — In-Flight Request Guard (REQ-MP-004)

10. **isProcessing=true, /continue no-args → error**: Returns error "Cannot resume while a request is in progress."

11. **isProcessing=true, /continue latest → error**: Returns error "Cannot resume while a request is in progress."

12. **isProcessing=false → normal**: Command proceeds and returns expected action.

### BEHAVIORAL Tests — Tab Completion

13. **Completion includes "latest"**: Given completer called with empty input, returns array containing "latest".

14. **Completion returns session previews**: Given sessions exist, completer returns session preview strings.

15. **Completion returns empty for non-interactive**: In non-interactive mode, completer returns empty array.

### Property-Based Tests

16. **Property: non-empty args never returns dialog**: For any non-empty string argument (excluding whitespace-only), result type is never `dialog`.

17. **Property: result is always valid action type**: For any input, result has valid `type` field.

## FORBIDDEN Patterns
```typescript
// NO structural tests
expect(command.schema).toBeDefined() // FORBIDDEN
expect(command.kind).toBe(CommandKind.BUILT_IN) // FORBIDDEN

// NO mock theater
vi.mock('../services/performResume') // FORBIDDEN
expect(performResume).toHaveBeenCalledWith(...) // FORBIDDEN

// NO return-shape-only tests
expect(result).toHaveProperty('type') // FORBIDDEN without behavioral assertion
expect(typeof result.sessionRef).toBe('string') // FORBIDDEN

// OK: Behavioral assertions
const result = await command.action(ctx, 'latest');
expect(result.type).toBe('perform_resume');
expect(result.sessionRef).toBe('latest');
```

## Verification Commands

```bash
# Test file exists
test -f packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts || echo "FAIL"

# Test count
grep -c "it(" packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts
# Expected: 17+

# No mock theater
grep "toHaveBeenCalled\|vi.mock\|jest.mock" packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts && echo "FAIL" || echo "OK"

# Property tests present
grep -c "fc\.\|fast-check" packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts
# Expected: 2+

# Tests fail against stub
cd packages/cli && npx vitest run src/ui/commands/__tests__/continueCommand.spec.ts 2>&1 | tail -5
# Expected: FAIL
```

## Success Criteria
- 17+ behavioral tests
- 2+ property tests
- No mock theater (no vi.mock, no toHaveBeenCalled)
- Tests verify actual return values
- Tests fail against stub

## Failure Recovery
```bash
rm -f packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P19.md`
