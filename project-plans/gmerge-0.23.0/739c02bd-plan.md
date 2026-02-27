# Reimplement Plan: History length constant (upstream 739c02bd6d)

## Upstream Change
Replaces magic number `2` with named constant `INITIAL_HISTORY_LENGTH = 1` in chat command history checks. The initial history contains 1 system setup message, not 2 as previously assumed.

## LLxprt Files to Modify
- packages/core/src/utils/environmentContext.ts — Add and export INITIAL_HISTORY_LENGTH constant
- packages/core/src/index.ts — Export INITIAL_HISTORY_LENGTH from core module
- packages/cli/src/ui/commands/chatCommand.ts — Replace magic number 2 with constant
- packages/cli/src/ui/commands/chatCommand.test.ts — Update test expectations to reflect new constant

## Steps

1. **Add constant definition** in packages/core/src/utils/environmentContext.ts:
   - After imports, before other code, add:
     ```typescript
     export const INITIAL_HISTORY_LENGTH = 1;
     ```

2. **Export from core** in packages/core/src/index.ts:
   - Find exports from './utils/environmentContext.js'
   - Add to export list (or add new export if not present):
     ```typescript
     export * from './utils/environmentContext.js';
     ```

3. **Update chatCommand.ts** in packages/cli/src/ui/commands/chatCommand.ts:
   - Add import at top:
     ```typescript
     import {
       decodeTagName,
       type MessageActionReturn,
       INITIAL_HISTORY_LENGTH,
     } from '@vybestack/llxprt-code-core';
     ```
   
   - Find and replace (approximately 3-4 locations):
     - `history.length > 2` → `history.length > INITIAL_HISTORY_LENGTH`
     - `history.length <= 2` → `history.length <= INITIAL_HISTORY_LENGTH`
     - Any other hardcoded `2` comparisons with history.length

   - **Specific locations based on upstream diff**:
     - Line ~135: `if (history.length > 2)` in saveCommand
     - Line ~210: Loop through conversation starting at index 2 → should slice with `INITIAL_HISTORY_LENGTH`
     - Line ~346: `if (history.length <= 2)` in shareCommand

4. **Update chatCommand.test.ts**:
   - **Remove one mock response** from test histories to match new constant
   - Find tests with mock histories like:
     ```typescript
     mockGetHistory.mockReturnValue([
       { role: 'user', parts: [{ text: 'context for our chat' }] },
       { role: 'model', parts: [{ text: 'Got it. Thanks for the context!' }] },  // REMOVE THIS
     ]);
     ```
   - Remove the second item (model response) to match INITIAL_HISTORY_LENGTH = 1
   
   - **Affected tests** (based on upstream diff):
     - "should save the conversation if tag is provided"
     - "should inform if there is no conversation to save"
     - "should save the conversation if overwrite is confirmed"
     - "should inform if there is no conversation to share"
   
   - **Add initial message** to resume tests:
     - Tests for resume/block/legacy conversation should have system setup as first item

5. **Update resume command logic** (around line 201-213 in upstream):
   - Change loop to use slice instead of manual index tracking:
     ```typescript
     for (const item of conversation.slice(INITIAL_HISTORY_LENGTH)) {
       const text = item.parts
         ?.filter((m) => !!m.text)
         .map((m) => m.text)
         .join('') || '';
       if (!text) {
         continue;
       }

       uiHistory.push({
         type: (item.role && rolemap[item.role]) || MessageType.GEMINI,
         text,
       } as HistoryItemWithoutId);
     }
     ```

## Verification
- `cd packages/cli && npx vitest run src/ui/commands/chatCommand.test.ts`
- `npm run typecheck` in root
- `npm run lint` in root
- Verify all chat save/resume/share commands work correctly in interactive mode

## Branding Adaptations
- Import from `@vybestack/llxprt-code-core` not `@google/gemini-cli-core`
- Variable names: no changes needed (INITIAL_HISTORY_LENGTH is generic)
