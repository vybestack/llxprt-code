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

2. **Concurrency has to stay below the core count.** Every file is a fresh
   process that re-executes the whole agents module graph, and suites under
   `src/api/__tests__/` additionally build a real Agent per test. Running eight
   of those at once pushed individual tests past 30s, producing failures in a
   different file on each run. The runner uses a sliding worker pool (rather
   than fixed batches, which idled workers behind the slowest file in a batch)
   sized at half the core count and clamped to [2, 4], overridable via
   `LLXPRT_AGENTS_TEST_CONCURRENCY`.

   Measured on a 16-core machine that was concurrently hosting several
   unrelated heavy workloads: concurrency 8 produced 1–5 failing files per run,
   concurrency 4 produced 0–1 in ~70s, and concurrency 2 produced 0–1 in ~95s.
   Because the residual failure rate did not track concurrency, the remaining
   variance was external load rather than self-contention; every affected file
   passed 5–10 consecutive times in isolation in 1–2s. For reference, the
   Vitest agents CI shard took roughly 289s.

3. **JUnit reports are merged, not summarised.** Each child writes its own Bun
   JUnit report and the runner splices them into one `junit.xml`. A file-level
   summary would have reported 330 pseudo test cases instead of the 3728 real
   ones and lost every test name and duration that CI publishes. The merged
   report independently confirms the parity figure above: its root element
   reads `tests="3728"`.
