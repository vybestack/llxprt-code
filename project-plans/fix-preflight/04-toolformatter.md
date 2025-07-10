# Task 04 – ToolFormatter Tests

Suite: `packages/cli/src/tools/ToolFormatter.test.ts`

## Current Failures

Both tests expect `NotYetImplemented` error but implementation now throws specific provider errors.

## Actions

- Update tests to expect `.toThrow('Invalid OpenAI tool call format')` and similar for toProviderFormat.
- If spec remains NYI, wrap implementation with `throw new Error('NotYetImplemented')` to satisfy test.

## Verify

```
pnpm vitest run packages/cli/src/tools/ToolFormatter.test.ts
```
