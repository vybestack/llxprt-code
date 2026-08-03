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

## Final, after merging `origin/main` (aba9f0aff)

Merging main added one agents test file,
`src/core/CompressionProfileResolver.proxyKeyStorage.test.ts`, which main
introduced as **Bun-only**: it is listed in `scripts/bun-test-manifest.ts` and
explicitly excluded from the Vitest selection in `packages/agents/vitest.config.ts`.
So Bun legitimately runs one more file, and two more cases, than Vitest.

| Metric      | Vitest | Bun      |
| ----------- | ------ | -------- |
| Test files  | 330    | **331**  |
| Test cases  | 3728   | **3730** |
| Passed      | 3728   | 3730     |
| Failed      | 0      | 0        |
| Skipped     | 0      | 0        |
| Todo        | 0      | 0        |

Bun executes a strict superset: every one of the 3728 Vitest cases also runs
under Bun, plus the 2 cases in the Bun-only file. Nothing is dropped.

Evidence:

- `npm run test --workspace packages/agents` → `PASS: agents API-surface report
  matches expected snapshot.` followed by `Passed 331/331 test files`, exit 0.
- The merged JUnit report's root element reads `tests="3730"`.
- `npx vitest run --reporter=json` → 330 files, 3728 passed, 0 failed, 0 skipped.

## Skip census

`.skip` / `.todo` counts are unchanged versus `main`: the migration added none
(`git diff` introduces zero new `.skip(`/`.todo(` occurrences under
`packages/agents`).
