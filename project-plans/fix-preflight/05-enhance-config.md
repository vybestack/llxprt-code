# Task 05 – enhanceConfigWithProviders Tests

Suite: `packages/cli/src/providers/enhanceConfigWithProviders.test.ts`

## Problems

Expectations assume wrapper of `refreshAuth` and provider manager spy calls but logic changed.

## Steps

1. Inject ProviderManager mock earlier; ensure wrapper sets new function reference; adjust expectation if now same.
2. Provide non-null `getContentGeneratorConfig` in mock GeminiClient for `countTokens` checks.

## Verify

`pnpm vitest run packages/cli/src/providers/enhanceConfigWithProviders.test.ts`
