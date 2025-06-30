# Task 06 – OpenAI Provider Mocks & Integration

Suites:

- `OpenAIProvider.test.ts`
- `OpenAIProvider.integration.test.ts`
- `multi-provider.integration.test.ts`

## Failing Reasons

- Stream chunk expectations off-by-one.
- Real network calls attempted -> connection error.
- Model switch default now `gpt-4.1` vs `gpt-3.5-turbo`.

## Fix

1. Enhance vi.mock for `openai` client to emit exactly two assistant chunks.
2. Provide fake fetch for model list.
3. Update default model expectation in tests to `gpt-4.1`.

## Verify

```bash
pnpm vitest run packages/cli/src/providers/openai/*.test.ts
pnpm vitest run packages/cli/src/providers/integration/*.integration.test.ts
```
