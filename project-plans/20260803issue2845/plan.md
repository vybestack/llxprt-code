# Issue #2845 — Migrate the agents workspace to Bun-native test execution

Sub-issue of #2578. This document is the accepted shape of the work: the
behavior to deliver, the boundary cases, and the evidence that proves it.

## Behavior to deliver

The `packages/agents` workspace stops executing its test suite through Vitest
and executes it through Bun's native test runner instead, with no loss of test
coverage and no change to what the tests assert.

## Accepted acceptance criteria

| ID  | Criterion                                                                                                                                                                              | Evidence                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A1  | Every `*.test.ts` / `*.test.tsx` / `*.spec.ts` file under `packages/agents` executes under Bun's native runner and passes.                                                                | `npm run test --workspace packages/agents` exits 0 and reports the full file set. |
| A2  | `test` and `test:ci` in `packages/agents/package.json` run Bun; `test:vitest` is retained as the Vitest fallback.                                                                         | package.json diff.                                                                |
| A3  | The `pretest` hook (`scripts/check-agents-api-surface.ts`) still runs and passes ahead of the Bun run.                                                                                    | `npm run test --workspace packages/agents` output shows the guard.                |
| A4  | No test file is dropped, filtered, newly skipped, or deferred. The workspace runner has **no** exclusion list, and the `.skip` census is unchanged versus `main`.                         | Runner source has no EXCLUDE set; skip census diff is empty.                      |
| A5  | Every `resolves.not.toThrow()` usage in the workspace is rewritten to a direct `await`.                                                                                                   | `grep -r "resolves.not.toThrow" packages/agents` returns nothing.                 |
| A6  | CI executes the agents workspace under Bun on the required platforms.                                                                                                                    | The `agents` shard invokes the workspace `test:ci` script, which is now Bun.      |
| A7  | Test-count parity between Vitest and Bun is verified — the Bun run executes at least as many test cases as the Vitest baseline.                                                           | Recorded baseline vs. Bun counts in `parity.md`.                                  |

## Boundary cases and inputs

These are the Bun/Vitest divergences the migration must handle. Each one is a
concrete input class observed in this workspace, not speculative hardening.

1. **`await expect(promise).resolves.not.toThrow()`** — Bun evaluates
   `not.toThrow()` against the *resolved value* rather than the settled state,
   so a promise resolving to `undefined` fails. Rewrite as a direct `await` of
   the expression (the test still fails on rejection, which is the intent).
2. **Process-wide module mocks** — Bun's `mock.module` mutates the process
   module registry, unlike Vitest's per-file module graph. Test files must run
   in isolated processes.
3. **`vi.mock()` factories referencing outer bindings** — under Bun the factory
   may observe an uninitialised binding; these need the `vi.hoisted()` pattern.
4. **`fast-check` property callbacks** — spies created inside a property body
   are re-entered on every generated case; they need explicit cleanup so counts
   asserted after `fc.assert` are not cumulative.
5. **Storage-root isolation ordering** — `bun test` does not honour Vitest
   `setupFiles`, so the isolation must run as a Bun `--preload`.
6. **Suite scale** — 330 files. A single Bun process would both share mock state
   and hit the Bun 1.3.x multi-file teardown hang already documented for the
   core workspace, so per-file isolated processes with bounded concurrency are
   required (same approach as `packages/core` and `packages/auth`).

## Non-goals (explicitly out of scope)

- Broadening the `test-setup/augment-bun-vi.ts` compatibility shim beyond what a
  concrete agents test requires.
- Refactoring the existing `packages/core` / `packages/auth` workspace runners.
- Changing what any test asserts. Rewrites are runner-compatibility only.
- Removing Vitest from the workspace (it is retained as `test:vitest`).
- Migrating any other workspace.

## Verification plan

1. Baseline: record the Vitest file count and test-case count on `main`.
2. Probe: run every agents test file in an isolated Bun process; enumerate
   failures and classify them against the boundary cases above.
3. Fix each failing file at its root cause. No file may be excluded.
4. Re-run the full Bun suite to green.
5. Compare Bun test-case count against the Vitest baseline (A7).
6. Compare the `.skip` / `.todo` census against `main` (A4).
7. Full local verification: test, lint, typecheck, format, build, CLI smoke.
