# Issue #2278 — E2E cost inventory, before and after

Companion to `PLAN.md`. Ledger of every consolidation and conversion, and the
evidence for the before/after numbers.

## 1. Real model API requests per E2E matrix leg

A `TestRig` invocation reaches a real provider if and only if `rig.setup()` was
called without `fakeResponsesPath`; otherwise the model turn is replayed from a
checked-in fixture through `FakeProvider`
(`packages/test-utils/src/cli-args.ts`,
`packages/providers/src/composition/providerManagerInstance.ts`).

`.github/workflows/e2e.yml` runs `integration-tests/` twice per leg: once with
`--exclude` for `todo-continuation.e2e.test.ts` and `run_shell_command.test.ts`,
then once for `run_shell_command.test.ts` alone under a three-name
`--testNamePattern`. Only tests selected by those two invocations cost anything.

### Counting unit: API requests, not CLI invocations

One CLI invocation is **not** one API request. A prompt that provokes a tool call
costs two: the turn that emits the tool call, and the continuation turn that
reports the tool result. This was measured, not assumed — running a converted
test with `KEEP_OUTPUT=true` and reading the run's `telemetry.log` shows two
`api_request` events for `list_directory` (prompt ids `<id>` and
`<id>#continuation#1`) and one for `session-summary`, which issues no tool call.
`packages/providers/src/fake/FakeProvider.ts` consumes exactly one fixture turn
per request, so the turn count of each `*.responses.jsonl` corroborates the
figure.

### Before

| Test (setup name) | File | API requests |
| --- | --- | --- |
| `should be able to run a shell command` | `run_shell_command.test.ts` | 2 |
| `should be able to run a shell command via stdin` | `run_shell_command.test.ts` | 2 |
| `should be able to replace content in a file` | `replace.test.ts` | 2 |
| `should be able to list a directory` | `list_directory.test.ts` | 2 |
| `should write a session summary in non-interactive mode` | `session-summary.test.ts` | 1 |
| `should not crash when using mixed prompt inputs` | `mixed-input-crash.test.ts` | 0 |
| `should provide clear error message for mixed input` | `mixed-input-crash.test.ts` | 0 |
| `should exit quickly if stdin stream does not end` | `stdin-context.test.ts` | 0 |
| `extension install test` | `extensions-install.test.ts` | 0 |
| **Total** | | **9** |

The zero-cost rows spawn the CLI with real credentials available but exit before
any model turn — argument validation, unterminated stdin, or an `extensions`
subcommand. `mixed-input-crash.test.ts` asserts this directly with
`expect(rig.readLastApiRequest()).toBeNull()`.

### After

| Test (setup name) | Disposition | API requests |
| --- | --- | --- |
| `should be able to run a shell command` | kept real — shell tool-selection canary | 2 |
| `should be able to replace content in a file` | kept real — text-manipulation canary | 2 |
| `should be able to run a shell command via stdin` | converted → `run-shell-command.stdin.responses.jsonl` | 0 |
| `should be able to list a directory` | converted → `list-directory.responses.jsonl` | 0 |
| `should write a session summary in non-interactive mode` | converted → `session-summary.responses.jsonl` | 0 |
| `should not crash when using mixed prompt inputs` | unchanged (never reaches a provider) | 0 |
| `should provide clear error message for mixed input` | unchanged (never reaches a provider) | 0 |
| `should exit quickly if stdin stream does not end` | unchanged (never reaches a provider) | 0 |
| `extension install test` | unchanged (never reaches a provider) | 0 |
| **Total** | | **4** |

**9 → 4 API requests per leg, a 55.6% reduction**, meeting the issue's ≥50%
criterion. Across the three-leg PR matrix that is 27 → 12.

### What each conversion preserves

No assertion was removed or weakened. Only the model turn is replayed; tool
execution, filesystem effects and CLI output remain real.

