# Phase 06a – Verification of Implement getAvailableModels in ProviderManager (multi-provider)

## Verification Steps

1.  **Run Typecheck:**
    ```bash
    npm run typecheck
    ```
2.  **Run Linter:**
    ```bash
    npm run lint
    ```
3.  **Run Tests for ProviderManager Implementation:**

    ```bash
    npm test packages/cli/src/providers/ProviderManager.test.ts
    ```
    - **Expected Output:** All tests in `ProviderManager.test.ts` should pass, including the new tests for `getAvailableModels`.

4.  **Verify `ProviderManager.ts` Implementation Details:**
    - Ensure `getAvailableModels` no longer throws `NotYetImplemented`:
      ```bash
      ! grep -q "async getAvailableModels(providerName?: string): Promise<any[]> {\n        throw new Error('NotYetImplemented');" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts
      ```
    - Ensure `getAvailableModels` calls `getModels()` on the appropriate provider:
      ```bash
      grep -q "provider.getModels()" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts
      ```
    - Ensure error handling for non-existent providers is present:
      ```bash
      grep -q "throw new Error('Provider not found:'" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts
      ```

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
