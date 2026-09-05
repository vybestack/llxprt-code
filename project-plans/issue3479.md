# Issue 3479: Stable orphan-reaping fixture compilation

## Scope

Keep the timeout correction in `packages/cli/src/utils/sandbox-orphan-reaping.bun.test.ts` and the fixture compiler in a bounded CLI test utility. Preserve the non-UTC regression behavior. Do not add retries, sleeps, or changes to sandbox product code.

## Evidence and root cause

The retained full-suite log at `tmp/issue3450/post-main/npm-test.log` shows the non-UTC child reporting a timed-out hook after 6.6 seconds and killing one dangling process while compiling `ps`. The parent CLI orchestrator supplies a larger Bun per-test timeout, but `rerunInNonUtcTimezone` launched its nested `bun test` without forwarding any timeout. The child therefore used Bun's five-second default while its `beforeAll` hook compiled four native fixtures. Concurrent suite load pushed fixture setup past that limit, and Bun terminated the active compiler. The helper then discarded the unsuccessful result's status and stdout, producing only `Failed to compile ps:` because stderr was empty.

The immediate isolated rerun passed because the same setup completed below the child's default timeout when the machine was no longer under full-suite load.

## Test-first plan

1. Add a deterministic behavior test that compiles invalid fixture source and requires a diagnostic containing the exact status and serialized stdout and stderr.
2. Confirm the test fails against the existing stderr-only message.
3. Format every unsuccessful compiler result with status, stdout, and stderr. Retain the spawn error as a cause when one exists.
4. Give the non-UTC child the same explicit fixture timeout already used by its parent test and compiler processes.
5. Run the complete fixture suite repeatedly and concurrently, then run targeted format, lint, typecheck, and relevant package tests.

## TDD evidence

- RED: `tmp/issue3479/red/compile-diagnostics.log` fails because the existing message contains only trimmed stderr.
- GREEN: `tmp/issue3479/green/extracted-compiler-test.log` passes after the helper reports status and both streams.
- Complete focused suite: `tmp/issue3479/focused/isolated-after-extraction.log` passes all 23 unchanged orphan-reaping cases, including the non-UTC behavior.
- The helper was extracted into `packages/cli/test-utils/` after targeted ESLint exposed the owning suite's existing `max-lines` boundary. The extraction keeps new diagnostics coverage out of the already large regression suite.

## Verification

- `tmp/issue3479/concurrent-final-state/` records four simultaneous runs against the final working tree, each passing all 23 orphan-reaping cases.
- `tmp/issue3479/orchestrator/cli-final.log` records the normal 724-file CLI orchestrator at concurrency 4. JUnit records both changed suites as passing. The run's sole failure was the unrelated JSC memory sampler flake filed as #3488, and its immediate isolated rerun passed 8 of 8 cases.
- Targeted ESLint, Prettier, CLI typecheck, document placement, diff checks, and test-audit checks pass. The final test-audit scan reports no finding for either changed test file.
