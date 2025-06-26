# Phase 22 – Implement OpenAI Responses API in OpenAIProvider (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To modify the `OpenAIProvider` to conditionally use the OpenAI "Responses API" for specific models (e.g., `o3`, `o4-mini`, `gpt-4o`) while continuing to use the standard Chat Completions API for others. This will ensure full compatibility with newer OpenAI models.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts` to support OpenAI Responses API.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.test.ts` with tests for Responses API integration.

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.ts`:
  - [ ] Define a list of models that use the Responses API (e.g., `RESPONSES_API_MODELS = ['o3', 'o4-mini', 'gpt-4o', 'gpt-4o-2024-08-06'];`).
  - [ ] In `generateChatCompletion`, add conditional logic to check if the current `model` is in `RESPONSES_API_MODELS`.
  - [ ] If it is a Responses API model:
    - [ ] Use `this.openai.responses.stream` (or `this.openai.responses.create` if streaming is not directly supported by the SDK for this endpoint, but prioritize streaming).
    - [ ] Convert `IMessage[]` to the `instructions` and `input` format expected by the Responses API.
    - [ ] Convert `ITool[]` to the Responses API tool format (you might need a new helper function or extend `ToolFormatter` for this specific conversion if it differs significantly from standard OpenAI tools).
    - [ ] Parse the streaming response from `openai.responses` to extract content and tool calls, yielding them in the internal `IMessage` format.
  - [ ] If it is a standard Chat Completions API model, continue to use `this.openai.chat.completions.create` as before.
- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.test.ts`:
  - [ ] Add tests for `generateChatCompletion` with Responses API models:
    - [ ] Mock `this.openai.responses.stream` (or `create`) to simulate Responses API behavior.
    - [ ] Assert that the correct API endpoint is called and that the response is correctly parsed and yielded.
  - [ ] Ensure existing tests for standard Chat Completions API models still pass.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/openai/OpenAIProvider.test.ts
```

**STOP. Wait for Phase 22a verification.**
