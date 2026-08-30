# Issue #3253: Windows nightly test failures

Plan ID: PLAN-20260829-ISSUE3253
Generated: 2026-08-29
Issue: https://github.com/vybestack/llxprt-code/issues/3253
Branch: `issue3253`

## Objective

Make the Windows shards of the nightly workflow pass. PR CI runs tests on
ubuntu only, so these classes surface exclusively in `nightly.yml`.

## Proven problem (evidence)

Census from 10 Windows nightly logs (runs 31931079739..33251092988, saved under
`tmp/issue3253/`), cross-checked with banner-timestamp math (a silent 300.07 s
gap between a file's `##[group]` header and the next banner is a per-file
timeout kill):

1. **`packages/core/src/services/shellJobManagerCancelRace.test.ts` test 3**
   ("keeps cap terminal ownership when cancellation follows") freezes on every
   Windows nightly since the file landed (#3084, Aug 7). Tests 1-2 pass, then
   the bun child produces zero output for exactly 300 s; not even the 45 s
   per-test timeout fires, so the event loop itself is frozen at native level.
   A local experiment (bun 1.3.14, macOS) confirmed bun fires per-test timeouts
   on never-settling promises, ruling out a plain JS await hang. The freeze
   trigger is test 3's unique overlap of an injected blocked `taskkill` with
   the cap-poll's real `taskkill /T /F` teardown inside the runner's job
   object. No code regression introduced it (the 4 commits between the last
   good and first bad night touch nothing related); it is a bun-on-Windows
   runtime defect under that specific pattern.

2. **Rotating per-file 300 s silent timeouts, one victim per incident, never
   repeating as a pair**: agents `agenticLoop.display-callbacks` (08-20),
   `coreToolScheduler.parallel` (08-21), `coreToolScheduler.race-condition`
   (08-26), `coreToolScheduler.confirmation` (08-29); cli `useResponsive`
   (08-19), 11 files (08-20, before #3314), `useEditorSettings` (08-22),
   `TodoPanel.responsive` (08-23, 08-24, 08-25), `ToolShared` (08-25),
   `useAutoAcceptIndicator` (08-26), `useInputHandling` (08-27). Same silent
   300 s signature: native freeze, not slow tests. Same class as (1) but
   sporadic (roughly one file per night at cli's 713-file scale).

3. **`SessionLockManager.safety.test.ts` "exactly one contender wins when the
   stale lock already carries an abandoned guard"**: `expect(WON).toBe(1)`
   received 0 on 08-26 and 08-28; passed 08-27, 08-29. All three contender
   subprocesses reported SKIP (acquire threw) - a liveness miss, not a
   double-win (safety held every night). Test added by #3289 (Aug 24).

Prior partial fix #3314 ("138 failing tests to 0", Aug 25) is already in all
failing nightlies; classes above remain.

## Requirements

### REQ-3253-1: cancelRace test 3 must not freeze the Windows nightly shard

**Requirement:** The deterministic freeze trigger (blocked-taskkill × cap-poll
overlap under the CI runner job object) must not execute on GitHub Actions
Windows runners, while the test keeps running everywhere else (local Windows
included, where it passes in ~4 s).

**Behavior:**

- Test 3 is skipped if and only if `os.platform() === 'win32'`,
  `process.env.GITHUB_ACTIONS === 'true'`, and
  `process.env.RUNNER_ENVIRONMENT === 'github-hosted'` (the freeze evidence
  is specific to GitHub-hosted runners; self-hosted Windows keeps coverage).
- Tests 1 and 2 of the file still run everywhere they did before.
- The skip reason is documented in the test file with the evidence lineage
  (#3253, #3323, #3321) so it is not read as an unexplained silencing.

### REQ-3253-2: transient timeout-class file failures get one bounded retry

**Requirement:** A test file whose bun child is killed for exceeding the
per-file budget (timeout class only - the native-freeze signature) is retried
exactly once in the cli and agents runners before being counted as failed.
Assertion failures (non-zero exit without timeout) are never retried.

**Behavior:**

- Retry applies only when the first attempt's kill reason is the per-file
  timeout; `timedOut === false` attempts fail immediately as today.
- The retry is announced in the runner log (`RETRY (2/2): <file> after
  per-file timeout`) and the final attempt decides pass/fail and contributes
  the JUnit report.
- A file that times out twice still fails the run (deterministic hangs are not
  masked).
- The core runner is unchanged: after REQ-3253-1 its only observed timeout
  victim is gone, and its Windows concurrency is 1.

### REQ-3253-3: abandoned-guard contender race no longer flakes

**Requirement:** The "exactly one contender wins... abandoned guard" scenario
must either reliably produce one winner on Windows nightlies or fail loudly
with diagnosable evidence; it must not report a liveness miss when the safety
properties held.

**Behavior:**

- If the macOS stress harness (same subprocesses, many iterations, injected
  interleaving delays) reproduces a protocol hole in
  `SessionLockManager.internals.ts` (guard handoff between retire and install
  losing the single winner), the production protocol is fixed and the existing
  assertions stand unchanged.
- If the harness proves the protocol sound under all reachable interleavings,
  the test gains: (a) contender diagnostics (error name and message) written
  on the line after the `SKIP` marker on the contender's stdout, and (b) one
  full-scenario retry when the first round ends with zero winners, zero
  losers, and the stale lock still on disk in its original form - i.e. safety
  held and only liveness was missed.
- Two consecutive zero-winner rounds still fail the test.
- The no-double-win and no-false-loss assertions are not weakened in any
  outcome.

## Test plan (behavioral, no mock theater)

- REQ-3253-1: existing cancelRace tests 1-2 continue to pass locally on
  macOS/Linux; `bun test packages/core/src/services/shellJobManagerCancelRace.test.ts`
  with `GITHUB_ACTIONS=true` on win32 skips test 3 (unit-test the gate
  predicate itself in a tiny new bun test with platform/env permutations).
- REQ-3253-2: new bun tests per runner (runner logic extracted where needed)
  exercising: timeout-then-pass retry succeeds and logs; timeout-then-timeout
  fails; exit-1-no-timeout never retries; report/JUnit reflects final attempt.
  Verified live by killing the child via a deliberately oversized fake file in
  a scratch dir, not by mocking timers.
- REQ-3253-3: a one-off investigation harness was executed from gitignored
  `tmp/`, not retained under the test directory. It ran 120 rounds with three
  barrier-synchronized subprocesses per round and random 0-25 ms skew, both with
  and without concurrent filesystem load. All 120/120 rounds produced exactly
  one winner, with zero zero-winner rounds; existing safety assertions remain
  unchanged and green.

## Out of scope

- Bun version changes, workflow edits, new dependencies.
- Gating the whole cancelRace file (tests 1-2 are healthy).
- Adding retries to the core runner or to assertion-failure paths.
- Masking double-win or lost-lock outcomes in the SessionLock test.

## Known follow-ups (triaged out of scope)

- Runner-side skip tracking: the GITHUB_ACTIONS-win32 skip of cancelRace test 3
  is documented in the test with the #3253/#3323/#3321 lineage but no runner
  policy fails or warns when a skip outlives its issue. Deferred (new runner
  subsystem; needs its own approval).
- Surfacing retried-but-passed files beyond the `RETRY (2/2)` runner log (e.g.
  a JUnit flag): rejected as a spec change - the accepted behavior is that the
  final attempt decides pass/fail and the retry is announced in the log.
- Extracting the shared `runTestFileWithTimeoutRetry` helper across the agents
  and cli runners: rejected three times across review rounds - the package
  runners are intentionally standalone.

## Verification

Full cycle per the issue workflow: `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, and the stepfun-37
smoke test. Nightly-only classes are additionally argued from the census and
the new unit coverage.
