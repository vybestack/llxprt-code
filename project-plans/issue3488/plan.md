# Issue #3488: JSC memory sampler comparison flakes under concurrent CLI tests

Branch: `issue3488`. Milestone 0.11.0. Label: Observability.

## Problem restated from evidence

During issue #3479 verification the normal CLI test orchestrator (concurrency 4)
failed `packages/cli/src/ui/hooks/memoryTrend/jscMemorySampler.test.ts` once:

```text
(fail) heapUsed correctness > replaces the base heapUsed with the real JSC heap size
Expected: < 0.05
Received: 0.1518444431871817
```

Seven of eight cases in the file passed. An immediate isolated rerun passed all
eight with no source changes. Baseline reconfirmed on this branch: an isolated
single-file run passes 8/8.

## Root-cause analysis

`sampleMemoryUsage()` in `packages/cli/src/ui/hooks/memoryTrend/jscMemorySampler.ts`
makes exactly one JSC observation per call. Line 127 stores
`const heapUsed = jscHeapApi.heapSize()` and reuses that one value for both the
returned `heapUsed` and the `heapTotal` floor at line 131. There is no second
observation inside the sampler.

The flake is in the test. The failing case does this:

1. `sampleMemoryUsage(base)` runs; the sampler takes observation 1 internally.
2. `const truth = jscHeapSize()` (test line 122) takes observation 2,
   independently, after the sampler returned.
3. The test asserts the two live values agree within 5 percent.

