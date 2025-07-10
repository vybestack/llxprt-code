# Phase 06 – Implement getAvailableModels in ProviderManager (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `getAvailableModels` method in `ProviderManager` to fetch available models from the currently active LLM provider.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts` with `getAvailableModels` implementation.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.test.ts` with tests for `getAvailableModels`.

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/ProviderManager.ts`:
  - [ ] Implement `async getAvailableModels(providerName?: string): Promise<IModel[]>`:
    - [ ] If `providerName` is provided, retrieve that specific provider and call its `getModels()` method.
    - [ ] If `providerName` is not provided, call `this.getActiveProvider().getModels()`.
    - [ ] Handle cases where the specified provider is not found.
- [ ] Update `packages/cli/src/providers/ProviderManager.test.ts`:
  - [ ] Add tests for `getAvailableModels`:
    - [ ] Mock the `getModels` method of the `MockOpenAIProvider` (or any other mock provider) to return a predefined list of models.
    - [ ] Assert that `getAvailableModels` returns the expected list of models when no `providerName` is specified.
    - [ ] Add a test case for when a specific `providerName` is given.
    - [ ] Add a test case for when a non-existent `providerName` is given (expecting an error).
    - [ ] Ensure all previous tests still pass.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/ProviderManager.test.ts
```

**STOP. Wait for Phase 06a verification.**
