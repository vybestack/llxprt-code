# Phase 03 – Implement getModels for OpenAIProvider (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `getModels` method in `OpenAIProvider` to dynamically fetch available models from the OpenAI API. The `generateChatCompletion` method will remain as implemented in the previous phase.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts` with `getModels` implementation.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.test.ts` with tests for `getModels`.

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.ts`:
  - [ ] Implement `getModels` to:
    - [ ] Make an API call to OpenAI (e.g., to the `/models` endpoint if available, or a hardcoded list for initial testing if dynamic fetching is complex).
    - [ ] Parse the response and return an array of `IModel` objects.
    - [ ] Ensure the `IModel` objects include `id`, `name`, `provider` (set to 'openai'), and `supportedToolFormats` (set to `['openai']`).
- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.test.ts`:
  - [ ] Add tests for `getModels` that:
    - [ ] Mock the `openai` SDK to simulate a response from the models API.
    - [ ] Assert that the `getModels` method returns the expected list of `IModel` objects.
    - [ ] Ensure the `generateChatCompletion` tests still pass.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/openai/OpenAIProvider.test.ts
```

**STOP. Wait for Phase 03a verification.**
