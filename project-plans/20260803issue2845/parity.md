# Issue #2845 — agents workspace test-count parity evidence

## Vitest baseline (branch point: `main` @ 74744d648)

Command:

    cd packages/agents && npx vitest run --reporter=json --outputFile=<report>

| Metric            | Value |
| ----------------- | ----- |
| Test files        | 330   |
| Suites (describe) | 1275  |
| Test cases        | 3728  |
| Passed            | 3728  |
| Failed            | 0     |
| Skipped / pending | 0     |
| Todo              | 0     |

Note: issue #2845 quotes 348 files from `dev-docs/test-runner-inventory.md`.
The actual count on the branch point is 330 — the inventory figure predates
subsequent consolidation. Both runners agree on 330, so nothing is missing.

## Bun probe of the unmodified suite (before migration fixes)

Every file executed in its own `bun test <file>` process with the workspace
`bunfig.toml` preloads (compat shim + Storage isolation):

| Metric              | Value |
| ------------------- | ----- |
| Test files executed | 330   |
| Files passing       | 296   |
| Files failing       | 34    |

The 34 failing files and their raw output are recorded in
`bun-probe-failures.txt`. Each was fixed at its root cause; none were excluded.

## Bun result after migration

Per-file test-case names were captured with Bun's JUnit reporter
(`bun test <file> --reporter=junit`) and counted across all 330 files.

| Metric      | Vitest | Bun  |
| ----------- | ------ | ---- |
| Test files  | 330    | 330  |
| Test cases  | 3728   | 3728 |
| Failed      | 0      | 0    |
| Skipped     | 0      | 0    |

**Exact parity: 3728 = 3728 test cases across 330 files.**

## Runner behaviour discovered during verification

Two findings shaped `packages/agents/run-bun-tests.ts`:

1. **Bun 1.3.14 ignores `[test] timeout` in `bunfig.toml`.** A file declaring
   `timeout = 30000` still ran with Bun's 5s default. Verified with a probe
   test that sleeps 8s: it fails via `bunfig.toml` and passes with
   `--timeout 30000` on the command line. The runner therefore passes the
   timeout explicitly so the workspace keeps the `testTimeout: 30000` budget it
   had under Vitest.

2. **Concurrency has to stay below the core count.** Suites under
   `src/api/__tests__/` build a real Agent per test. Running eight of those at
   once on a loaded machine pushed individual tests past 30s, producing
   non-deterministic failures in a different file on each run. The runner uses a
   sliding worker pool (rather than fixed batches, which idled workers behind
   the slowest file in a batch) with a default concurrency of 4, overridable via
   `LLXPRT_AGENTS_TEST_CONCURRENCY`.
