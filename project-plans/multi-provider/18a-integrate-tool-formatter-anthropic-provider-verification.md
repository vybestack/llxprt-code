# Phase 18a – Verification of Integrate ToolFormatter into AnthropicProvider (multi-provider)

## Verification Steps

1.  **Run Typecheck:**
    ```bash
    npm run typecheck
    ```
2.  **Run Linter:**
    ```bash
    npm run lint
    ```
3.  **Run Tests for AnthropicProvider Implementation:**
    ```bash
    npm test packages/cli/src/providers/anthropic/AnthropicProvider.test.ts
    ```
    - **Expected Output:** All tests in `AnthropicProvider.test.ts` should pass. These tests should now cover the correct integration of `ToolFormatter`.
4.  **Verify `AnthropicProvider.ts` Integration Details:**
    - Ensure `ToolFormatter` is imported:
      ```bash
      grep -q "import { ToolFormatter } from '../../tools/ToolFormatter';" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.ts
      ```
    - Ensure `toProviderFormat` is used for outgoing tools:
      ```bash
      grep -q "ToolFormatter.toProviderFormat(tools, 'anthropic')" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.ts
      ```
    - Ensure `fromProviderFormat` is used for incoming tool calls:
      ```bash
      grep -q "ToolFormatter.fromProviderFormat(toolCall, 'anthropic')" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.ts
      ```

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