| Converted test | Assertions kept |
| --- | --- |
| `list_directory` | `expectToolCallSuccess(['list_directory'])` — the real assertion, which throws. The fixture emits a real `list_directory` tool call that the CLI executes against the real temp directory. `validateModelOutput` is also still called, but note it is **not** an assertion: it throws only on empty output and merely warns on missing content (`packages/test-utils/src/util.ts`). |
| `session-summary` | `--session-summary` still writes real JSON; the same three assertions on `summary`, `sessionMetrics.models` and `sessionMetrics.tools` hold, which required the fixture to carry `metadata.usage`. |
| `run_shell_command` via stdin | still runs through real stdin piping (`rig.run({ stdin })`); `waitForToolCall('run_shell_command')` unchanged; the fixture's `echo test-stdin` is really executed. |

The only change to each of these three files is the added `fakeResponsesPath`.

### Why these two canaries stay real

They are the only remaining coverage that the model *chooses the right tool* from
a natural-language prompt. `run_shell_command` covers shell tool selection;
`replace` covers a context-aware edit. A fixture cannot test a model decision —
replacing these with fixtures would be mock theater under
`integration-tests/TESTING_STRATEGY.md`.

## 2. How the reduction is enforced, not just performed

`integration-tests/real-model-budget.ts` declares every test permitted to run
without a fixture, its measured per-run API cost, and why.
`TestRig.run`, `runInteractive` and `runCommand` append each such invocation to
the ledger named by `LLXPRT_E2E_MODEL_LEDGER` (a no-op when unset, so local runs,
unit suites and `evals/` are unaffected). `scripts/check-e2e-model-budget.ts`
then:

- validates the budget (`npm run lint:e2e-model-budget`, wired into the CI
  `lint` job and `scripts/lint-all.sh`): no duplicates, no negative or
  fractional costs, no empty justification, a ceiling at most half the measured
  baseline, and no entry naming a `rig.setup()` call that no longer exists; and
- checks the ledger after each E2E leg: a recorded test that is not in the
  budget fails the build, and the message tells the author to add
  `fakeResponsesPath` or justify a budget entry.

The ceiling is applied to the **distinct** tests recorded, not to the number of
records. `scripts/bun-test-roots.ts` gives the `integration-tests` root
`retries: 2` and `scripts/run_bun_tests.ts` re-spawns the whole file on a retry,
so a flaky-then-passing leg legitimately writes duplicate records; billing per
record would fail a green build. The report prints the run count per test so a
retry stays visible.

### Known limits of the guard

Stated plainly so the guarantee is not overclaimed:

- It covers `TestRig`. A test that spawns the CLI directly, without `TestRig`,
  is not recorded. `TESTING_STRATEGY.md` directs authors to route model-bearing
  runs through `TestRig`.
- The per-run cost is a reviewed declaration, not a live measurement. A test that
  provokes a longer tool loop than its entry claims would under-report. The
  declared figures here were measured from `telemetry.log`.
- The ledger is written only when `LLXPRT_E2E_MODEL_LEDGER` is set, i.e. by
  `e2e.yml`. Real requests spent by other workflows or by `evals/` are out of its
  scope.
- The macOS E2E job is `continue-on-error: true` (pre-existing), so only the two
  Linux legs can actually block on a violation.

## 3. Real-provider tests that E2E CI never selects

`e2e.yml` excludes `integration-tests/run_shell_command.test.ts` from its main
invocation and re-runs only three named cases. Three real-provider cases in that
file are consequently never executed in CI:

- `should succeed with --yolo mode`
- `should allow all with "ShellTool" and other specific tools`
- `should propagate environment variables`

`codexImage.real.test.ts` is likewise skipped whenever `CI` is set or the
real-provider opt-in is absent. All four are recorded in the budget with their
true cost so the inventory is complete; they contribute nothing to the per-leg
total because they do not run. They are also, therefore, providing no CI
coverage. Deciding whether to convert them to fixtures (restoring coverage at
zero cost) or delete them is deliberately **out of scope here**.

## 4. Duplicate and non-behavioral test removal

See `TOKEN-TRACKING-CONSOLIDATION.md` for the case-by-case audit trail.

