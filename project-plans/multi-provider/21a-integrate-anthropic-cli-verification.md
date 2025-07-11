# Phase 21a – Verification of Integrate AnthropicProvider into CLI (multi-provider)

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
    - Inside the running CLI, execute the following commands and observe the output. You will need a valid Anthropic API key configured for this to work.
      - Set the provider:

        ```
        /provider anthropic
        ```
        - **Expected:** Confirmation message that the provider is set to 'anthropic'.

      - Set an Anthropic model (e.g., `claude-3-opus-20240229` or `claude-3-sonnet-20240229`):

        ```
        /model claude-3-sonnet-20240229
        ```
        - **Expected:** Confirmation message that the model is set to the Anthropic model.

      - Send a chat message:

        ```
        Hello, how are you?
        ```
        - **Expected:** The response from the model should be streamed character by character or word by word, not appear all at once. The content should be a coherent response from the Anthropic model.

4.  **Code Inspection (grep):**
    - Verify the `/provider` command handler correctly sets the active provider to Anthropic:
      ```bash
      grep -r "setActiveProvider('anthropic')" packages/cli/src/
      ```
    - Verify the main chat loop uses `providerManager.getActiveProvider().generateChatCompletion`:
      ```bash
      grep -r "getActiveProvider().generateChatCompletion" packages/cli/src/
      ```

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
