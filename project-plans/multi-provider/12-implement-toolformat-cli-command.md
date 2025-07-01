# Phase 12 – Implement /toolformat CLI Command (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `/toolformat` command in the CLI, allowing users to override the auto-detected tool calling format when needed. Tool formats are automatically detected based on model name and base URL, but this command provides manual control when auto-detection is incorrect.

## Deliverables

- Modified CLI command parsing to handle `/toolformat`.
- Updated provider to support manual tool format override.
- Clear feedback showing current format and auto-detection status.

## Checklist (implementer)

- [ ] Update the CLI's command parsing logic (where `/` commands are handled):
  - [ ] Implement the `/toolformat` command with these options:
    - `/toolformat` - Show current format and whether it's auto-detected or manual
    - `/toolformat auto` - Return to auto-detection (default)
    - `/toolformat <format_name>` - Force a specific format
  - [ ] Validate `format_name` against supported formats:
    - Structured formats: `['openai', 'anthropic', 'deepseek', 'qwen']`
    - Text formats: `['hermes', 'xml', 'llama', 'gemma']`
  - [ ] Store the override in provider settings (e.g., `toolFormatOverride`)
  - [ ] Update provider's `getToolFormat()` to check override first
  - [ ] Show feedback:
    ```
    Current tool format: openai (auto-detected from model gpt-4)
    To override: /toolformat <format>
    To return to auto: /toolformat auto
    ```

## Self-verify

```bash
npm run typecheck
npm run lint
# Manual test: Run the CLI and try commands like /toolformat openai, /toolformat hermes, /toolformat invalid_format.
# Verify that valid formats are accepted and invalid ones produce an error.
```

**STOP. Wait for Phase 12a verification.**
