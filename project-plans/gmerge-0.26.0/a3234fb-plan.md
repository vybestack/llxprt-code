# REIMPLEMENT Playbook: a3234fb — Add rootCommands as array for policy parsing

## Upstream Change Summary

This commit adds a `rootCommands: string[]` field to `ToolExecuteConfirmationDetails` in addition to the existing `rootCommand: string` field. This change:

1. Adds `rootCommands: string[]` to the `ToolExecuteConfirmationDetails` interface in `tools.ts`
2. Passes the full array of root commands when creating confirmation details in `shell.ts`
3. Updates all test files and mock tools to include `rootCommands` in their confirmation details

This is a prefactoring change to prepare for policy parsing that needs access to all root commands (not just a comma-joined string).

**Files changed upstream:**
- `packages/cli/src/ui/components/HistoryItemDisplay.test.tsx`
- `packages/cli/src/ui/components/messages/ToolConfirmationMessage.test.tsx`
- `packages/cli/src/ui/utils/textUtils.test.ts`
- `packages/core/src/core/coreToolScheduler.test.ts`
- `packages/core/src/test-utils/mock-tool.ts`
- `packages/core/src/tools/shell.ts`
- `packages/core/src/tools/tools.ts`

## LLxprt Current State

### `packages/core/src/tools/tools.ts`
- Has `ToolExecuteConfirmationDetails` interface
- Currently only has `rootCommand: string` field
- Interface is at approximately line 693 in upstream, similar location in LLxprt

### `packages/core/src/tools/shell.ts`
- Has `ShellToolInvocation.shouldConfirmExecute()` method
- Currently creates `ToolExecuteConfirmationDetails` with only `rootCommand`
- Uses `commandsToConfirm.join(', ')` for `rootCommand`

## Adaptation Plan

### 1. Modify `packages/core/src/tools/tools.ts`

Add `rootCommands` field to `ToolExecuteConfirmationDetails`:

```typescript
export interface ToolExecuteConfirmationDetails {
  type: 'exec';
  title: string;
  onConfirm: (
    outcome: ToolConfirmationOutcome,
    payload?: ToolConfirmationPayload,
  ) => Promise<void>;
  command: string;
  rootCommand: string;
  rootCommands: string[];  // ADD THIS LINE
  correlationId?: string;
}
```

### 2. Modify `packages/core/src/tools/shell.ts`

Update the confirmation details creation to include `rootCommands`:

In `ShellToolInvocation.shouldConfirmExecute()`:
```typescript
const confirmationDetails: ToolExecuteConfirmationDetails = {
  type: 'exec',
  title: 'Confirm Shell Command',
  command: this.params.command,
  rootCommand: commandsToConfirm.join(', '),
  rootCommands: commandsToConfirm,  // ADD THIS LINE
  onConfirm: async (outcome: ToolConfirmationOutcome, payload) => {
    // ... existing code
  },
};
```

### 3. Update Test Files

Update any test files that create `ToolExecuteConfirmationDetails` to include `rootCommands`:

- `packages/core/src/core/coreToolScheduler.test.ts` (if exists)
- Any other test files that mock tool confirmations

## File Mapping (upstream → LLxprt)

**Present in LLxprt:**
- `packages/core/src/tools/tools.ts` — interface definition
- `packages/core/src/tools/shell.ts` — confirmation details creation
- `packages/core/src/core/coreToolScheduler.test.ts` — scheduler tests with confirmation mocks
- `packages/core/src/test-utils/mock-tool.ts` — shared mock tool fixtures

**Upstream-only (not in LLxprt):**
- `packages/cli/src/ui/components/HistoryItemDisplay.test.tsx` — CLI-only test
- `packages/cli/src/ui/components/messages/ToolConfirmationMessage.test.tsx` — CLI-only test
- `packages/cli/src/ui/utils/textUtils.test.ts` — CLI-only test

## Deterministic Implementation Steps

1. **Step A:** Edit interface in `packages/core/src/tools/tools.ts` — add `rootCommands: string[]` to `ToolExecuteConfirmationDetails`
2. **Step B:** Edit `packages/core/src/tools/shell.ts` — include `rootCommands: commandsToConfirm` in confirmation object (note: `commandsToConfirm` is intentional — only non-allowlisted commands are confirmed, which is the correct semantic for policy parsing)
3. **Step C:** Update every test/mock object literal for exec confirmations — start with `packages/core/src/core/coreToolScheduler.test.ts` and `packages/core/src/test-utils/mock-tool.ts`
4. **Step D:** Run `npm run typecheck` — fix any remaining compile errors by adding missing `rootCommands` in other fixtures

## Files to Read

1. `packages/core/src/tools/tools.ts`
2. `packages/core/src/tools/shell.ts`
3. `packages/core/src/core/coreToolScheduler.test.ts`
4. `packages/core/src/test-utils/mock-tool.ts`

## Files to Modify

1. `packages/core/src/tools/tools.ts` — Add `rootCommands: string[]` to interface
2. `packages/core/src/tools/shell.ts` — Pass `rootCommands: commandsToConfirm` in confirmation details
3. `packages/core/src/core/coreToolScheduler.test.ts` — Add `rootCommands` to all exec confirmation mocks
4. `packages/core/src/test-utils/mock-tool.ts` — Add `rootCommands` to mock tool confirmation

## Specific Verification

1. `npm run typecheck` — confirm no type errors
2. `npm run test` — focus on `coreToolScheduler.test.ts` and `mock-tool.ts`
3. `rootCommands` should contain discrete command names (e.g., `['git', 'npm']`); `rootCommand` remains comma-joined string for backward compatibility
4. Verify `rootCommands: commandsToConfirm` uses only non-allowlisted commands (not full parsed roots)
