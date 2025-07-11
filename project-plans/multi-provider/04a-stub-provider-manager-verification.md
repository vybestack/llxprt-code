# Phase 04a – Verification of Stub ProviderManager (multi-provider)

## Verification Steps

1.  **Check File Existence:**
    ```bash
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.test.ts
    ```
2.  **Run Typecheck:**
    ```bash
    npm run typecheck
    ```
3.  **Run Linter:**
    ```bash
    npm run lint
    ```
4.  **Run Tests for ProviderManager Stub:**

    ```bash
    npm test packages/cli/src/providers/ProviderManager.test.ts
    ```
    - **Expected Output:** The tests should pass, confirming that `NotYetImplemented` errors are correctly thrown for `setActiveProvider`, `getActiveProvider`, and `getAvailableModels`.

5.  **Verify Stub Content (No Cheating):**
    - Ensure `ProviderManager.ts` contains `throw new Error('NotYetImplemented');` for `setActiveProvider`, `getActiveProvider`, and `getAvailableModels`.

    ```bash
    grep -q "throw new Error('NotYetImplemented');" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts
    ```
    - Ensure `ProviderManager.test.ts` asserts `toThrow('NotYetImplemented')` or `rejects.toThrow('NotYetImplemented')` for the relevant methods.

    ```bash
    grep -q "toThrow('NotYetImplemented')" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.test.ts
    grep -q "rejects.toThrow('NotYetImplemented')" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.test.ts
    ```
    - Ensure `ProviderManager.ts` registers `OpenAIProvider` in its constructor:

    ```bash
    grep -q "this.registerProvider(new OpenAIProvider());" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts
    ```

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