Six `integration-tests/token-tracking*.test.ts` files (3223 lines, 88 real `it`
cases) were pure in-process unit tests: they never spawned the CLI and never
contacted a model, yet ran on every E2E leg. They are now:

- **one** survivor, `integration-tests/token-tracking.test.ts` (582 lines, 17
  cases), holding the genuine cross-package integration — `ProviderManager`
  session accumulation, `ProviderPerformanceTracker` metrics, per-provider
  `extractTokenCountsFromResponse`, and `retryWithBackoff` throttle tracking;
- **plus** a new `packages/cli/src/ui/utils/tokenFormatters.test.ts` (11 cases).
  `tokenFormatters.ts` previously had no unit test anywhere outside
  `integration-tests/`.

Net effect per E2E leg: 3223 lines / 88 cases → 582 lines / 17 cases, a removal
of 2641 lines and 71 cases from each of the three legs. The survivor still runs
on all three legs: `integration-tests/` is not an npm workspace, so no entry in
`scripts/test-shards.ts` owns it and no CI job runs it. This change reduces that
per-leg cost; it does not relocate it. The formatter cases, by contrast, do move
into the `cli` shard and now run once in CI.

Of the 88 original cases: 13 kept in the survivor, 13 moved to the formatter
suite, 52 verified duplicates of the survivor's canonical case or of an existing
`packages/**` test (each cited), and 10 verified non-behavioral (assertions on
objects the test itself constructed, bare `typeof` checks,
`expect(x).toBeDefined()` on a just-constructed value, "a mock was called" as the
only claim, or a permanently skipped case).

## 5. Coverage argument

- Every fixture-less invocation still executed in E2E CI is enumerated in
  `real-model-budget.ts` with a justification, and the ledger check proves the
  list is exhaustive for everything routed through `TestRig`.
- Each of the three converted tests differs from its pre-change version only by
  the added `fakeResponsesPath`; every assertion is byte-identical. Each was run
  locally against its new fixture and passes without credentials.
- Every one of the 88 token-tracking cases has a recorded disposition with a
  citation.
- `tokenFormatters.ts` gains unit coverage it never had. Note that the module
  currently has no production callers — see §6.
- The `mutationCoverage` and `cli-turn-parity` behavioral suites are untouched.

## 6. Scope boundaries

Delivered here: the instrumented and enforced request budget, the 55.6% request
reduction, the duplicate/non-behavioral consolidation, and this inventory.

Deliberately not in scope:

- **Token spend as a separate metric.** The issue asks for "token spend /
  request count" reduced ≥50%. This change instruments and enforces **request
  count** only. Per-request token spend is not measured: doing so would mean
  aggregating `usage` out of telemetry and setting a token ceiling, a second
  instrumentation subsystem. Requests are a sound proxy here because the two
  remaining real-model prompts are fixed, short strings, so the per-request token
  cost is effectively constant.
- **CI/E2E sharding and parallelism.** Already delivered: `ci.yml` selects an
  affected-shard matrix (`shard_selector`, `test_shard`,
  `scripts/test-shards.ts`, `scripts/affected-test-shards.ts`) and
  cross-platform full runs live in `nightly.yml`.
- **E2E quota fail-fast / failure-cascade short-circuit.** Tracked in #2279.
- **"CI + E2E daily-mean wall-clock < 10 min sustained over a week on `main`."**
  Not verifiable inside a pull request. The enforceable proxies delivered here
  are the guarded request budget and the 2641-line / 71-case reduction on each
  E2E leg.
- **Giving `integration-tests/` a CI shard** so its fixture-backed, in-process
  tests stop running three times. That is a real remaining inefficiency (see §4)
  and a change to the shard model owned by #2707/#2709.
- **Converting or deleting the CI-unselected real-provider cases in §3**, or any
  tool-mirror test not listed in §1.
- **Deleting `tokenFormatters.ts`.** It has no production callers, so its new
  unit test covers currently-unused code. Removing the module (and the
  `formatSessionTokenUsage` use in the survivor) is a separate decision.
