# Task 02 – useGeminiStream Hook Failures

Suite: `packages/cli/src/ui/hooks/useGeminiStream.test.tsx`

## Current State

- 6 failing tests related to session stats, user cancellation, error handling.
- Errors from mock `config` missing `getContentGeneratorConfig`.

## Root Causes

- Hook now dereferences `config.getContentGeneratorConfig()`; mock config in tests lacks this method.
- Streaming state transitions changed – `idle` vs `responding` timings.

## Fix Strategy

1. Extend mock `config` object in test helper to include minimal `getContentGeneratorConfig` returning `{ authType: 'oauth-personal' }`.
2. Adjust waitFor / expectations to match new streaming-state sequence (may need to await first update).
3. Update error message expectation to new value (`config.getModel is not a function`).

## Verification

Run:

```bash
pnpm vitest run packages/cli/src/ui/hooks/useGeminiStream.test.tsx
```

All 24 tests should pass.
