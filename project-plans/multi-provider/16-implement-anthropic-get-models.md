# Phase 16 – Implement getModels for AnthropicProvider (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `getModels` method in `AnthropicProvider` to dynamically fetch available models from the Anthropic API. The `generateChatCompletion` method will remain as implemented in the previous phase.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.ts` with `getModels` implementation.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.test.ts` with tests for `getModels`.

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/anthropic/AnthropicProvider.ts`:
  - [ ] Implement `getModels` to:
    - [ ] Make an API call to Anthropic (e.g., to a models endpoint if available, or a hardcoded list for initial testing if dynamic fetching is complex).
    - [ ] Parse the response and return an array of `IModel` objects.
    - [ ] Ensure the `IModel` objects include `id`, `name`, `provider` (set to 'anthropic'), and `supportedToolFormats` (set to `['anthropic']`).
- [ ] Update `packages/cli/src/providers/anthropic/AnthropicProvider.test.ts`:
  - [ ] Add tests for `getModels` that:
    - [ ] Mock the `@anthropic-ai/sdk` to simulate a response from the models API.
    - [ ] Assert that the `getModels` method returns the expected list of `IModel` objects.
    - [ ] Ensure the `generateChatCompletion` tests still pass.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/anthropic/AnthropicProvider.test.ts
```

**STOP. Wait for Phase 16a verification.**
