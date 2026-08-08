# Issue #2278 — E2E cost inventory, before and after

Companion to `PLAN.md`. Ledger of every consolidation and conversion, and the
evidence for the before/after numbers.

## 1. Real model API requests per E2E matrix leg

A `TestRig` run reaches a real provider if and only if `rig.setup()` was called
without `fakeResponsesPath`; otherwise the model turn is replayed from a
checked-in fixture through `FakeProvider`
(`packages/test-utils/src/cli-args.ts`, `packages/providers/src/composition/providerManagerInstance.ts`).

`.github/workflows/e2e.yml` runs `integration-tests/` twice per leg: once with
`--exclude` for `todo-continuation.e2e.test.ts` and
`run_shell_command.test.ts`, then once for `run_shell_command.test.ts` alone
under a three-name `--testNamePattern`. Only tests selected by those two
invocations cost anything.

### Before

| Test (setup name) | File | API requests |
| --- | --- | --- |
| `should be able to run a shell command` | `run_shell_command.test.ts` | 1 |
| `should be able to run a shell command via stdin` | `run_shell_command.test.ts` | 1 |
| `should be able to replace content in a file` | `replace.test.ts` | 1 |
| `should be able to list a directory` | `list_directory.test.ts` | 1 |
| `should write a session summary in non-interactive mode` | `session-summary.test.ts` | 1 |
| `should not crash when using mixed prompt inputs` | `mixed-input-crash.test.ts` | 0 |
| `should provide clear error message for mixed input` | `mixed-input-crash.test.ts` | 0 |
| `should exit quickly if stdin stream does not end` | `stdin-context.test.ts` | 0 |
| **Total** | | **5** |

The three zero-cost rows configure a real provider but the CLI exits during
argument or stdin validation before any model turn.
`mixed-input-crash.test.ts` asserts this directly with
`expect(rig.readLastApiRequest()).toBeNull()`.

### After

| Test (setup name) | Disposition | API requests |
| --- | --- | --- |
| `should be able to run a shell command` | kept real — shell tool-selection canary | 1 |
| `should be able to replace content in a file` | kept real — text-manipulation canary | 1 |
| `should be able to run a shell command via stdin` | converted → `run-shell-command.stdin.responses.jsonl` | 0 |
| `should be able to list a directory` | converted → `list-directory.responses.jsonl` | 0 |
| `should write a session summary in non-interactive mode` | converted → `session-summary.responses.jsonl` | 0 |
| `should not crash when using mixed prompt inputs` | unchanged (never reaches a provider) | 0 |
| `should provide clear error message for mixed input` | unchanged (never reaches a provider) | 0 |
| `should exit quickly if stdin stream does not end` | unchanged (never reaches a provider) | 0 |
| **Total** | | **2** |

**5 → 2 API requests per leg, a 60% reduction.** Across the three-leg PR matrix
that is 15 → 6.

### What each conversion preserves

No assertion was weakened. Only the model turn is replayed; tool execution,
filesystem effects and CLI output remain real.

| Converted test | Assertions kept |
| --- | --- |
| `list_directory` | `expectToolCallSuccess(['list_directory'])` plus `validateModelOutput` for `file1.txt` and `subdir`; the fixture emits a real `list_directory` tool call that the CLI executes against the real temp directory |
| `session-summary` | `--session-summary` still writes real JSON; `sessionMetrics.models` and `sessionMetrics.tools` are still asserted present, which required the fixture to carry `metadata.usage` |
| `run_shell_command` via stdin | still runs through real stdin piping (`rig.run({ stdin })`); `waitForToolCall('run_shell_command')` and `validateModelOutput(result, 'test-stdin')` unchanged; the fixture's `echo test-stdin` is really executed |

### Why these two canaries stay real

They are the only remaining coverage that the model *chooses the right tool*
from a natural-language prompt. `run_shell_command` covers shell tool
selection; `replace` covers a context-aware edit. A fixture cannot test a model
decision — replacing these with fixtures would be mock theater under
`integration-tests/TESTING_STRATEGY.md`.

## 2. How the reduction is enforced, not just performed

