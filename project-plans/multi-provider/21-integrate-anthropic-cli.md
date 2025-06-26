# Phase 21 – Integrate AnthropicProvider into CLI (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To integrate the `AnthropicProvider` into the main CLI application, allowing the CLI to use Anthropic models for chat completions. This phase will focus on enabling the `/provider anthropic` command and ensuring the core chat loop correctly uses the active Anthropic provider.

## Deliverables

- Modified CLI command parsing to handle `/provider anthropic`.
- Modified core chat loop to correctly use the active Anthropic provider.

## Checklist (implementer)

- [ ] Update the CLI's command parsing logic (where `/` commands are handled):
  - [ ] Ensure the `/provider <name>` command correctly sets `anthropic` as the active provider when `/provider anthropic` is used.
  - [ ] Provide user feedback on the active provider.
- [ ] Ensure the main chat loop (where user input is sent to the LLM) correctly uses `providerManager.getActiveProvider().generateChatCompletion(...)` when Anthropic is the active provider.
  - [ ] Verify that the streaming output is correctly handled and displayed to the user.
  - [ ] Ensure that `toolFormat` is correctly passed to `generateChatCompletion` for Anthropic (which should be handled by previous phases).

## Self-verify

```bash
npm run typecheck
npm run lint
# Manual test: Run the CLI and try commands like /provider anthropic, /model claude-3-opus-20240229, then send a message.
# Verify that the output is streamed and comes from the expected Anthropic model.
```

**STOP. Wait for Phase 21a verification.**
