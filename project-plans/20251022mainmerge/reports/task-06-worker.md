# Task 06 Worker Report

## Summary
- Cherry-picked upstream commits 765be4b61686ef7ce100b6cc0f856d73caf71a75 and 6170da2a5fa6dc97e7b25d57ca2014c7fa81c97b onto the agentic branch, keeping stateless client/runtime caching intact.
- Reconciled provider header/model-parameter propagation with local overrides by reintroducing a stateless-friendly `getClient` path, caching model params via `extractModelParamsFromSettings`, and harmonising fallback to the shared SettingsService.
- Integrated `/todo_pause` preservation hook with existing streaming queue logic by wiring `registerTodoPause` through `useGeminiStream` and `useTodoPausePreserver` while respecting agentic auto flows.

## Conflicts & Resolutions
- `packages/core/src/providers/anthropic/AnthropicProvider.ts`: Used runtime-scoped client while adding optional header injection for `messages.create`, ensuring OAuth/runtime cache logic stayed untouched.
- `packages/core/src/providers/gemini/GeminiProvider.ts`: Restored base URL handling with new `createHttpOptions()` header propagation so runtime cache + OAuth generator reuse continue to work.
- `packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts`: Switched to `await this.getAuthToken()` with fallback to resolved token before merging custom headers, preventing stale bootstrap keys.
- `packages/core/src/providers/openai/OpenAIProvider.ts`: Replaced upstream singleton client with stateless `getClient(options)` wrapper, added SettingsService fallback + `extractModelParamsFromSettings`, and kept per-runtime caches/tool formatter instantiation while supporting new tests.

## Verification
- `npx vitest run src/providers/anthropic/AnthropicProvider.test.ts src/providers/gemini/GeminiProvider.test.ts src/providers/openai-responses/OpenAIResponsesProvider.headers.test.ts src/providers/openai/OpenAIProvider.modelParamsAndHeaders.test.ts` (packages/core) – pass.
- `npx vitest run src/ui/useTodoPausePreserver.test.ts src/ui/commands/chatCommand.test.ts` (packages/cli) – pass.

## Follow-ups
- Monitor SettingsService fallbacks for providers that construct without runtime context; the new helpers rely on global service availability.
- Verify broader provider suites (`npm run test --workspaces`) before release, since only targeted suites were executed here.
