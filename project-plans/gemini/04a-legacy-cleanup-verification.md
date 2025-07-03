# Phase 4a – Verification of Legacy Cleanup (gemini)

## Verification Steps

1. Check that contentGenerator works with provider auth:

   ```bash
   grep -A 10 "USE_PROVIDER" packages/core/src/core/contentGenerator.ts
   ```

   Expected: Should find handling for provider-based authentication

2. Verify no empty activeProviderName checks remain:

   ```bash
   grep -r "activeProviderName.*===.*''" packages/cli/src --include="*.ts" | grep -v "test"
   ```

   Expected: Should NOT find checks for empty activeProviderName

3. Check Config integrates with provider:

   ```bash
   grep -A 5 -B 5 "provider" packages/cli/src/config/Config.ts
   ```

   Expected: Should find references to provider for Gemini auth

4. Verify sandbox handles provider environment variables:

   ```bash
   grep -E "(GEMINI_API_KEY|GOOGLE_)" packages/cli/src/utils/sandbox.ts
   ```

   Expected: Should find proper handling of all auth-related env vars

5. Check no legacy model dialog remains:

   ```bash
   grep -r "openModelDialog" packages/cli/src --include="*.ts" | grep -v "test"
   ```

   Expected: Should NOT find any openModelDialog usage

6. Verify all auth types are handled:

   ```bash
   grep -A 20 "AuthType" packages/core/src/core/contentGenerator.ts | grep -E "(USE_GEMINI|USE_VERTEX_AI|LOGIN_WITH_GOOGLE)"
   ```

   Expected: Should see these auth types handled appropriately

7. Run full type checking:

   ```bash
   npm run typecheck
   ```

   Expected: No errors

8. Run full linting:

   ```bash
   npm run lint
   ```

   Expected: No errors

9. Run complete test suite:

   ```bash
   npm test
   ```

   Expected: All tests pass

10. Check for completed checklist items:

    ```bash
    grep -c "\[x\]" project-plans/gemini/04-legacy-cleanup.md
    ```

    Expected: Should be 10 (all checklist items marked complete)

11. Final integration check - verify Gemini is default:
    ```bash
    grep -A 5 "new ProviderManager" packages/cli/src/providers/providerManagerInstance.ts
    ```
    Expected: Should show Gemini as active by default

## Outcome

If all verification steps pass: ✅ Phase 4 complete - Gemini provider unification successful!
If any verification step fails: ❌ List specific failures