`integration-tests/real-model-budget.ts` declares every test permitted to use a
real provider, its per-run API cost, whether `e2e.yml` actually executes it, and
why. `TestRig.run`/`runInteractive` append each real-provider run to the ledger
named by `LLXPRT_E2E_MODEL_LEDGER` (a no-op when unset, so local runs, unit
suites and `evals/` are unaffected).
`scripts/check-e2e-model-budget.ts` then:

- validates the budget itself (`npm run lint:e2e-model-budget`, wired into CI
  lint): no duplicates, no negative or fractional costs, no empty
  justification, declared CI cost within the ceiling, and the ceiling at most
  half the recorded baseline; and
- checks the ledger after each E2E leg: a recorded test that is not in the
  budget fails the build and the message tells the author to add
  `fakeResponsesPath` or justify a budget entry.

A new real-model test therefore cannot be added silently, and the reduction
cannot regress unnoticed.

## 3. Dead real-provider tests found while measuring

`e2e.yml` excludes `integration-tests/run_shell_command.test.ts` from its main
invocation and re-runs only three named cases. Three real-provider cases in
that file are consequently never executed in CI:

- `should succeed with --yolo mode`
- `should allow all with "ShellTool" and other specific tools`
- `should propagate environment variables`

They cost nothing per leg, but they are also not providing CI coverage. They are
recorded in the budget with `runsInE2eCi: false` so the inventory is complete
and honest. Deciding whether to convert them to fixtures (restoring coverage at
zero cost) or delete them is deliberately **out of scope here** and left as a
follow-up.

## 4. Duplicate and non-behavioral test removal

See `TOKEN-TRACKING-CONSOLIDATION.md` for the case-by-case audit trail.

Six `integration-tests/token-tracking*.test.ts` files (3223 lines, 88 real `it`
cases) were pure in-process unit tests: they never spawned the CLI and never
contacted a model, yet ran once per E2E leg. They are now:

- **one** survivor, `integration-tests/token-tracking.test.ts` (17 cases),
  holding the genuine cross-package integration — `ProviderManager` session
  accumulation, `ProviderPerformanceTracker` metrics, per-provider
  `extractTokenCountsFromResponse`, and `retryWithBackoff` throttle tracking;
- **plus** a new `packages/cli/src/ui/utils/tokenFormatters.test.ts` (11 cases).
  `tokenFormatters.ts` previously had no unit test anywhere outside
  `integration-tests/`; its coverage now runs once in the `cli` shard instead
  of three times in E2E.

Of the 88 original cases: 13 kept in the survivor, 13 moved to the formatter
suite, 51 verified duplicates of the survivor's canonical case or of an existing
`packages/**` test (each cited), and 11 verified non-behavioral (assertions on
objects the test itself constructed, bare `typeof` checks, `expect(x).toBeDefined()`
on a just-constructed value, "a mock was called" as the only claim, or a
permanently skipped case).

## 5. Coverage argument

- Every real-provider run still executed in E2E CI is enumerated in
  `real-model-budget.ts` with a justification, and the guard proves the list is
  exhaustive at runtime.
- Every converted test keeps its original assertions; only the model turn is
  replayed. Each was run locally against its new fixture and passes.
- Every one of the 88 token-tracking cases has a recorded disposition with a
  citation. No case was dropped without either a surviving equivalent or a
  demonstration that it could not fail.
- `tokenFormatters.ts` gains unit coverage it never had, so formatter coverage
  strictly increases.
- The `mutationCoverage` and `cli-turn-parity` behavioral suites are untouched.

## 6. Scope boundaries

Delivered here: the instrumented and enforced request budget, the 60% request
reduction, the duplicate/non-behavioral consolidation, and this inventory.

Deliberately not in scope:

- **CI/E2E sharding and parallelism.** Already delivered: `ci.yml` selects an
  affected-shard matrix (`shard_selector`, `test_shard`,
  `scripts/test-shards.ts`, `scripts/affected-test-shards.ts`) and
  cross-platform full runs live in `nightly.yml`.
- **E2E quota fail-fast / failure-cascade short-circuit.** Tracked in #2279.
- **"CI + E2E daily-mean wall-clock < 10 min sustained over a week on `main`."**
  Not verifiable inside a pull request. The enforceable proxies delivered here
  are the guarded request budget and the removal of 3223 lines of in-process
  tests from all three E2E legs.
- **Converting or deleting the three dead real-provider cases in §3, or any
  tool-mirror test not listed in §1.**
