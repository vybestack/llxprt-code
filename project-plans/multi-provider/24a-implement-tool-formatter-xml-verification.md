# Phase 24a – Verification of Implement ToolFormatter for XML (multi-provider)

## Verification Steps

1.  **Run Typecheck:**
    ```bash
    npm run typecheck
    ```
2.  **Run Linter:**
    ```bash
    npm run lint
    ```
3.  **Run Tests for ToolFormatter Implementation:**

    ```bash
    npm test packages/cli/src/tools/ToolFormatter.test.ts
    ```
    - **Expected Output:** All tests in `ToolFormatter.test.ts` should pass, including the new tests for `xml` tool formatting and the existing `NotYetImplemented` tests for other formats.

4.  **Verify `ToolFormatter.ts` Implementation Details:**
    - Ensure `toProviderFormat` handles `xml` format and does not throw `NotYetImplemented` for it:
      ```bash
      grep -q "if (format === 'xml')" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.ts
      ! grep -q "toProviderFormat(tools: ITool[], format: ToolFormat): any {\n        throw new Error('NotYetImplemented');" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.ts
      ```
    - Ensure `fromProviderFormat` handles `xml` format and does not throw `NotYetImplemented` for it:
      ```bash
      grep -q "if (format === 'xml')" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.ts
      ! grep -q "fromProviderFormat(rawToolCall: any, format: ToolFormat): IMessage['tool_calls'] {\n        throw new Error('NotYetImplemented');" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.ts
      ```
    - Ensure `NotYetImplemented` is still thrown for other formats in both methods (this might require manual inspection or more complex grep if the `if/else` structure is deep):
      ```bash
      grep -q "throw new Error('NotYetImplemented');" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.ts
      ```

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
