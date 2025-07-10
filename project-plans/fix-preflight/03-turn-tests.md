# Task 03 – Turn Core Logic Tests

Suite: `packages/core/src/core/turn.test.ts`

## Current Issues

6 failing expectations due to new debug/utility path:

- Missing `getFunctionCalls` export in mocked `generateContentResponseUtilities`.
- Event counts differ (additional Error events).

## Plan

1. **Mock Update** – At top of test, change `vi.mock('../utils/generateContentResponseUtilities', ...)` to include `getFunctionCalls` stub returning `[]`.
2. **Error handling** – When mock is missing function, Turn emits Error event. After adding stub, Error events disappear; update expected arrays counts.

## Verification

```
pnpm vitest run packages/core/src/core/turn.test.ts
```

Expect 0 failures.
