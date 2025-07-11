# Phase 05a – Verification of Implement getActiveProvider and setActiveProvider in ProviderManager (multi-provider)

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
    - **Expected Output:** All tests in `ProviderManager.test.ts` should pass, including the new tests for `setActiveProvider` and `getActiveProvider`, and the existing test for `getAvailableModels` (which should still assert `NotYetImplemented`).

4.  **Verify `ProviderManager.ts` Implementation Details:**
    - Ensure `setActiveProvider` no longer throws `NotYetImplemented` and contains logic to set `activeProviderName`:
      ```bash
      ! grep -q "setActiveProvider(name: string) {\n        throw new Error('NotYetImplemented');" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts
      grep -q "this.activeProviderName = name;" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts
      ```
    - Ensure `getActiveProvider` no longer throws `NotYetImplemented` and returns the correct provider:
      ```bash
      ! grep -q "getActiveProvider(): IProvider {\n        throw new Error('NotYetImplemented');" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts
      grep -q "return this.providers.get(this.activeProviderName)!;" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts
      ```
    - Ensure `getAvailableModels` still throws `NotYetImplemented`:
      ```bash
      grep -q "async getAvailableModels(providerName?: string): Promise<any[]> {\n        throw new Error('NotYetImplemented');" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts
      ```

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
