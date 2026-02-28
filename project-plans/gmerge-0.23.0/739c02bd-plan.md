# Reimplement Plan: History length constant (upstream 739c02bd6d)

> **TEST BASELINE: There are ZERO pre-existing test failures (809 test files, 12,824 tests, all passing). Any test failure after implementation is caused by your changes and MUST be fixed before the batch is complete. Do not skip, defer, or assume failures are pre-existing.**


## Upstream Change
Replaces magic number `2` with named constant `INITIAL_HISTORY_LENGTH = 1` in chat command history checks. The initial history contains 1 system setup message, not 2 as previously assumed.

## Scope Notes
**In scope**: Two magic number `2` usages in chatCommand.ts (lines 160 and 392) for history length checks.
**Out of scope**: `const minEntries = 2` in restoreHistory function (line 443) — this represents a different semantic concept (minimum entries to keep during restore operation) and is not related to the initial history length. Changing this would alter the restore behavior logic and is beyond the scope of this upstream change.

## LLxprt Files to Modify
- packages/core/src/utils/environmentContext.ts — Add and export INITIAL_HISTORY_LENGTH constant
- packages/core/src/index.ts — Export INITIAL_HISTORY_LENGTH from core module (using named export to match existing pattern)
- packages/cli/src/ui/commands/chatCommand.ts — Replace magic number 2 with constant in saveCommand and clearCommand
- packages/cli/src/ui/commands/chatCommand.test.ts — Update test expectations to reflect new constant

## TDD Requirement (MANDATORY)
**Write a behavior-first failing test** that verifies the save and clear commands correctly identify when no conversation exists:
1. Add test to `chatCommand.test.ts` that verifies:
   - saveCommand returns "No conversation found to save" when history has only initial setup
   - clearCommand returns "No conversation to clear" when history has only initial setup
   - Both commands work correctly when actual conversation exists (history > initial setup)
2. **Run test** from `packages/cli`: `npx vitest run src/ui/commands/chatCommand.test.ts`
3. **Confirm RED** — test fails because it expects different behavior
4. Implement the changes in Steps 1-3 below
5. **Run test** again: `npx vitest run src/ui/commands/chatCommand.test.ts`
6. **Confirm GREEN** — test passes with correct boundary behavior

## Steps

1. **Add constant definition** in packages/core/src/utils/environmentContext.ts:
   - After imports, before other code, add:
     ```typescript
     export const INITIAL_HISTORY_LENGTH = 1;
     ```

2. **Export from core** in packages/core/src/index.ts:
   - Find the utilities export section (around line 108+)
   - packages/core/src/index.ts currently does NOT have any exports from environmentContext.js
   - Add new named export line to match existing pattern (NOT wildcard export):
     ```typescript
     export { INITIAL_HISTORY_LENGTH } from './utils/environmentContext.js';
     ```
   - This follows the established pattern where environmentContext functions are not currently exported

3. **Update chatCommand.ts** in packages/cli/src/ui/commands/chatCommand.ts:
   - Add import at top (merge with existing import from core):
     ```typescript
     import {
       decodeTagName,
       EmojiFilter,
       type EmojiFilterMode,
       INITIAL_HISTORY_LENGTH,
     } from '@vybestack/llxprt-code-core';
     ```
   
   - **EXACT locations in current LLxprt code** (verified by `grep -n 'history.length' packages/cli/src/ui/commands/chatCommand.ts`):
     - **Line 160**: `if (history.length > 2)` in saveCommand
       → Replace `2` with `INITIAL_HISTORY_LENGTH`
     
     - **Line 392**: `if (history.length <= 2)` in clearCommand
       → Replace `2` with `INITIAL_HISTORY_LENGTH`

4. **Verify completeness** with grep:
   ```bash
   grep -n 'history.length' packages/cli/src/ui/commands/chatCommand.ts
   ```
   **Expected output**: Should show lines 160 and 392 with `INITIAL_HISTORY_LENGTH`, no magic number `2`

5. **Update chatCommand.test.ts**:
   - Add behavior-focused test cases that verify boundary conditions:
     ```typescript
     describe('history boundary detection', () => {
       it('should not save when only initial setup exists', async () => {
         mockGetHistory.mockReturnValue([
           { role: 'user', parts: [{ text: 'system setup' }] }
         ]);
         const result = await saveCommand.action(mockContext, 'test');
         expect(result).toMatchObject({
           type: 'message',
           messageType: 'info',
           content: expect.stringContaining('No conversation found')
         });
       });

       it('should save when conversation beyond initial setup exists', async () => {
         mockGetHistory.mockReturnValue([
           { role: 'user', parts: [{ text: 'system setup' }] },
           { role: 'user', parts: [{ text: 'hello' }] },
           { role: 'model', parts: [{ text: 'hi' }] }
         ]);
         const result = await saveCommand.action(mockContext, 'test');
         expect(result).toMatchObject({
           type: 'message',
           messageType: 'info',
           content: expect.stringContaining('saved with tag')
         });
       });
     });
     ```
   
   - **Update existing test expectations** where tests check boundary behavior:
     - Tests that verify "no conversation to save" message
     - Tests that verify "no conversation to clear" message
     - Adjust mock history arrays to match INITIAL_HISTORY_LENGTH = 1 semantic

## Verification (Full Sequence — MANDATORY)
```bash
# Run unit tests for chatCommand
cd packages/cli && npx vitest run src/ui/commands/chatCommand.test.ts

# Return to root and run ALL verification
cd ../..
npm run test
npm run lint
npm run typecheck
npm run format
npm run build

# Smoke test interactive mode
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

**All commands must pass with zero errors before considering implementation complete.**

## Branding Adaptations
- Import from `@vybestack/llxprt-code-core` not `@google/gemini-cli-core`
- Variable names: no changes needed (INITIAL_HISTORY_LENGTH is generic)
