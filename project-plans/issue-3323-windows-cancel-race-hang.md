# Plan: Stop shellJobManagerCancelRace.test.ts from hanging the Windows core shard to the 300s file timeout

Plan ID: PLAN-20260825-CANCELRACEHANG
Source issue: #3323

## Problem

`packages/core/src/services/shellJobManagerCancelRace.test.ts` reaches the
300s per-file budget on the nightly Windows `core` shard. The first two
tests pass; the third, `keeps cap terminal ownership when cancellation
follows`, produces no result and the file is killed at 300s. Because the
file carries a 45s per-test timeout under Bun, a timeout that fired cleanly
would have surfaced at ~45s, so the runner is waiting on something that
keeps the process alive, not on a slow assertion.

The file runs Windows-only (`describe.skipIf(os.platform() !== 'win32')`), so
it cannot be reproduced on macOS/Linux. The hang is in the third test's
cleanup path: with the blockable `taskkillImpl`, the capped job is
force-finalised without observing the outer child exit, so the outer PowerShell
is still `WaitForExit()`-ing on the inner 60s PowerShell. The cleanup's
dispose cannot kill either layer (its `safeWindowsKill` is blocked), and the
`reapAndRemoveWindowsTestDir` stage is only passed the outer pid, so the inner
PowerShell survives holding the redirected log handles, keeping the process event
loop alive until the file budget kills it (`TIMEOUT`).

## Acceptance criteria

1. The file completes within its per-file budget on Windows: the per-test 45s
   timeouts are no longer reachable, and `bun test` on that file exits on
   its own with all three tests passing. Behavior is proven by the file's Bun
   test pass marking (`isChildSuccess` / exit code 0) on the Windows shard;
   the process must be able to exit.
2. Test-side only, no production behavior changes: `shellJobManager.ts`,
   `shellProcessKill.ts`, `shellJobInternal.ts`, `shellJobSpawn.ts`,
   `shellJobTransition.ts`, `shellJobTypes.ts` are untouched. The remaining
   dead `disposeAndCleanupWindowsTest` wrapper is outside this issue, so it and
   its callers stay as they are.
