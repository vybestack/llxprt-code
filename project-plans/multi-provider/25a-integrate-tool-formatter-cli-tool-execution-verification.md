# Phase 25a – Verification of Integrate ToolFormatter into CLI Tool Execution (multi-provider)

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
    - Inside the running CLI, execute the following commands. You will need valid API keys for both OpenAI and Anthropic, and a model that supports tool calling for each provider.
      - **Test with OpenAI (default tool format):**

        ```
        /provider openai
        /model gpt-3.5-turbo # or gpt-4, etc.
        /toolformat openai
        Read the file packages/cli/package.json
        ```
        - **Expected:** The `read_file` tool should be called and its output displayed, followed by a response from the OpenAI model. This verifies `ToolFormatter.fromProviderFormat` is correctly handling OpenAI's tool calls.

      - **Test with Anthropic (default tool format):**

        ```
        /provider anthropic
        /model claude-3-sonnet-20240229 # or other tool-capable Anthropic model
        /toolformat anthropic
        Read the file packages/cli/package.json
        ```
        - **Expected:** The `read_file` tool should be called and its output displayed, followed by a response from the Anthropic model. This verifies `ToolFormatter.fromProviderFormat` is correctly handling Anthropic's tool calls.

      - **(Optional) Test with other tool formats (if implemented in previous phases):**
        - If `hermes` or `xml` tool formats have been fully implemented and integrated with a provider, repeat the test with those formats.

4.  **Code Inspection (grep):**
    - Verify that `ToolFormatter.fromProviderFormat` is called in the CLI's tool execution logic (where raw tool calls from the provider are processed before being executed). The exact location might vary, but it should be where the `IMessage['tool_calls']` array is constructed from the raw provider response.
      ```bash
      grep -r "ToolFormatter.fromProviderFormat" packages/cli/src/
      ```
    - Ensure that the `toolFormat` variable (which holds the currently selected tool format) is passed as the second argument to `ToolFormatter.fromProviderFormat`.

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
