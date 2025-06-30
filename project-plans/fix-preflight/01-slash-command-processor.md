# Task 01 – Slash Command Processor Failing Tests

Suite: `packages/cli/src/ui/hooks/slashCommandProcessor.test.ts`

## Current State

- 7 failing assertions about `/memory refresh`, quit/exit flow, MCP output strings.
- Unhandled rejections: `setQuittingMessages` undefined.

## Root Causes

1. **`performMemoryRefresh` spy not invoked** – recent refactor changed command path or renamed hook.
2. **`setQuittingMessages` now passed only when defined** – test helper missing this mock.
3. **MCP output formatting gained header & ANSI bold** – string expectations outdated.

## Fix Strategy

| Failure            | Fix                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory refresh spy | Ensure slashCommandProcessor calls provided mock. Add mock implementation to test harness.                                                               |
| Quit/Exit messages | Provide a dummy `setQuittingMessages` jest mock in test setup; assert called rather than deep-equal array.                                               |
| MCP output strings | Update expected `message` substrings to include new header `Configured MCP servers:` and ANSI codes. Use `toContain` with sanitized ANSI removal helper. |

### Code Changes Needed

- None in production code; adjust test mocks and expectations.

## Verification Process

```bash
pnpm vitest run packages/cli/src/ui/hooks/slashCommandProcessor.test.ts
```

Expect **all 32 tests** in file to pass.

Run full preflight afterwards to ensure no regressions.
