# Issue #2278 — Halve E2E real-model requests and dedup non-behavioral tests

Status: accepted scope, test-first plan.

## 1. Measured starting state (evidence)

The issue text was written against an earlier tree. The current tree already
replays most E2E model turns through `FakeProvider` via the
`LLXPRT_FAKE_RESPONSES` seam (`packages/providers/src/composition/providerManagerInstance.ts:611-620`,
`packages/test-utils/src/cli-args.ts:104-128`,
`packages/test-utils/src/test-rig-setup.ts:26-46`). The remaining real-model
cost is therefore much smaller than the issue estimates, and several issue
claims are factually stale. The plan below is built on what the tree actually
does today.

### 1.1 Real-provider CLI runs per E2E matrix leg (baseline)

A `TestRig` run hits a real provider if and only if `rig.setup()` was called
without `fakeResponsesPath` (`packages/test-utils/src/test-rig.ts:198-201`,
`packages/test-utils/src/cli-args.ts:17-50`).

| # | Test (setup name)                                        | Site                                | API requests |
| - | -------------------------------------------------------- | ----------------------------------- | ------------ |
| 1 | `should be able to run a shell command`                  | `integration-tests/run_shell_command.test.ts:33` | 2 |
| 2 | `should be able to run a shell command via stdin`        | `integration-tests/run_shell_command.test.ts:66` | 2 |
| 3 | `should be able to replace content in a file`            | `integration-tests/replace.test.ts:19`           | 2 |
| 4 | `should be able to list a directory`                     | `integration-tests/list_directory.test.ts:27`    | 2 |
| 5 | `should write a session summary in non-interactive mode` | `integration-tests/session-summary.test.ts:18`   | 1 |
| 6 | `should not crash when using mixed prompt inputs`        | `integration-tests/mixed-input-crash.test.ts:20` | 0 |
| 7 | `should provide clear error message for mixed input`     | `integration-tests/mixed-input-crash.test.ts:47` | 0 |
| 8 | `should exit quickly if stdin stream does not end`       | `integration-tests/stdin-context.test.ts:30`     | 0 |
| 9 | `extension install test`                                 | `integration-tests/extensions-install.test.ts:32` | 0 |

Rows 6–9 spawn the CLI with real credentials available, but it exits during
argument/stdin validation or runs a non-model subcommand before any model turn.
Row 6 proves this in-test:
`expect(rig.readLastApiRequest()).toBeNull()` (`mixed-input-crash.test.ts:43-44`).

A tool-calling prompt costs two API requests (the tool-call turn plus the
continuation turn), measured from `telemetry.log`; see `INVENTORY.md` §1.

**Baseline: 9 fixture-less tests, 9 real model API requests per leg.**
`e2e.yml` runs three legs (macOS, Linux `sandbox:none`, Linux `sandbox:docker`),
so 15 API requests per PR; a push to `main` runs two legs.

### 1.2 The `token-tracking` family is not a real-model cost at all

All six `integration-tests/token-tracking*.test.ts` files (3223 lines, 89 `it`
cases) are pure in-process unit tests. None spawns the CLI; none contacts a
model. They import provider/CLI symbols directly and stub them. So the issue's
"~4 real-model sessions → 1" target does not apply. Their real cost is
**wall-clock, paid three times** (once per E2E leg) for coverage that belongs in
the sharded CI test matrix, plus genuine duplication.

### 1.3 Already delivered elsewhere — not re-done here

Issue proposal 4 ("shard/parallelize") is already implemented: `ci.yml` has a
dynamic affected-shard matrix (`shard_selector` at `.github/workflows/ci.yml:134`,
`test_shard` at `:936`, backed by `scripts/test-shards.ts`,
`scripts/affected-test-shards.ts`, guarded by `scripts/check-test-shards.ts` and
`scripts/check-affected-test-shards.ts`). Cross-platform full runs already moved
to `nightly.yml`.

## 2. Accepted scope

### AC1 — Real-provider E2E usage is instrumented and enforced

**Behavior.** The E2E harness records every real-provider CLI run, and a guard
fails the build when the suite's real-provider usage exceeds a declared,
reviewed budget.

