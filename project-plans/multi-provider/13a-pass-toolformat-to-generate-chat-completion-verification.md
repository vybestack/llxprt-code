# Phase 13a – Verification of Pass toolFormat to generateChatCompletion (multi-provider)

## Verification Steps

1.  **Run Typecheck:**
    ```bash
    npm run typecheck
    ```
2.  **Run Linter:**
    ```bash
    npm run lint
    ```
3.  **Manual CLI Interaction Test:**
    - Start the CLI application:
      ```bash
      npm run start
      ```
    - Inside the running CLI, execute the following commands:

      **Test Structured Path (ToolFormatter):**
      - Set provider and model:
        ```
        /provider openai
        /model gpt-3.5-turbo
        ```
      - Override tool format:
        ```
        /toolformat openai
        ```
      - Send a message that triggers a tool call:
        ```
        Read the file packages/cli/package.json
        ```

      **Test Text-Based Path (TextToolCallParser):**
      - Set provider and model:
        ```
        /provider openai
        /baseurl http://localhost:1234/v1/
        /model gemma-3-12b-it
        ```
      - Check auto-detected format:
        ```
        /toolformat
        ```
      - Send a message that triggers a tool call:
        ```
        List files in the current directory
        ```

      **Test Format Override:**
      - Override to text format:
        ```
        /toolformat text
        ```
      - Verify tool calls are parsed as text even for structured models

4.  **Code Inspection - Verify Dual-Path Architecture:**
    - Verify `setToolFormatOverride` method exists:
      ```bash
      grep -q "setToolFormatOverride" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts
      ```
    - Verify override is checked in `getToolFormat`:
      ```bash
      grep -q "toolFormatOverride" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts
      ```
    - Verify TextToolCallParser is used for text formats:
      ```bash
      grep -q "requiresTextToolCallParsing" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts
      ```
    - Verify ToolFormatter is used for structured formats:
      ```bash
      grep -q "toolFormatter.toProviderFormat.*toolFormat" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts
      ```
    - Verify both paths output `IMessage['tool_calls']` format:
      ```bash
      grep -q "tool_calls:" /Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts
      ```

## Dual-Path Testing

Ensure both paths work correctly:

1. **Structured formats** (openai, deepseek, qwen) → ToolFormatter → accumulateStreamingToolCall
2. **Text formats** (gemma, hermes, xml, llama) → TextToolCallParser → parse

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
