# Phase 12 – Implement /toolformat CLI Command (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `/toolformat` command in the CLI, allowing users to specify the tool calling format. This format will be stored in the application's context or configuration.

## Deliverables

- Modified CLI command parsing to handle `/toolformat`.
- Updated application context/configuration to store the selected tool format.

## Checklist (implementer)

- [ ] Update the CLI's command parsing logic (where `/` commands are handled):
  - [ ] Implement the `/toolformat <format_name>` command.
  - [ ] Validate `format_name` against a predefined list of supported formats (e.g., `['openai', 'hermes', 'xml']`). If an invalid format is provided, display an error message.
  - [ ] Store the selected `format_name` in a suitable place in the application's context (e.g., `this.context.toolFormat` if such a context object exists, or a new configuration property).
  - [ ] Provide user feedback confirming the tool format has been set.

## Self-verify

```bash
npm run typecheck
npm run lint
# Manual test: Run the CLI and try commands like /toolformat openai, /toolformat hermes, /toolformat invalid_format.
# Verify that valid formats are accepted and invalid ones produce an error.
```

**STOP. Wait for Phase 12a verification.**
