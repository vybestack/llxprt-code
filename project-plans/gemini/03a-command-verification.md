# Phase 3a – Verification of Command Updates (gemini)

## Verification Steps

1. Check that `/key` command no longer requires active provider check:

   ```bash
   grep -A 10 -B 5 "/key" packages/cli/src/ui/hooks/slashCommandProcessor.ts | grep -v "hasActiveProvider"
   ```

   Expected: Should NOT find `hasActiveProvider()` check in /key handler

2. Check that `/keyfile` command works with default provider:

   ```bash
   grep -A 10 -B 5 "/keyfile" packages/cli/src/ui/hooks/slashCommandProcessor.ts | grep -v "hasActiveProvider"
   ```

   Expected: Should NOT find `hasActiveProvider()` check in /keyfile handler

3. Verify `/model` always uses provider dialog:

   ```bash
   grep -A 15 "/model" packages/cli/src/ui/hooks/slashCommandProcessor.ts | grep -E "(openProviderModelDialog|openModelDialog)"
   ```

   Expected: Should only find `openProviderModelDialog`, not `openModelDialog`

4. Check for `/auth` command implementation:

   ```bash
   grep -A 10 "/auth" packages/cli/src/ui/hooks/slashCommandProcessor.ts
   ```

   Expected: Should find /auth handler that manages authentication modes

5. Verify no legacy model dialog calls remain:

   ```bash
   grep "openModelDialog" packages/cli/src/ui/hooks/slashCommandProcessor.ts
   ```

   Expected: Should NOT find any calls to `openModelDialog`

6. Check for removal of empty provider checks:

   ```bash
   grep "activeProviderName.*===.*''" packages/cli/src/ui/hooks/slashCommandProcessor.ts
   ```

   Expected: Should NOT find checks for empty activeProviderName

7. Run type checking:

   ```bash
   npm run typecheck
   ```

   Expected: No errors

8. Run linting:

   ```bash
   npm run lint
   ```

   Expected: No errors

9. Run slash command tests:

   ```bash
   npm test -- --testPathPattern=slash
   ```

   Expected: All tests pass

10. Check for completed checklist items:
    ```bash
    grep -c "\[x\]" project-plans/gemini/03-command-updates.md
    ```
    Expected: Should be 9 (all checklist items marked complete)

## Outcome

If all verification steps pass: ✅ Phase 3 complete
If any verification step fails: ❌ List specific failures
