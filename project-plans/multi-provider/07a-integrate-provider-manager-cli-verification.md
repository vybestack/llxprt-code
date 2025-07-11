# Phase 07a – Verification of Integrate ProviderManager into CLI (Initial) (multi-provider)

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
      # Replace with your actual command to start the CLI, e.g., npm start or node dist/index.js
      # For this project, it might be `npm run dev` or `node packages/cli/dist/index.js` after a build.
      # Assuming `npm run start` is configured to run the CLI.
      npm run start
      ```
    - Inside the running CLI, execute the following commands and observe the output:
      - Set the provider:

        ```
        /provider openai
        ```
        - **Expected:** Confirmation message that the provider is set to 'openai'.

      - Set an OpenAI model (ensure you have a valid OpenAI API key configured for this to work):

        ```
        /model gpt-3.5-turbo
        ```
        - **Expected:** Confirmation message that the model is set to 'gpt-3.5-turbo'.

      - Send a chat message:

        ```
        Hello, how are you?
        ```
        - **Expected:** The response from the model should be streamed character by character or word by word, not appear all at once. The content should be a coherent response from `gpt-3.5-turbo`.

4.  **Code Inspection (grep):**
    - Verify `ProviderManager` instantiation in the main CLI entry point (e.g., `packages/cli/src/index.ts` or `packages/cli/src/gemini.tsx` if it's a React-based CLI):
      ```bash
      grep -r "new ProviderManager()" packages/cli/src/
      ```
    - Verify `/provider` command calls `setActiveProvider`:
      ```bash
      grep -r "setActiveProvider" packages/cli/src/
      ```
    - Verify `/model` command calls `getActiveProvider().setModel`:
      ```bash
      grep -r "getActiveProvider().setModel" packages/cli/src/
      ```
    - Verify chat loop uses `generateChatCompletion` from active provider:
      ```bash
      grep -r "getActiveProvider().generateChatCompletion" packages/cli/src/
      ```
    - Verify direct `openai` SDK calls for chat completions are removed from the main chat loop (this might require manual inspection if grep is too broad):
      ```bash
      ! grep -r "openai.chat.completions.create" packages/cli/src/ --exclude-dir=providers/openai
      ```

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