3. The third test matches the established sibling pattern in this repo for blocked
   kill paths: capture the inner PowerShell pid from the marker
   (`readInnerPidFromMarker(innerMarker, 10_000)`, already written by the
   test's command) and pass both `outerPid` and `innerPid` to
   `reapAndRemoveWindowsTestDir` so cleanup's independent real-taskkill stage
   deterministically reaps and confirms the inner process that owns the log
   handles, and the process can exit.
4. Regression guard: `bun scripts/test.ts --workspace core` runs the file's
   platform-neutral surface on macOS/Linux without a hang (the file's tests are
   skipped there) and CI executes the Windows shard, whose `core` leg must go
   green on this file.
5. The mock `taskkillImpl` remains never-settling (`new Promise(() => {})`),
   and the non-hanging-budget assertions (`toBeLessThan(20000)`) are kept.
   No assertion is deleted or widened to make a test pass (`dev-docs/RULES.md`).

## Root-cause trace (Windows only)

1. `manager.launch` (Windows branch) uses `spawnWindowsBackground`: the outer
   PowerShell spawns the inner via Start-Process and `WaitForExit()`-s on it.
2. The inner writes `$PID` to `innerMarker`, then `'x' * 128` to the
   redirected stdout, then sleeps 60s.
3. The 2s cap poll fires `checkLogCapAsync` → `failJobIfOverCapAsync`:
   the log is over the 1-byte cap, so it claims `phase = 'capping'`,
   records the job in `survivors`, and calls `safeWindowsKill(outerPid)`,
   which awaits the blocked taskkill until its 5s timeout and resolves
   `{ ok: false }`. Cap owns the terminal. The OUTER is still
   `WaitForExit()`-ing on the INNER; both stay alive.
4. `manager.cancel(job.id)`: sees `phase === 'capping'`, awaits
   `terminalPromise`, and returns `false`. `getKillCallCount()` is 1. This
   is what the test asserts; it is not the hang.
5. `manager.dispose()`: cancels (no-op), reconciles (job is terminal via
   cap), then `reapSurvivorsBounded` retries `safeWindowsKill` on the
   capped outer (blocked again, 5s) and after its short verification rounds
   RETAINS the live survivor and throws `ShellJobDisposalError`. No bounded
   dispose future can reap a process while `taskkillImpl` never resolves, so
   the main-subject part of the test can never kill the tree.
6. The cleanup therefore owns the determinism contract the way it does in the
   sibling suites: `reapAndRemoveWindowsTestDir` calls the REAL
   `boundedTaskkill` and then the real `taskkill /T /F /PID` tree-kill
   against every pid it is given, then polls `tasklist` until each is gone.
   `outerPid` alone is the failure: `taskkill /T` rooted at the outer can
   hit the job-object tear-down race (documented in the git history of
   `shellJobManagerCancelRace.test.ts` and `shellJobWindowsSpawn.test.ts`) and
   leave the inner alive, whose redirected handles keep the event loop open. That
   leaves the survivable had-this-path hang at 60s of inner sleep and then a
   still-alive inner that keeps the runner's event loop from draining until the
   300s file budget kills it.
7. Fix: in this third test, perform the deterministic cleanup in the `finally`
   via `reapAndRemoveWindowsTestDir` directly (passing the already-captured
   outer AND inner pids) instead of `disposeAndCleanupWindowsTest`, whose
   `manager.dispose()` phase (bounded but cap-job-owned) leaves the outer
   `WaitForExit()`-ing on the inner before the direct reap — the reachable
   path where an outer-rooted tree kill races and leaves the inner alive, whose
   handles keep the runner's event loop from draining until the 300s file
   budget kills it (`TIMEOUT`). The next findings fix was: keep
   `disposeAndCleanupWindowsTest` imported because the first two tests still use
   it.

## Change

One file, test-only:

`packages/core/src/services/shellJobManagerCancelRace.test.ts`, third test only:

- Replace `await disposeAndCleanupWindowsTest(dir, manager, [outerPid, innerPid]);`
  with `await reapAndRemoveWindowsTestDir(dir, manager, [outerPid, innerPid]);`
- Widen the import of `reapAndRemoveWindowsTestDir` from
  `../../test/utils/shellJobTestCleanup.js` next to
  `buildInnerPidMarkerCommand` / `disposeAndCleanupWindowsTest` /
  `readInnerPidFromMarker`.
- Add a short comment citing issue #3323 explaining the mechanism precisely:
  this test's cap-owned job was force-finalised while the outer PowerShell
  was still `WaitForExit()`-ing on the inner one, and an outer-rooted tree
  kill can race and leave the inner PowerShell (which owns the redirected log
  handles) alive, keeping this test file's Bun process from exiting — so
  cleanup reaps the outer AND inner directly instead of going through
  `manager.dispose()` first.
- Keep the `disposeAndCleanupWindowsTest` import: the first and second tests in
  this same file still use it, so the import stays.

Kept as-is, by evidence:

- `disposeAndCleanupWindowsTest` semantics for the OTHER two tests: their real
  taskkills succeed and their outer `dispose` resolves cleanly.
- The `45_000` per-test timeouts, the `expect`s, the `new Promise(() => {})`
  `taskkillImpl` block, and the non-hanging-budget assertion.

## Why this is in scope

The issue names exactly this file, this third test, and the blocked-taskkill +
inner PowerShell + `disposeAndCleanupWindowsTest` shape ("Confirm whether
the inner PowerShell survives the blocked-taskkill path"). Item 2 in the issue's
"Suggested starting points" ("Consider whether the release path in `finally` can
itself block") is the same reachable-`finally` classification. The change
reaps the inner pid that the cleanup stage needs in order to let the process
exit; everything else in the file already carries the correct shape.

## Verification

Run for the changed package on macOS/Linux (the file's tests skip there):
`bun test packages/core/src/services/shellJobManagerCancelRace.test.ts` (must
pass with 0 fail, exercising the module graph and proving the Windows edits
still compile and run), then the core test, lint, typecheck, format, build,
and the profile-load smoke from `dev-docs/RULES.md`. Any failure is
addressed. CI windows_ci core is the behavioral signal this issue reports.

## Risks and mitigations (test-only)

- The file is Windows-only; local macOS/Linux evidence is limited to "the file
  runs to completion with 0 fail (skipped)". That is exactly the honest bound;
  the nightly windows core shard is the deciding signal. The fix routes the
  inner pid through the same direct-reap shape `shellJobManagerSurvivors.test.ts`
  already relies on for identical blocked-kill scenarios.
- `taskkill /T` tolerance (`BMP` comment in `reapAndRemoveWindowsTestDir`) is
  only exercised on an already-budged cap-stage; the real taskkill on the inner
  is a leaf with no descendants, so `taskkill /pid /f /t` on the inner is a
  single-process force-kill. Blocked-taskkill coverage of the manager is preserved,
  because only the CLEANUP path switches to the real kill.
