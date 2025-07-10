# Phase 07 – Integrate ProviderManager into CLI (Initial) (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To integrate the `ProviderManager` into the main CLI application, allowing the CLI to use the selected provider and model for chat completions. This phase will focus on updating the command handlers for `/provider` and `/model` and modifying the core chat loop to use the `ProviderManager`.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/index.ts` (or main CLI entry point) to instantiate `ProviderManager`.
- Modified CLI command parsing to handle `/provider` and `/model`.
- Modified core chat loop to use `providerManager.getActiveProvider().generateChatCompletion()`.

## Checklist (implementer)

- [ ] Update `packages/cli/src/index.ts` (or the main CLI entry point):
  - [ ] Import `ProviderManager`.
  - [ ] Instantiate `ProviderManager` globally or pass it to the main chat handling logic.
- [ ] Modify the command parsing logic (where `/` commands are handled):
  - [ ] Implement the `/provider <name>` command:
    - [ ] Call `providerManager.setActiveProvider(name)`.
    - [ ] Provide user feedback on the active provider.
  - [ ] Implement the `/model <model_name>` command:
    - [ ] Call `providerManager.getActiveProvider().setModel(model_name)` (you might need to add a `setModel` method to `IProvider` and `OpenAIProvider` that simply sets the internal model name).
    - [ ] Provide user feedback on the selected model.
- [ ] Modify the main chat loop (where user input is sent to the LLM):
  - [ ] Replace direct calls to `openai.chat.completions.create` (or similar) with calls to `providerManager.getActiveProvider().generateChatCompletion(messages, tools, toolFormat)`.
  - [ ] Ensure the streaming output is correctly handled and displayed to the user.
  - [ ] For this phase, you can hardcode `toolFormat` to 'openai' when calling `generateChatCompletion`.

## Self-verify

```bash
npm run typecheck
npm run lint
# Manual test: Run the CLI and try commands like /provider openai, /model gpt-3.5-turbo, then send a message.
# Verify that the output is streamed and comes from the expected model.
```

**STOP. Wait for Phase 07a verification.**
