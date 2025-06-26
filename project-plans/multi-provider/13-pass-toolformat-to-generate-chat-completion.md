# Phase 13 – Pass toolFormat to generateChatCompletion (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To modify the CLI's main chat loop to pass the selected `toolFormat` (set by the `/toolformat` command) to the `generateChatCompletion` method of the active provider. This ensures that the correct tool formatting is used when making API calls.

## Deliverables

- Modified CLI main chat loop (e.g., in `packages/cli/src/index.ts` or relevant chat handling logic).
- Modified `packages/cli/src/providers/IProvider.ts` (if `toolFormat` was not already part of the signature).
- Modified `packages/cli/src/providers/openai/OpenAIProvider.ts`'s `generateChatCompletion` to accept and utilize the `toolFormat` parameter.

## Checklist (implementer)

- [ ] Ensure `packages/cli/src/providers/IProvider.ts`'s `generateChatCompletion` signature includes `toolFormat?: string`.
- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.ts`:
  - [ ] Ensure `generateChatCompletion` method accepts `toolFormat?: string`.
  - [ ] Pass this `toolFormat` parameter to the `ToolFormatter.toProviderFormat` and `ToolFormatter.fromProviderFormat` calls within `generateChatCompletion`.
- [ ] Modify the main chat loop in the CLI (where user input is sent to the LLM):
  - [ ] Retrieve the currently selected `toolFormat` from the application's context/configuration.
  - [ ] Pass this `toolFormat` as the last argument to `providerManager.getActiveProvider().generateChatCompletion(messages, tools, currentToolFormat)`.

## Self-verify

```bash
npm run typecheck
npm run lint
# Manual test: Run the CLI, set a tool format (e.g., /toolformat openai), then send a message that should trigger a tool call.
# Verify that the tool call is correctly formatted and executed.
```

**STOP. Wait for Phase 13a verification.**