The module's own header records that `heapSize()` lags allocation until a sweep:
sampled right after retaining 185 MB it read 67 MB, and matched only after
`gcAndSweep()`. JavaScriptCore's collector runs concurrently with test code, so
the counter can advance or settle between two observations. The CLI orchestrator
(`packages/cli/run-bun-tests.ts`) runs one process per file with bounded
parallelism that saturates cores (per the issue #3139 note in that file), which
shifts collection timing inside this process. A collection landing between
observations 1 and 2 moved the value 15.2 percent, past the 5 percent bound.
Isolated runs pass because nothing lands inside the window.

A second case in the same describe block, `samples the JSC heap when full heap
statistics are unavailable`, has the identical defect: `expectedHeapSize =
jsc.heapSize()` (test line 137) before the sampler call, compared against the
sampler's internal observation with the same 5 percent window. The issue names
only the first case because that is the one that happened to fail.

The remaining heap cases in the file are stable by construction: the
extraMemorySize and retained-allocation cases force `gcAndSweep()` immediately
before each observation and use wide delta windows (0.8x to 1.3x, and greater
than 0.5x over tens of MB of deliberately retained data), so ambient drift
cannot cross them.

## Production code audit (bot suggestion versus actual code)

The GitHub bot's implementation step 1 says to store one `heapSize()` result in
a local and use it for both `heapUsed` and `heapTotal` flooring. That is already
the code on main, verbatim, at lines 127 to 131. There is nothing to apply. The
bot's framing ("sampleMemoryUsage() derives heapUsed from a single call") is
correct, and it is why the flake can only be in the test's second observation.

The bot's test suggestion of a fake JSC API with a fixed heap size is rejected.
The sampler resolves `bun:jsc` once at module load (line 104) with no injection
parameter, deliberately. Supporting a fake would change the production module
surface to fix a test-only defect. A production change is not required, so none
will be made.

The deterministic alternative needs no seam. The sampler reads
`jscHeapApi.heapSize()` as a property access at call time on the module object
that `process.getBuiltinModule('bun:jsc')` returns. The test can obtain that
same singleton object and temporarily wrap `heapSize` with a pass-through
recorder: the wrapper calls the real function, records the value it returned to
the sampler, and restores the original in `finally`. The file already uses this
interception technique (the heapStats case replaces a property on the same
module object and restores it in `finally`). The real `heapSize` still produces
the value, so this observes the data flow rather than mocking it. The assertion
then compares one observation against itself: no tolerance window, no second
observation, no timing.

## Accepted behavior

AC1: The case `replaces the base heapUsed with the real JSC heap size` performs
no second independent live observation. It installs a pass-through recorder on
the real `bun:jsc` module object's `heapSize`, calls `sampleMemoryUsage` with the
existing injected BASE fixture, and asserts exact equality: `sample.heapUsed` is
the recorded value, and it is not `BASE.heapUsed`. Inputs: the unchanged BASE
fixture and the real `bun:jsc` under Bun. Boundary: still skipped unchanged when
`bun:jsc` is unavailable; the recorder is restored even when an assertion throws.

AC2: The case `samples the JSC heap when full heap statistics are unavailable`
gets the same rework. It keeps the throwing `heapStats` replacement (any sampler
call that enumerates the heap fails the case by throwing) and replaces the
pre-sampled `expectedHeapSize` plus 5 percent window with exact equality against
the recorded single observation.

AC3: heapTotal flooring is pinned exactly inside the reworked correctness case:
`sample.heapTotal` equals `Math.max(BASE.heapTotal, recorded)`. With the BASE
fixture (heapTotal 222_000 against a real heap in the MB range) this exercises
the floor branch concretely. The existing weaker case `keeps heapTotal at or
above heapUsed` stays as is.

AC4: The reworked cases add no timing assertions and no `gcAndSweep()` calls.
The gcAndSweep-based delta cases elsewhere in the file are untouched.

AC5: Production code is unchanged. `jscMemorySampler.ts` and every other
production file are identical to main in the PR diff. The sampler keeps its
current semantics: one `heapSize()` observation per sample, `heapTotal` floored
at it, no forced collection, module-load resolution of `bun:jsc`, startup errors
on non-Bun runtimes.

AC6: Stability evidence. The reworked file passes (a) repeated single-file runs
through the repo flake tool, `npm run deflake -- --command='cd packages/cli &&
bun test src/ui/hooks/memoryTrend/jscMemorySampler.test.ts' --runs=5`, with zero
failures, and (b) at least one full `npm run test` under the normal orchestrator,
the environment that produced the failure. No statistical reproduction of the
original 15 percent drift is claimed; the reworked assertions compare one
observation against itself, so no drift window exists to hit.

## TDD sequence

The deliverable is the test rework; production behavior is already correct. Per
dev-docs/RULES.md, the 5 percent window asserts an incorrect specification (that
two independent live observations agree), so it is replaced, not preserved.

RED (teeth proof, scratch only, never committed): on a temporary copy, mutate the
sampler to return the base `heapUsed` unchanged, which is the bug the correctness
case exists to catch. The reworked cases must fail. This is the RULES.md litmus
test (break the real implementation, watch the test catch it) applied before the
rework is accepted. Restore the sampler afterward; the diff must show no
production change.

GREEN: unmodified sampler, reworked cases, all cases in the file pass
(baseline today is 8/8 isolated).

Then the AC6 determinism gates and the full verification cycle below.

Type discipline for the rework: `let observed: number | undefined`, no `any`, no
type assertions beyond the file's existing narrowing idioms. If the sampler ever
stops calling `heapSize`, `observed` stays undefined and the equality assertion
fails with a clear diff, so the case keeps its teeth.

## Scope guard (do NOT)

- No production changes anywhere: sampler, useMemoryMonitor, memoryTelemetry, or
  any other module.
- No widening of the tolerance (5 to 20 percent or similar). That keeps the
  two-observation defect and only moves the failure threshold.
- No gcAndSweep settling inserted into the reworked cases. The sampler
  deliberately never forces collection (a full GC against a multi-GB heap is a
  user-visible pause), and settling would still leave a drift window between the
  settle and the sampler's internal observation.
- No timing assertions, per the issue.
- No sampler API change or injection seam for fake JSC APIs.
- No changes to the stable delta cases in this file, other memoryTrend suites,
  the orchestrator, CI workflows, dependencies, or quality tooling.
- No mock theater: the recorder wraps the real `heapSize` and passes through; it
  fabricates nothing.

## Files to touch

- `packages/cli/src/ui/hooks/memoryTrend/jscMemorySampler.test.ts`: rework the
  two correctness cases per AC1, AC2, AC3, AC4.
- `project-plans/issue3488/plan.md`: this plan.

## Verification

Full cycle per the issue-workflow skill: `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, and the smoke test
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing
else"` (startup is untouched, so this guards against accidental production
drift). Plus:

- `bun scripts/test-audit/scan.ts` diffed against main for the touched test
  file: no new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING, or NO_ASSERT findings.
- The AC6 deflake runs.

Review gates: deepthinker compliance review (at most 2 rounds), open-code-review
with the zai profile before pushing (at most 2 rounds), PR titled with
`Fixes #3488`, CI watch, and CodeRabbit resolution per the workflow skill.

## Known follow-ups and ambiguities

- The issue names one failing case; this plan also reworks its sibling, which
  carries the identical comparison pattern and will flake the same way. Included
  by default because the issue's expected-behavior text describes the defect
  class, not a single case. Flagged here in case the second case should be left
  alone.
- The original 15 percent failure is timing-dependent and cannot be reproduced
  on demand; that is why the fix removes the comparison rather than tuning a
  window, and why AC6 relies on the deflake tool and the orchestrator run rather
  than a forced reproduction.
