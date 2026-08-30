# Issue #3439: Nightly workflow failed (Aug 30) — root cause and fix plan

Plan ID: PLAN-20260830-ISSUE3439
Issue: https://github.com/vybestack/llxprt-code/issues/3439
Branch: `issue3439`
Run under investigation: https://github.com/vybestack/llxprt-code/actions/runs/33307362307 (commit c023285b)

## Objective

Stop the recurring Windows nightly failures by fixing the five test-infrastructure
defects that produced the Aug 30 failures, and make the harness report failures
truthfully. No product behavior changes.

## What the nightly tests

- `windows_ci`: 4-shard matrix (cli, core, agents, scripts) running the full Bun
  corpus on Windows. PR CI runs ubuntu only, so Windows-only breakage surfaces
  here, once per day, at main.
- `windows_installed_command`: release-like install smoke (global + local
  install) plus ~23 launcher probes that replace the installed `index.ts` with
  an instrumented probe entry (scripts/tests/issue-2603-windows-probe.ts) so
  the launcher's child is the probe, not the product.

## Root causes (evidence)

The Aug 30 nightly was the first Windows exposure for #3404 (merged Aug 29
16:29, ships `bundle/llxprt.js`, rewrote the 2978 shim tests, added the
output-generator test) and #3435 (merged Aug 29 evening, timeout-retry for the
cli and agents runners). The prior night (run 33251092988) failed only
`windows_ci`; `windows_installed_command` passed.

1. **Probe fixture / bundle coupling** (windows_installed_command, all ~23
   probes, exit 52). Launchers prefer `bundle/llxprt.js` over `index.ts` by
   design (checks.cjs:127-146 pins it statically). `buildProbeFixture`
   (scripts/windows-installed-command-smoke/checks.cjs:50-80) replaces only
   `index.ts`, so after #3404 every probe exec'd the real CLI, which correctly
   exits 52 from the unconfigured-provider guard
   (packages/cli/src/unconfiguredProviderGuard.ts). The probe contract in the
   probe header ("the launcher under test invokes `bun.exe <index.ts> %*`")
   was broken underneath it. Not a product bug.
2. **Global-state gate misattribution** (same job).
   scripts/windows-installed-command-smoke.cjs:265-270 throws "prerequisite
   checks failed (local-cmd-version or package-local-bun)" from the single
   global `failed` flag, but both named steps printed OK; the flag was set by
   the class-1 probe failures. Reporting bug.
