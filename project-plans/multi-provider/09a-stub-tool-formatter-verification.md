# Phase 09a – Verification of Stub ToolFormatter (multi-provider)

## Verification Steps

1.  **Check File Existence:**
    ```bash
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/IToolFormatter.ts
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.ts
    ls /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.test.ts
    ```
2.  **Run Typecheck:**
    ```bash
    npm run typecheck
    ```
3.  **Run Linter:**
    ```bash
    npm run lint
    ```
4.  **Run Tests for ToolFormatter Stub:**

    ```bash
    npm test packages/cli/src/tools/ToolFormatter.test.ts
    ```
    - **Expected Output:** The tests should pass, confirming that `NotYetImplemented` errors are correctly thrown.

5.  **Verify Stub Content (No Cheating):**
    - Ensure `ToolFormatter.ts` contains `throw new Error('NotYetImplemented');` for `toProviderFormat` and `fromProviderFormat`.

    ```bash
    grep -q "throw new Error('NotYetImplemented');" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.ts
    ```
    - Ensure `ToolFormatter.test.ts` asserts `toThrow('NotYetImplemented')`.

    ```bash
    grep -q "toThrow('NotYetImplemented')" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.test.ts
    ```

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
