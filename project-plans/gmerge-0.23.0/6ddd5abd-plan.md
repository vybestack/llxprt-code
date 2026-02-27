# Reimplement Plan: Slash completion eager hiding fix (upstream 6ddd5abd7b)

## Upstream Change
Fixes useSlashCompletion to prevent hiding sibling commands when user types an exact match. For example, typing `/memory` should still show `/memory-leak` if it exists.

## LLxprt Files to Modify
- packages/cli/src/ui/hooks/useSlashCompletion.ts — Remove eager descent into subcommands
- packages/cli/src/ui/hooks/useSlashCompletion.test.ts — Add test for parent/sibling suggestion behavior

## Steps

1. **Read current implementation**:
   - packages/cli/src/ui/hooks/useSlashCompletion.ts (focus on `useCommandParser` function)
   - packages/cli/src/ui/hooks/useSlashCompletion.test.ts

2. **Locate the problematic code** in `useCommandParser` function (around line 117-124 in upstream):
   ```typescript
   exactMatchAsParent = currentLevel.find(
     (cmd) => matchesCommand(cmd, partial) && cmd.subCommands,
   );

   if (exactMatchAsParent) {
     leafCommand = exactMatchAsParent;
     currentLevel = exactMatchAsParent.subCommands;
     partial = '';
   }
   ```

3. **Remove the descent logic**:
   - Delete the entire block: `if (exactMatchAsParent) { ... }`
   - Keep the `exactMatchAsParent` assignment for later use (it's checked elsewhere)
   - This allows sibling commands to remain visible when typing an exact match

4. **Add test case** in useSlashCompletion.test.ts (after existing tests, around line 530):
   ```typescript
   it('should suggest parent command (and siblings) instead of sub-commands when no trailing space', async () => {
     const slashCommands = [
       createTestCommand({
         name: 'memory',
         description: 'Manage memory',
         subCommands: [
           createTestCommand({ name: 'show', description: 'Show memory' }),
         ],
       }),
       createTestCommand({
         name: 'memory-leak',
         description: 'Debug memory leaks',
       }),
     ];

     const { result } = renderHook(() =>
       useTestHarnessForSlashCompletion(
         true,
         '/memory',
         slashCommands,
         mockCommandContext,
       ),
     );

     // Should verify that we see BOTH 'memory' and 'memory-leak'
     await waitFor(() => {
       expect(result.current.suggestions).toHaveLength(2);
       expect(result.current.suggestions).toEqual(
         expect.arrayContaining([
           {
             label: 'memory',
             value: 'memory',
             description: 'Manage memory',
             commandKind: CommandKind.BUILT_IN,
           },
           {
             label: 'memory-leak',
             value: 'memory-leak',
             description: 'Debug memory leaks',
             commandKind: CommandKind.BUILT_IN,
           },
         ]),
       );
     });
   });
   ```

5. **Update existing test** (around line 892 in upstream):
   - Find test that checks `/memory` behavior
   - Change query from `'/memory'` to `'/memory '` (with trailing space) if testing subcommand display
   - The space indicates user wants subcommands, not siblings

## Verification
- `cd packages/cli && npx vitest run src/ui/hooks/useSlashCompletion.test.ts`
- Verify new test passes
- Verify existing tests still pass (may need query adjustments for trailing space)
- Manual test: In interactive mode, type `/memory` and verify both `/memory` and `/memory-leak` appear

## Branding Adaptations
- None required (code-only change)