3. **POSIX-only spawn helpers** (windows_ci [scripts], 2 files, all tests).
   - scripts/tests/issue-2978-node-shim-helpers.ts `runShim` spawns a
     `node -e` wrapper that spawnSyncs the shim `.mjs` directly; Windows
     cannot exec it (status null → `?? 1`). The file's own doc comment says
     the shim is "invoked via `node <shim>`", which the implementation
     contradicts.
   - scripts/tests/memory/output-generator.test.ts resolves bun via
     `Bun.which('bun')`; every case returned exit 1 with empty stderr,
     including cases that expect exit 2, consistent with spawn failure
     (status null coerced to 1 by the shared wrapper's `?? 1`), not with the
     generator's own exit paths (0 or 2). The portable form is
     `process.execPath`, already used by packages/core/run-bun-tests.ts.
     Mechanism verified by inference from the uniform logs; not reproduced
     locally (no Windows box). The fix is the same either way.
4. **`toPathArgument` portability** (windows_ci [cli], 1 test).
   packages/cli/run-bun-tests.ts:91-93 prefixes `./` unless the path starts
   with `/` or `./`; absolute Windows paths become `./D:\...`, so the new
   #3435 meta-test's temp fixture child exits instantly with a resolve error,
   no timeout fires, no retry happens, and the retry assertion fails
   (run-bun-tests.test.ts:860-975).
5. **Core runner has no retry** (windows_ci [core], FATAL abort).
   `generateContentResponseUtilities.test.ts` hit the documented sporadic
   bun-on-Windows native freeze (silent 300s, rotating victims; see
   project-plans/issue3253/plan.md), and the post-kill reap did not finish
   within the ~10s budget, so packages/core/run-bun-tests.ts aborted the whole
   shard ("failed to reap a timed-out test process tree", L425-435). #3435
   deliberately left core without retry ("core's only observed victim is
   gone"); that assumption is falsified by this run.
6. **Summary honesty** (observed in the [scripts] shard log, 11:09:06).
   scripts/test.ts `formatSummary` printed "Result: PASSED" while the phase
   list showed "FAIL scripts" and the process exited 1. The `failed` tally
   counts only workspace phases; the scripts phase lives only in `results`.
   Exit code is correct (the separate `anyPhaseFailed` check), but the printed
   verdict contradicts it.

## Verdict: real bugs vs test architecture

No product bugs. Exit 52 is the provider guard working as designed; the probes
were meant to never reach it. All six findings are test-infrastructure defects:
fixture/entry coupling (1), global-state reporting (2), POSIX spawn assumptions
(3), path portability (4), inconsistent retry coverage plus a catastrophic
reap-abort policy (5), and a misleading summary (6).

## Fix plan

Behavioral, red-checkable where possible. All changes are in test infrastructure.

### FIX-1: probe fixture must control the entry point

In `buildProbeFixture` (scripts/windows-installed-command-smoke/checks.cjs),
remove `bundle/llxprt.js` from the fixture after copying the installed package,
so the launcher resolves the source entry and execs the probe `index.ts`. This
restores the documented probe contract for every probe (argv fidelity, injection
guards, stdio, exit codes, execpath, process tree) without touching launcher
semantics. The real bundle-vs-source precedence keeps being asserted statically
at checks.cjs:127-146. Red check: with the fix, the fixture launcher execs the
probe (probe emits its JSON marker); without it, exit 52.

### FIX-2: gate on the steps it names

In scripts/windows-installed-command-smoke.cjs, the pre-benchmark gate must fail
on the results of the steps it names (local-cmd-version, package-local-bun),
not the global flag. Track per-step success from the install-helpers and gate
on those booleans; if a genuinely earlier step failed, the smoke already failed
before this point with that step's own message. The gate message must name only
what it tested.

### FIX-3: portable spawn in the two script helpers

- 2978 helpers `runShim`: the capture wrapper must spawn
  `process.execPath` with the shim path as argv[1] (matching the documented
  `node <shim> <args>` invocation and preserving `process.argv` semantics the
  tests assert). Works identically on POSIX and Windows.
- output-generator test: use `process.execPath` instead of `Bun.which('bun')`
  for the generator child. Under `bun test`, `process.execPath` is the bun
  binary running the tests, which is exactly the interpreter the test wants.

### FIX-4: `toPathArgument` absolute-path handling

Use `path.isAbsolute(file) || file.startsWith('./')` so absolute Windows paths
pass through unchanged. Keep the `./` prefix behavior for bare relative names
(bun resolves those against cwd). The #3435 meta-test then exercises its
intended path on all platforms.

### FIX-5: core runner retry parity with #3435

Port `runTestFileWithTimeoutRetry` (timeout-retry once) from
packages/cli/run-bun-tests.ts to packages/core/run-bun-tests.ts, mirroring the
cli runner's structure and logging (RETRY marker in logs). Keep the FATAL
reap-abort guard, but only trigger it after the retry attempt also fails to
reap, so one unlucky taskkill race does not abort a 30-minute shard. A
reap-failure that resolves on retry marks only that file failed.

### FIX-6: truthful summary

`formatSummary` (scripts/test.ts) must count every failed phase result
(including the scripts phase) in `summary.failed` so "Result:" matches the
exit-code logic. Add/extend the existing summary test to cover a failed
scripts phase.

## Out of scope (recommendations, not this PR)

- Running Windows shards (or a smoke subset) in PR CI for PRs touching
  packages/cli, packages/core, scripts/. This is the structural fix for
  reliability; the six fixes above stop the current failure classes.
- Nightly failure-bot hygiene (one issue accumulating 25+ comments, e.g. #3253).

## Verification

Per the issue workflow: `npm run test`, `npm run lint`, `npm run typecheck`,
`npm run format`, `npm run build`, and the stepfun-37 profile smoke. Windows
behavior is validated by the nightly after merge; local red checks cover the
logic paths that are reachable on macOS (fixture entry resolution, gate
booleans, spawn wrapper, path handling, retry wiring, summary counting).

## Implementation record (2026-08-30)

All six fixes implemented on `issue3439`. Targeted test evidence (macOS):

- `bun test scripts/tests/issue-2978-node-shim.bun.test.ts`: 46 pass / 0 fail
  (the suite that failed 100% on the Aug 30 Windows shard).
- `bun test scripts/tests/memory/output-generator.test.ts`: 8 pass / 0 fail
  (all 8 failed on the Aug 30 Windows shard).
- `cd packages/cli && bun test test/run-bun-tests.test.ts`: 78 pass / 0 fail,
  including the new absolute-Windows-path case for `toPathArgument`.
- `cd packages/core && bun test test/run-bun-tests.test.ts`: 8 pass / 1
  pre-existing skip / 0 fail, including the new retry describe.
- `bun test scripts/tests/test-orchestrator.test.ts
  scripts/tests/test-shard-orchestrator.test.ts`: 47 pass / 0 fail, including
  the failed-scripts-phase summary verdict.
- `node --check` on the three edited .cjs files: clean.

Two corrections applied over the initial implementation pass:

1. The 2978 helper keeps the OUTER spawn as `node`. Changing it to
   `process.execPath` would have run the shim under bun (the test process is
   bun), silently changing the system under test; the shim's contract is
   `node <shim>` (shebang `#!/usr/bin/env node`). Only the inner wrapper's
   target changed to `process.execPath`, which is node inside a `node -e`
   wrapper on every platform.
2. The smoke's `succeeded` flag is set only when `!getState().failed`. The
   per-step prerequisite gate alone would have let recorded probe failures
   reach the success path (success diagnostic, benchmark, temp cleanup), the
   exact regression the old gate's comment warned about.

A mangled edit in scripts/tests/test-orchestrator.test.ts (missing block
closures, one deleted unrelated test) was restored to HEAD structure; the only
intended change in that file is the added scripts-phase summary test.

## Review addendum (2026-08-30, second session): FIX-5 flaw and broader reliability work

The first implementation pass (commit `f628e05db`) was reviewed against its own
plan. FIX-1/2/3/4/6 held up. FIX-5 did not: `runTestFileWithTimeoutRetry`
returned early without retrying whenever the first attempt `reapFailed`,
contradicting the plan's "only trigger [FATAL] after the retry attempt also
fails to reap". The exact Aug 30 core failure (timeout + reap failure) would
still have FATAL-aborted the shard.

### Reworked FIX-5 (packages/core/run-bun-tests.ts)

- Retry now runs on every timed-out first attempt, including one that failed
  to reap.
- FATAL reap-abort fires only when the final attempt reports `reapFailed`.
- When the first attempt fails to reap but the retry reaps cleanly, the file
  returns red with a merged result: `{...secondAttempt, passed: false,
  timedOut: true, reapFailed: false, reapError: firstAttempt.reapError}` —
  the file stays failed (the 300s stall is real) but the shard continues.
- TIMEOUT log line notes `[REAP FAILED (recovered on retry)]` in that case.
- Meta-tests replaced accordingly: "retries after reap failure and keeps the
  file failed when the retry reaps cleanly" and "returns the second reap
  failure so main() aborts" (10 pass / 1 skip).

### Retry parity for the remaining runners

The freeze class is runner-agnostic; after #3435 covered cli/agents and the
rework covered core, two runners still had no timeout retry:

- **packages/auth/run-bun-tests.ts**: added exported cli-style
  `runTestFileWithTimeoutRetry` (timeout-only, one retry) wrapping each file
  in the worker pool; 3 new behavior tests (12 pass / 0 fail).
- **scripts/run_bun_tests.ts** (shared by 13 workspaces, 'rest' and
  'providers' shards): added a timeout-only retry budget, default 1,
  overridable with `LLXPRT_BUN_TEST_TIMEOUT_RETRIES` (0 disables; invalid
  values throw). A timeout kill is detected via `wasKilledByTimeoutSignal`
  (SIGTERM/SIGKILL), the same signal set `isChildSuccess` already used, so
  classification and retry cannot disagree. The pre-existing `entry.retries`
  failure budget is untouched and keeps its exact messages. Tests extended:
  timeout-retry-then-pass, env-disable, budget resolution, retry plan
  messages, and the comprehensive argv test updated for the retried SIGTERM
  entry (54 pass / 0 fail).
- The retry policy lives in a new shared module,
  `scripts/lib/bun-test-retry.ts` (`resolveTimeoutRetryBudget`,
  `wasKilledByTimeoutSignal`, `planNextAttempt`), unit-tested directly. This
  also kept `scripts/run_bun_tests.ts` under the repo's 800-line lint cap.

### Structural fix: Windows signal before merge (in scope after all)

The plan's "out of scope" item — PR CI is ubuntu-only, so Windows-incompatible
test code merges green and first runs on the nightly — is the reason these
defect classes kept recurring (#2603→#3439). This branch adds a
`windows_test_infra` gate job to `.github/workflows/ci.yml`:

- windows-latest, ~20 min cap, `needs: [doc_change_filter, skip_check]`.
- Path-filtered: on PRs it runs only when the Windows-sensitive surface
  changed (scripts/, `*/run-bun-tests.ts`, runner/bun test helpers,
  `packages/cli/bin/**`, the runner meta-tests, ci/nightly workflows,
  bun.lock, root package/tsconfig). Empty file lists fail open to running.
- Always runs on push/merge_group so bad merges surface in minutes.
- Runs the fast, Windows-proven subset: 2978 shim + oven-fallback suites,
  memory/output-generator, shared-runner tests, both orchestrator tests,
  cli/core/agents/auth runner meta-tests, and the `llxprt --version`
  launcher smoke (mirror of nightly's Defender exclusions + rollup win32
  fix; no build step needed).
- Wired into the `test` aggregator as blocking; a skip is accepted only for
  docs-only PRs or when the path filter reported not-affected.

### Verification (second session, macOS)

- `bunx tsc --project tsconfig.scripts.json --noEmit`: 0 errors; core and
  auth workspaces typecheck clean.
- eslint on all changed TS files: clean (both prior errors resolved by the
  lib extraction and the `planNextAttempt` loop rewrite).
- `bun test` on run_bun_tests (54), core meta (10+1 skip), auth behavior
  (12), policy+orchestrator+2978+output-generator batch (140, 1 skip): all
  green.
- `node scripts/check-test-file-coverage.ts`: PASSED (no new uncovered test
  files).
- actionlint on ci.yml: clean (2 pre-existing shellcheck notes elsewhere);
  yamllint strict: only pre-existing line-length warnings; prettier clean.

### Follow-up (filed separately)

Unify the five bespoke per-package runners (cli/core/agents/auth +
scripts/run_bun_tests.ts) on one policy module (timeout, retry budgets,
reaping, JUnit) so parity fixes land once. Deliberately not attempted here to
keep this diff within the review budget.

### Post-push CI corrections (run 2)

- ci.yml: fixed a truncated `actions/setup-node` SHA in the Windows gate
  (dropped 15 hex chars) that failed job setup and the ratchet check.
- Extended the two CI-contract meta-tests
  (`ci-acplint-workflow.test.ts`, `ci-docs-only-skip.bun.test.ts`) to encode
  the `windows_test_infra` aggregator contract: two new `${{ needs.* }}`
  substitutions, `HEAVY_JOBS` membership, and behavioral tests for
  gate-failure red and path-filtered-skip green.
- Prettier fix in `scripts/run_bun_tests.ts` (catch-block return formatting).
