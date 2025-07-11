# Phase 12a – Verification of Implement /toolformat CLI Command (multi-provider)

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
    - Inside the running CLI, execute the following commands and observe the output:
      - Set a valid tool format:

        ```
        /toolformat openai
        ```
        - **Expected:** Confirmation message that the tool format is set to 'openai'.

      - Set another valid tool format:

        ```
        /toolformat hermes
        ```
        - **Expected:** Confirmation message that the tool format is set to 'hermes'.

      - Attempt to set an invalid tool format:

        ```
        /toolformat unknown_format
        ```
        - **Expected:** An error message indicating that 'unknown_format' is not a valid tool format.

4.  **Code Inspection (grep):**
    - Verify the `/toolformat` command handler is present in the CLI's command parsing logic:
      ```bash
      grep -r "/toolformat" packages/cli/src/
      ```
    - Verify that the selected tool format is stored in the application's context or configuration (adjust path/variable name as per implementation):
      ```bash
      grep -r "toolFormat = format_name" packages/cli/src/ # or similar assignment
      ```
    - Verify validation logic for supported formats:
      ```bash
      grep -r "if (!supportedFormats.includes(format_name))" packages/cli/src/ # or similar validation
      ```

## Outcome

If all checks pass, emit `✅`. Otherwise, list all `❌` failures.
