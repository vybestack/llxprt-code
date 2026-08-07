# Issue #2923 — CLI test files must never be silently excluded

## 1. Ground truth on `main` (measured, not assumed)

The issue was filed against a Vitest setup that no longer exists. PR #3056
("Migrate the CLI workspace to Bun-native test execution", Fixes #2843) deleted
`packages/cli/vitest.config.ts`, `packages/cli/vitest.test-groups.ts`,
`baseExclude` and `SELECTED_FILE_COUNT`, and replaced them with
`packages/cli/run-bun-tests.ts`, which discovers test files structurally with —
in its own words — "no manifest, allow-list or exclude list".

Measurements taken on `main` at 42ca2a989:

| Check                                                                | Result       |
| -------------------------------------------------------------------- | ------------ |
| `git ls-files packages/cli` matching `.(test\|spec\|bun).(ts\|tsx)`    | 670          |
| `discoverTestFiles()` from `run-bun-tests.ts`                          | 670          |
| Structurally excluded files                                            | **0**        |
| Issue repro: `bun test ./src/ui/components/ModelConfigDialog.test.tsx` | **21 pass**  |
| `src/ui/components/*.test.tsx`, one process per file                   | **39/39 pass** |
| Files containing unconditional `describe.skip`/`it.skip`/`test.skip`   | **0**        |
| Tracked test files inside skipped dirs (`dist`, `coverage`, dot-dirs…) | **0**        |
| Tracked test files outside `TEST_ROOTS`                                | **0**        |

CI path confirmed: `npm run test:ci --workspaces` → `packages/cli` →
`bun run-bun-tests.ts`. The runner used in CI is the runner measured above.

### Conditional-skip audit (a qualification, not a structural exclusion)

"Nothing is excluded" is a claim about **discovery**: no tracked test file is
structurally unreachable. It is not a claim that every discovered file executes
assertions in every environment. A separate audit of `skipIf` found:

- Most uses are platform gates (`process.platform === 'win32'`, clipboard
  availability, unreadable-path support). These are legitimate: the case cannot
  run on that OS, and it does run on the others.
- One file, `packages/cli/test/ui/commands/authCommand-logout.test.ts`, gates
  all four of its suites on `process.env.CI === 'true'`. Measured: under
  `CI=true` it reports **0 pass / 21 skip**; under `CI=false`, **21 pass**.

That file is discovered and invoked — the runner and this guard both do their
job — but it asserts nothing on CI. It is an explicit, greppable, deliberate
skip rather than the silent structural exclusion #2923 is about, and unpicking
an OAuth logout suite is a different subsystem. It is therefore **out of scope
here and reported separately** rather than fixed in this change.

### Consequence for the issue's three proposed resolutions

1. **"Fix the harness so Ink component tests can render, delete the exclude
   patterns, raise `SELECTED_FILE_COUNT`."** — Already satisfied. The exclude
   patterns and the count oracle are gone; the Ink component tests render and
   pass. Nothing to do.
2. **"Delete any genuinely superseded test file rather than leaving it
   excluded."** — Vacuous. Nothing is excluded, so nothing is left excluded.
   No test file is deleted by this change.
3. **"Add a guard so a test file cannot be added without landing in exactly one
   routing group, making a future silent exclusion fail loudly."** —
   **Not satisfied. This is the work.**

## 2. The gap that remains

`run-bun-tests.ts` walks a hardcoded root list:

    const TEST_ROOTS = ['src', 'test', 'test-bun', 'test-utils'];

A tracked test file added anywhere else under `packages/cli` — `scripts/`,
`bin/`, the workspace root, or any new directory — is silently never run, and
every existing test still passes. `packages/cli/scripts/` and
`packages/cli/bin/` already exist, so this is reachable, not hypothetical.

The existing tests in `packages/cli/test/run-bun-tests.test.ts` pin discovery
behaviour against synthetic temp directories only. Nothing asserts that the
**real** workspace is fully covered, so the exact regression #2923 describes —
a test file that exists but never runs — would reproduce today without any
signal.

## 3. Accepted behaviour

A repo guard, modelled on the established `scripts/check-*.ts` pattern
(`check-test-shards.ts`, `check-no-new-js-files.ts`), that fails loudly when a
CLI test file is not run.

| ID  | Behaviour |
| --- | --------- |
| AC1 | When a tracked test file under `packages/cli` is not returned by the runner's `discoverTestFiles()`, the guard exits non-zero and names the offending file(s) with an actionable fix message. |
| AC2 | Against the real repo as it stands, the guard exits 0 and reports the covered count. |
| AC3 | When `discoverTestFiles()` returns the same file more than once, the guard exits non-zero — the "exactly one" half of the contract. |
| AC4 | The guard classifies repo files using its **own** pattern constant, independent of the runner's `TEST_FILE_PATTERN`. Narrowing the runner's pattern (e.g. dropping `.bun`) must fail the guard rather than silently shrink both sides of the comparison. |
| AC5 | The guard runs on every PR: wired into `package.json` as a `lint:*` script and invoked from the CI lint job next to the sibling guards. |
| AC6 | Behavioural tests prove AC1–AC4 — pure comparison helpers directly, the real repo end-to-end, and a temp git repo where a rogue test file outside the roots produces the exact failure message. |

### Inputs and boundary cases

- **Oracle is `git ls-files`.** Untracked local scratch files must NOT fail the
  guard; they are not part of the repo and CI never sees them. A new test file
  is caught when it is committed, which is the gate that matters.
- `node_modules`, `dist`, `coverage` are gitignored, therefore never tracked,
  therefore never candidates.
- A tracked test file inside a directory the runner skips (`__snapshots__`, a
  dot-directory) is a real silent exclusion and must fail. None exist today.
- Paths are normalised to POSIX so the guard behaves identically on Windows.
- `git` missing or the directory not being a repo fails closed with a
  diagnosable message, never a raw stack trace.

### Explicitly out of scope

- Changing `TEST_ROOTS` or any runner discovery behaviour. The guard makes the
  gap loud; widening discovery is a separate decision.
- Any other workspace's test configuration.
- Deleting or rewriting any test file.
- Re-introducing a file-count oracle. Set equality against `git ls-files` is
  strictly stronger than the `SELECTED_FILE_COUNT` integer the issue names, and
  does not generate churn on every added test.

## 4. Deliverables

- `scripts/check-cli-test-discovery.ts` — the guard. `evaluateDiscovery()` holds
  the whole decision and returns a verdict plus the exact text to print;
  `main()` is a thin shell over it (gather inputs, print, exit) so both halves
  of the contract are covered by tests of real decision-making rather than of
  helpers the program might not consult. `findUndiscoveredTestFiles()` and
  `findDuplicateDiscoveries()` are exported for direct unit coverage.
- `scripts/tests/check-cli-test-discovery.bun.test.ts` — behavioural tests
  (`bun:test`).
- `package.json` — `lint:cli-test-discovery` script.
- `.github/workflows/ci.yml` — guard step in the lint job.

## 5. Evidence required to close

- Guard passes on the real repo (AC2), and fails with the named file in a temp
  repo (AC1) and on a duplicate (AC3) and on a narrowed runner pattern (AC4).
- `npm run test`, `lint`, `typecheck`, `format`, `build`, and the CLI smoke all
  pass locally.
- CI green on the PR.
