# Phase 05 – Implement getActiveProvider and setActiveProvider in ProviderManager (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `getActiveProvider` and `setActiveProvider` methods in `ProviderManager` to correctly manage the active LLM provider. The `getAvailableModels` method will remain a stub.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts` with `getActiveProvider` and `setActiveProvider` implementations.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.test.ts` with tests for `getActiveProvider` and `setActiveProvider`.

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/ProviderManager.ts`:
  - [ ] Implement `setActiveProvider(name: string)`:
    - [ ] Check if a provider with the given `name` exists in `this.providers`.
    - [ ] If it exists, set `this.activeProviderName = name`.
    - [ ] If it does not exist, throw an `Error` (e.g., `Error('Provider not found')`).
  - [ ] Implement `getActiveProvider(): IProvider`:
    - [ ] Return the `IProvider` instance from `this.providers` corresponding to `this.activeProviderName`.
    - [ ] Ensure `getAvailableModels` still throws `NotYetImplemented`.
- [ ] Update `packages/cli/src/providers/ProviderManager.test.ts`:
  - [ ] Add tests for `setActiveProvider`:
    - [ ] Test setting an existing provider.
    - [ ] Test setting a non-existent provider (expecting an error).
  - [ ] Add tests for `getActiveProvider`:
    - [ ] Test retrieving the default active provider.
    - [ ] Test retrieving an explicitly set active provider.
    - [ ] Ensure the `getAvailableModels` test still passes (i.e., still throws `NotYetImplemented`).

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/ProviderManager.test.ts
```

**STOP. Wait for Phase 05a verification.**