1. `packages/test-utils/src/model-request-ledger.ts`
   - `recordRealProviderRun(record)` appends one JSON line to the file named by
     `LLXPRT_E2E_MODEL_LEDGER`. When that variable is unset or empty it is a
     no-op (so `evals/`, local `bun test`, and unit suites are unaffected).
   - `readLedger(path)` parses the file into records.
2. `TestRig.run`, `TestRig.runInteractive` and `TestRig.runCommand` call
   `recordRealProviderRun` exactly when `fakeResponsesPath === undefined`,
   recording the setup test name and test directory. `runCommand` is included
   because it does not inject the fake-provider flags, so without a fixture its
   child inherits whatever real credentials the environment holds.
3. `integration-tests/real-model-budget.ts` is the single source of truth:
   the measured baseline (`BASELINE_REAL_MODEL_API_REQUESTS = 9`), the enforced
   ceiling (`MAX_REAL_MODEL_API_REQUESTS = 4`), and one entry per permitted
   fixture-less test with its measured `apiRequestsPerRun` and a `reason`. The
   cost unit is API requests measured from `telemetry.log`, not CLI invocations:
   a tool-calling prompt costs two requests (the tool-call turn plus the
   continuation turn).
4. `scripts/check-e2e-model-budget.ts`
   - `--validate-budget` mode (no ledger needed): fails on duplicate test names,
     negative or fractional `apiRequestsPerRun`, an empty `reason`, a ceiling
     that is not at most half the baseline, or an entry naming a `rig.setup()`
     call that no longer exists anywhere in `integration-tests/`. Wired as
     `npm run lint:e2e-model-budget`, added to the CI `lint` job alongside the
     other `lint:*` guards and to `scripts/lint-all.sh`.
   - `--ledger <path>` mode: fails when a ledger line is malformed, when a
     recorded test name is absent from the budget, or when the summed
     `apiRequestsPerRun` of the DISTINCT recorded tests exceeds the ceiling.
     Billing is per distinct test, not per record, because the
     `integration-tests` root is configured with `retries: 2` and a retry
     re-spawns the whole file, so duplicate records are legitimate and billing
     per record would fail a green leg. The report prints run counts so a retry
     stays visible. An absent ledger means no fixture-less run occurred and is
     reported as zero rather than an error.
5. `e2e.yml` sets `LLXPRT_E2E_MODEL_LEDGER` on the test steps of all three legs
   and runs the ledger check after the tests succeed.

**Boundary cases to test.** Ledger env unset → no file created, no throw.
Ledger env set to a path in a not-yet-created directory → directory created.
Empty ledger → 0 runs, exit 0. Absent ledger → 0 runs, exit 0 (no fixture-less
run occurred). Distinct-test total exactly at ceiling → exit 0; one over → exit 1
naming the offending tests. A test recorded three times (retry) → billed once and
reported with its run count. Test name absent from the budget → exit 1 naming it.
Malformed JSON line → exit 1 quoting the line. Concurrent appends from parallel
test processes → every record counted (append-mode writes).

### AC2 — Real model API requests per leg reduced 9 → 4 (55.6%)

Converted to checked-in `FakeProvider` fixtures, keeping every existing
behavioral assertion (real tool execution, real filesystem effects, real
session-summary JSON) and replaying only the model turn:

- `integration-tests/list_directory.test.ts` → new `list-directory.responses.jsonl`
- `integration-tests/session-summary.test.ts` → new `session-summary.responses.jsonl`
- `integration-tests/run_shell_command.test.ts` › `should be able to run a shell command via stdin`
  → new `run-shell-command.stdin.responses.jsonl`

Retained real-model canaries (one per behavior category that genuinely tests
model tool selection):

- `run_shell_command.test.ts` › `should be able to run a shell command` — shell
  tool-selection canary.
- `replace.test.ts` — context-aware text-manipulation canary.

Rationale for the stdin conversion: the args-path canary already proves the
model selects `run_shell_command`; the stdin variant's distinct coverage is the
CLI's stdin plumbing, which the fixture path exercises unchanged.

`e2e.yml`'s `--testNamePattern` for `run_shell_command.test.ts` is left
unchanged. That invocation is not inherently a real-provider one — each test's own
`rig.setup()` decides — so the now-fixture-backed stdin test still runs there at
zero cost. Narrowing the pattern would have stopped both the stdin test and the
already-fixture-backed `should run a platform-specific file listing command` from
running in CI at all.

