# Phase 20 – Integrate AnthropicProvider into ProviderManager (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To integrate the `AnthropicProvider` into the `ProviderManager`, allowing the CLI to use Anthropic models. This involves registering the `AnthropicProvider` instance and ensuring it receives the correct configuration (API key, base URL).

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.ts` to register and configure `AnthropicProvider`.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/ProviderManager.test.ts` to test Anthropic provider registration and activation.

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/ProviderManager.ts`:
  - [ ] Import `AnthropicProvider` from `../anthropic/AnthropicProvider`.
  - [ ] In the `ProviderManager` constructor, register an instance of `AnthropicProvider`.
  - [ ] Ensure the `AnthropicProvider` constructor receives the `apiKey` and `baseURL` (similar to how `OpenAIProvider` is configured).
- [ ] Update `packages/cli/src/providers/ProviderManager.test.ts`:
  - [ ] Add a test to verify that `AnthropicProvider` is registered by default.
  - [ ] Add a test to verify that `setActiveProvider('anthropic')` works correctly.
  - [ ] Add a test to verify that `getAvailableModels('anthropic')` returns models from the Anthropic provider.
  - [ ] Ensure all existing tests still pass.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/ProviderManager.test.ts
```

**STOP. Wait for Phase 20a verification.**
