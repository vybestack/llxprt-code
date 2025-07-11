# Phase 01a – Verification of Stub Core Interfaces & OpenAI Provider (multi-provider)

## Verification Steps

1.  **Check File Existence:**
    ```bash
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/IProvider.ts
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/IModel.ts
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ITool.ts
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/IMessage.ts
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.test.ts
    ```
2.  **Run Typecheck:**
    ```bash
    npm run typecheck
    ```
3.  **Run Linter:**
    ```bash
    npm run lint
    ```
4.  **Run Tests for OpenAIProvider Stub:**

    ```bash
    npm test packages/cli/src/providers/openai/OpenAIProvider.test.ts
    ```
    - **Expected Output:** The tests should pass, confirming that `NotYetImplemented` errors are correctly thrown.

5.  **Verify Stub Content (No Cheating):**
    - Ensure `OpenAIProvider.ts` contains `throw new Error('NotYetImplemented');` for `getModels` and `generateChatCompletion`.

    ```bash
    grep -q "throw new Error('NotYetImplemented');" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts
    ```
    - Ensure `OpenAIProvider.test.ts` asserts `rejects.toThrow('NotYetImplemented')`.

    ```bash
    grep -q "rejects.toThrow('NotYetImplemented')" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.test.ts
    ```

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
