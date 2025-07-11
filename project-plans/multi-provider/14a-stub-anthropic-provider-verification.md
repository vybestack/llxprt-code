# Phase 14a – Verification of Stub AnthropicProvider (multi-provider)

## Verification Steps

1.  **Check File Existence:**
    ```bash
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.ts
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.test.ts
    ```
2.  **Run Typecheck:**
    ```bash
    npm run typecheck
    ```
3.  **Run Linter:**
    ```bash
    npm run lint
    ```
4.  **Run Tests for AnthropicProvider Stub:**

    ```bash
    npm test packages/cli/src/providers/anthropic/AnthropicProvider.test.ts
    ```
    - **Expected Output:** The tests should pass, confirming that `NotYetImplemented` errors are correctly thrown.

5.  **Verify Stub Content (No Cheating):**
    - Ensure `AnthropicProvider.ts` contains `throw new Error('NotYetImplemented');` for `getModels` and `generateChatCompletion`.

    ```bash
    grep -q "throw new Error('NotYetImplemented');" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.ts
    ```
    - Ensure `AnthropicProvider.test.ts` asserts `rejects.toThrow('NotYetImplemented')`.

    ```bash
    grep -q "rejects.toThrow('NotYetImplemented')" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.test.ts
    ```

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