### AC3 — `token-tracking` consolidated 6 files → 1, no behavioral coverage lost

- Survivor: `integration-tests/token-tracking.test.ts`, rewritten to hold the
  canonical member of each overlap cluster plus every unique behavior.
- Deleted: `token-tracking-behavioral`, `token-tracking-provider-behavioral`,
  `token-tracking-ui-behavioral`, `token-tracking-integration`,
  `token-tracking-property`.
- New `packages/cli/src/ui/utils/tokenFormatters.test.ts` — `tokenFormatters.ts`
  currently has **no** unit test outside `integration-tests/`; its boundary
  behavior moves into the `cli` shard so it runs once in CI instead of three
  times in E2E. The survivor itself still runs on all three E2E legs, because
  `integration-tests/` is not an npm workspace and so no CI shard owns it;
  consolidation cuts that per-leg cost rather than relocating it.
- Non-behavioral cases are deleted, not migrated.

The consolidation map (clusters, canonical survivors, unique behaviors,
non-behavioral deletions) is recorded in `INVENTORY.md` beside this plan and
must be verified against the sources before any deletion.

### AC4 — Documented inventory

- `project-plans/issue-2278/INVENTORY.md`: before/after real-provider run and
  API-request counts with file:line evidence; the token-tracking consolidation
  map; the budget policy and how to raise it.
- `integration-tests/TESTING_STRATEGY.md` updated: its "Minimum Real LLM
  Coverage" table currently names canaries that no longer exist
  (`save_memory.test.ts`), are already fake (`file-system.test.ts`), or are
  excluded from CI (`todo-continuation.e2e.test.ts`). Replace it with the
  enforced budget and point at `real-model-budget.ts`.

## 3. Explicitly out of scope

- CI/E2E sharding and parallelism changes — already delivered (§1.3).
- E2E quota fail-fast / failure-cascade short-circuit — issue #2279.
- Token spend as a metric distinct from request count. This change instruments
  and enforces request count only; `INVENTORY.md` §6 records why requests are a
  sound proxy here and what measuring tokens would require.
- "CI + E2E daily-mean wall-clock < 10 min sustained over a week on `main`" —
  not verifiable inside a PR. The enforceable deliverables here are the
  guard-enforced request budget (AC1/AC2) and the reduction of the in-process
  token-tracking suite from 3223 lines / 88 cases to 582 lines / 17 cases on each
  of the three E2E legs (AC3).
- Giving `integration-tests/` a CI shard so its fixture-backed, in-process tests
  stop running once per E2E leg. A real remaining inefficiency, but it changes
  the shard model owned by #2707/#2709.
- Downgrading any tool-mirror test not named in AC2.
- Touching test files, workflows, or shard maps owned by other issues.

## 4. Test-first order

1. `scripts/tests/check-e2e-model-budget.test.ts` — budget validation and ledger
   accounting behaviors from AC1, including every boundary case. RED first.
2. `packages/test-utils/src/model-request-ledger.test.ts` — record/read
   behaviors, env-unset no-op, directory creation, malformed-line rejection,
   concurrent appends. RED first.
3. Wire `TestRig` to the ledger; extend
   `packages/test-utils/src/test-rig.test.ts` to assert a real-provider run is
   recorded and a fake-responses run is not.
4. AC2 conversions, each verified by running the converted integration test
   locally with `npm run test:integration:sandbox:none -- <file>` (no API key
   required once the fixture exists) and asserting the pre-existing assertions
   still hold unchanged.
5. `packages/cli/src/ui/utils/tokenFormatters.test.ts` — RED first against the
   real formatter.
6. Rewrite the surviving `token-tracking.test.ts`; delete the five redundant
   files only after the survivor plus the new formatter test are green.
7. Docs (`INVENTORY.md`, `TESTING_STRATEGY.md`) and workflow wiring last.

## 5. Verification gate

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, `npm run lint:e2e-model-budget`, `npm run lint:test-shards`,
`npm run lint:test-file-coverage`, `npm run lint:cli-test-discovery`,
`npm run test:integration:sandbox:none` for every converted fixture test, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
