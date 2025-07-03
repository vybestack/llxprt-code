# Phase 13 – Pass toolFormat to generateChatCompletion (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To ensure the tool format override mechanism (set by `/toolformat` command) properly flows through the system. Since tool formats are already auto-detected in the provider, this phase focuses on implementing the override functionality.

## Deliverables

- Modified provider to support tool format override
- Updated `getToolFormat()` method to check for manual override
- Ensure both structured and text-based tool paths respect the override

## Checklist (implementer)

- [ ] Update `OpenAIProvider` (and base provider if needed):
  - [ ] Add `toolFormatOverride?: ToolFormat` property
  - [ ] Add `setToolFormatOverride(format: ToolFormat | null)` method
  - [ ] Update `getToolFormat()` to check override first:

    ```typescript
    private getToolFormat(): ToolFormat {
      // Check manual override first
      if (this.toolFormatOverride) {
        return this.toolFormatOverride;
      }

      // Otherwise auto-detect
      if (this.currentModel.includes('deepseek') || this.baseURL?.includes('deepseek')) {
        return 'deepseek';
      }
      // ... rest of auto-detection
    }
    ```

- [ ] Update format detection to handle text-based formats:
  - [ ] If format is in `['hermes', 'xml', 'llama', 'gemma']`, use TextToolCallParser
  - [ ] If format is in `['openai', 'anthropic', 'deepseek', 'qwen']`, use ToolFormatter
  - [ ] Add appropriate patterns to TextToolCallParser for new formats

- [ ] Connect `/toolformat` command to provider:
  - [ ] When user sets format, call `provider.setToolFormatOverride(format)`
  - [ ] When user sets 'auto', call `provider.setToolFormatOverride(null)`
  - [ ] Ensure override persists across messages in the same session

## Self-verify

```bash
npm run typecheck
npm run lint
# Manual test: Run the CLI, set a tool format (e.g., /toolformat openai), then send a message that should trigger a tool call.
# Verify that the tool call is correctly formatted and executed.
```

**STOP. Wait for Phase 13a verification.**
