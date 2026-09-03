# Issue #3533: sandbox-launch-release sidecar readiness fixture race

## Root cause

`packages/cli/src/utils/sandbox-launch-release.test.ts` (test `stops a started
proxy sidecar when the main engine spawn throws`) fakes the proxy sidecar's
readiness endpoint with an independent TCP listener on port 8877 that answers
`HTTP/1.1 200 OK` unconditionally as soon as it binds.

Production `startProxyContainer` does the opposite of that assumption: it
spawns the sidecar container asynchronously, then polls
`curl http://localhost:8877`, and only after the poll succeeds runs
`network connect`. The sidecar spawn is routed to the real fake engine, a
separate child process that persists the `llxprt-code-sandbox-proxy` container
record into its `state.json`. Whether that record exists when the curl poll
first succeeds is a race between two real child processes. When the listener
wins, `network connect` reads engine state with no such container and fails
with `No such container: llxprt-code-sandbox-proxy`, so the scenario never
reaches its intentionally injected main-container `engine launch failed`.

CI evidence: the scheduled release run at
https://github.com/vybestack/llxprt-code/actions/runs/33706066335 failed this
test exactly that way (log preserved at `tmp/issue3533/failed.log`, failure at
line 47679). This is a private test-fixture race, not a production defect: a
real sidecar cannot answer HTTP before its container exists.

## Test-first plan

1. RED: add a second scenario invocation of the sidecar test whose sidecar
   child is spawned through a real `sh -c 'sleep … && exec'` delay, making the
   fake-engine registration land after the fixed 8877 listener binds. With the
   current unconditional listener this fails deterministically with
   `No such container`, reproducing the release-run race on demand. Save the
   RED output under `tmp/issue3533/`.
2. GREEN (minimal fixture correction): the 8877 launch-window fixture answers
   HTTP 200 only after the fake engine's persistent state records
   `llxprt-code-sandbox-proxy`; before that it destroys the connection so the
   production `until curl` retry loop keeps polling. Bind failures still
   reject the `listenAt` promise; a never-registering sidecar still runs into
   production's readiness timeout. Both failures stay visible.
3. Strengthen the state evidence: the ordered invocation log must now prove
   sidecar `run` → `network connect` → sidecar `rm` → dependency
   `volume rm`, in addition to the existing post-failure release evidence.

No production file changes. No change to the fake engine or its harness: the
delayed registration is produced by a real delayed child in the spawn router.

## Acceptance criteria

1. The launch-window fixture reports readiness only after fake-engine state
   records the proxy sidecar.
2. The scenario succeeds through `network connect` and reaches the injected
   main-container `engine launch failed`.
3. State evidence proves the order: sidecar run, network connect, sidecar rm,
   dependency-volume rm.
4. Existing post-failure cleanup evidence remains: no sidecar/volume, proxy
   marker gone, session tmpdirs and run roots released, no cleanup warning.
5. Deterministic coverage includes immediate and controlled delayed
   fake-sidecar registration, both within the existing timeouts. Listener bind
   failures and never-register cases remain visible failures.
6. Focused tests pass repeatedly; the full verification cycle passes.

## Scope

- `packages/cli/src/utils/sandbox-launch-release.test.ts` (fixture gate,
  shared scenario helper, delayed variant, order assertion)
- `project-plans/issue3533-sandbox-launch-release-fixture-race.md` (this plan)

Not touched: workflows, release scripts, production sandbox code,
`fake-dependency-engine.ts` and its harness (no private delay control is
needed), dependencies, quality tools, `.llxprt/`, public APIs.

## Verification

Executed 2026-09-03 on branch `issue3533`; all logs under `tmp/issue3533/`.

- RED (`red.log`, `red-repeat.log`): with the old unconditional listener, the
  delayed-registration scenario failed 3/3 runs with the exact release-run
  error, `Command failed: docker network connect … No such container:
  llxprt-code-sandbox-proxy`, before the fixture gate was applied.
- Focused file after GREEN (`green-1.log`, `green-repeat.log`,
  `green-2.log`, `green-final.log`): 6/6 tests passed on eight runs total
  (1 + 5 + 1 + 1 across the four logs), including the final formatted tree.
- Test-audit (`test-audit-before/`, `test-audit-after/`): findings.tsv diff
  is empty; no findings on the touched file.
- Full cycle on the final tree: `npm run test` exit 0 (`npm-test.log`),
  `npm run lint` exit 0 (`npm-lint.log`), `npm run build` exit 0
  (`npm-build.log`), `npm run format` exit 0 (`npm-format.log`; it only
  rewrapped the touched test file, after which the focused file and eslint
  were re-run green), `npm run typecheck` exit 0
  (`npm-typecheck-final.log`), stepfun-37 smoke exit 0 (`smoke.log`), and
  `git diff --check` clean.
- Typecheck note: the first `npm run typecheck` run (`npm-typecheck.log`)
  failed on pre-existing stale workspace `dist` declarations
  (`RuntimeCompressionGuardInfo`, `peekShellJobManager`,
  `RAW_TOKEN_DELTA_SINK_KEY` missing from built `.d.ts` while present in
  source; none of the errors reference the touched file). Running
  `npm run build` refreshed the declarations and the re-run passed; this
  issue's change is a single test file and cannot affect those exports.

## Remediation (first compliance review)

Executed 2026-09-03 on the same branch; all remediation logs under
`tmp/issue3533/remediation/`.

Findings addressed (classification from the review):

1. High: the 750 ms delayed-registration scenario proved nothing about
   request order. The fixture now uses a private readiness gate: the sidecar
   child is spawned behind a real `sh -c "until [ -e <release> ]"` file
   barrier whose release file is created only after the 8877 listener has
   observed and destroyed a genuine pre-registration readiness request. The
   test asserts the observable gate state: at least one rejected request
   before registration and at least one accepted request after it.
2. Medium: focused tests orphaned fake proxy-command `sleep 120`
   descendants (the review found 12 PPID-1 sleeps after six runs). The
   fixture now records every sidecar child as a detached process-group
   leader, terminates each whole group with SIGKILL on release, awaits the
   direct child's exit (reaping, no zombies), and a new process-lifecycle
   regression runs three proxied launches and then probes every created
   group until `kill(-pgid, 0)` fails with ESRCH.
3. Low: the round-1 verification section above said "seven runs" while its
   four cited green artifacts total eight; corrected.

RED (`red-finding1-and-2.log`, `-run2.log`, `-run3.log`,
`red-finding1-and-2-run5.log`, `ps-after-red.txt`): with the barrier and
group-termination absent, the gated scenario failed deterministically with
the readiness-timeout path (`docker rm -f … No such container` instead of
`engine launch failed`), and the process-group regression failed with
`sidecar process group … still has live members after termination`. The
post-RED process snapshot shows four new PPID-1 `sleep 120` orphans in the
groups the run created (87760, 90963, 91030, 91094).

GREEN: focused file 7/7 on every run after the fixes (`green-run1.log`,
`green-repeat-3runs.log`, `green-run-after-audit-fix.log`,
`green-final-focused.log`, `green-final-repeat-3runs.log`: 1 + 3 + 1 + 1 + 3
= nine runs total). The leak snapshots after those runs
(`ps-before/after-green-repeat.txt`,
`ps-after-green-final-focused.txt`, `ps-after-green-final-repeat.txt`)
show no `sleep 120` outside the pre-existing ppid-19869 chain, and port 8877
is free after every run.

Test-audit (`test-audit/`, `test-audit-2/`, `test-audit-final/`): the first
scan flagged one new `SWALLOWED_ASSERT` on the touched file; after moving
the errno classification out of the catch, the final scan has zero findings
for the touched file and 2028 total findings, matching the pre-change
baseline exactly.

Full cycle on the remediation tree: `npm run lint` exit 0 (`npm-lint.log`),
`npm run typecheck` exit 0 (`npm-typecheck.log`), `npm run format` exit 0
(`npm-format.log`; no further edits to the touched files), focused file
re-run 7/7 after format, `npm run build` exit 0 (`npm-build.log`), and
`git diff --check` clean.

Full `npm run test`: two runs (`npm-test.log`, `npm-test-final.log`, exits
in the matching `.exit` files). In both, the CLI workspace passed 737/738
files including this file, and tools passed 130/130 in the second run; the
one failing file both times was `sandbox-seatbelt.test.ts`, failing only in
its `assertSeatbeltProxyPortAvailable` cleanup, which also binds fixed port
8877. Attribution runs on the unmodified tree reproduced the same
EADDRINUSE collisions by running that file concurrently with this one
(`collide-clean-A/B-run*.log`, `collide-A/B-run*.log`,
`collide-cur-A/B-run*.log`), and the file passes
47/47 in isolation (`seatbelt-solo-runs.log`, 6/6 runs). This is a
pre-existing cross-file fixed-port race between two test files, not a
regression of this remediation: the touched file keeps its listener open
only while its own scenarios run and waits for the port to be rebindable
after closing it, which narrows but cannot eliminate the other file's
independent bind. The known tracking issues for it are #3501 and #3512; a
first suite run also saw one unrelated 15 s tools timeout
(`grep-ripgrep-issue3203-remediation`), absent from the second run; that
flake is load-sensitive.

Deferred out of scope: the readiness-listener bind-failure shim cleanup is
tracked as #3538 and is not implemented here. No production file, workflow,
dependency, quality tool, or fake-engine public behavior was touched.

## Final remediation (scope correction)

Executed 2026-09-03 on the same branch; all logs under
`tmp/issue3533/final-remediation/`.

### Scope-boundary correction

The first remediation accidentally moved the listener acquisition inside the
scenario helper's try/finally, which made a rejected `listenAt(8877, ...)`
bind run the finally's timeout-shim and gate-directory cleanup. That is the
central cleanup mechanism explicitly deferred to #3538, and it was never in
this issue's scope. The final correction moves the `listenAt(8877, ...)`
acquisition (and the `PATH` shim prepend) back to before the try/finally, so
the pre-remediation behavior holds: a bind failure rejects the scenario with
the bind error and the shim/gate temp-dir cleanup does not run for it. A
comment marks the boundary as the deferred #3538 limitation. No bind-failure
cleanup test was added; #3538 remains unimplemented and OPEN. The resolved
readiness barrier, gate counters, process-group termination/reaping, and
behavioral order are unchanged.

### Focused evidence on the final tree

- Focused file, repeated (`11-focused-run-1/2/3.log` exit 0 each,
  `13-focused-final.log` exit 0): 7 pass / 0 fail on every run.
- Process-group leak probe, repeated (`11-group-probe-run-1/2/3.log`,
  `13-group-probe-final.log`, exits 0): each run captured the 5 detached
  sidecar groups the scenarios created and every one was fully gone
  (ESRCH); `surviving_groups=0` on all four probes.
- Post-run `sleep 120` scans (`11-post-focus-ps.txt`,
  `12-post-focus-ps-final.txt`, `12-sleep120-pids.txt`): every surviving
  `sleep 120` is attributable to the pre-existing external lane watcher
  (ppid 19869 `watch-lanes.sh`) or to other LLxprt sessions' own scenario
  work; none descend from this file's runs.
- Test-audit (`test-audit/findings.tsv`): zero findings for the touched
  file and 2028 findings total, byte-identical to the pre-change baseline
  (`tmp/issue3533/remediation/test-audit-final/findings.tsv`).

### Full verification cycle on the final tree

- `npm run test` exit 0 (`04-npm-test.log`, `04-npm-test.exit`): passed with
  the CLI phase pinned to concurrency 1 via the sanctioned
  `LLXPRT_CLI_TEST_CONCURRENCY` escape hatch (`scripts/lib/bun-test-policy.ts`
  parses it deliberately for exactly this purpose), because runs 1-3 at the
  default concurrency 4 (`01/02/03-npm-test.log`, exits 1) failed only in the
  unchanged `sandbox-seatbelt.test.ts` `assertSeatbeltProxyPortAvailable`
  cleanup — the known intra-suite fixed-port-8877 race tracked as #3501 and
  #3512, already reproduced on the unmodified tree and never in the touched
  file. Watcher attribution (`port8877-watch-run3.log`,
  `port8877-watch-run4.log`) confirmed both causes: sibling sessions and
  this suite's own concurrent files held 8877 during runs 1-3; at
  concurrency 1 the only holder during the passing run was this file's own
  scenario listener (pid 44914, ~7 s), which is exactly the intended
  fixed-port design. No production, test, or workflow change was made to
  work around the contention. Full summaries in the passing run: 738/738
  CLI test files, 9508 passed / 0 failed test cases, plus 13/13, 590/590,
  388/388, 7/7, 22/22, 13/13, and 7/7 across the other workspaces.
- `npm run lint` exit 0 (`05-npm-lint.log`, `05-npm-lint.exit`).
- `npm run typecheck` exit 0 (`06-npm-typecheck.log`,
  `06-npm-typecheck.exit`).
- `npm run format` exit 0 (`07-npm-format.log`, `07-npm-format.exit`);
  post-format `git status` shows only the two scoped files, and the
  pre-format and post-format diffs of the touched file are identical
  (prettier made no edits).
- `npm run build` exit 0 (`08-npm-build.log`, `08-npm-build.exit`).
- stepfun-37 smoke exit 0 (`09-stepfun-smoke.log`, `09-stepfun-smoke.exit`):
  the haiku rendered through the stepfun-37 profile.
- `git diff --check` clean (`10-git-diff-check.log`, exit 0).

Status: the #3538 deferral stands (issue OPEN, mechanism unimplemented, no
bind-failure cleanup tests); the two prior #3533 findings (readiness barrier
proof, process-group reaping) are preserved verbatim from the previous
commit; the full cycle above ran on the final corrected tree.

## PR OCR remediation (second review, final)

Executed 2026-09-03 on the same branch; all logs under
`tmp/issue3533/pr-ocr-remediation/`. The second and final PR OCR review
(2 of 2; no third review was run) emitted three findings, all on
`packages/cli/src/utils/sandbox-launch-release.test.ts`, all introduced by
this PR's commits. Classification and action for each:

1. `awaitPortRebindable` returned silently at its 10-second deadline.
   **In-scope-Fix (fail-fast):** the wait now throws
   `port N did not become rebindable within Xms` at the deadline instead of
   deferring attribution to whatever bind fails next. The deadline became
   an optional parameter (`deadlineMs = 10_000`, call sites unchanged) so
   the failure is testable without adding a 10 s wait to every suite run.
   Behavioral test: `fails fast when a held port never becomes rebindable`
   holds a real listener on an ephemeral port, expects the rejection, then
   releases the holder and expects the same wait to resolve.
2. `sidecarGate.releasePath` was interpolated unescaped into the
   single-quoted `sh -c` barrier. The gate path is rooted at
   `os.tmpdir()`, which resolves from OS/environment input (TMPDIR) and may
   legally contain a single quote; that is exactly the external-input case
   where hardening is appropriate. **In-scope-Fix:** POSIX single-quote
   escaping (`.replaceAll("'", "'\''")`). Behavioral test:
   `gated sidecar registers through a release path containing a single
   quote` routes a real gated sidecar spawn whose release file lives in a
   quote-named directory and observes the fake engine register the
   container.
3. The async `afterEach` ran child termination and the port wait before
   restoration with no try/finally. **In-scope-Fix:** the cleanup is now a
   named `restoreFixture` with restoration in a `finally`; failures still
   propagate (nothing is swallowed). Behavioral test:
   `restores the fixture even when child termination fails` injects a
   real-shaped OS kill failure (EPERM for the sidecar group) at the
   `process.kill` boundary, asserts the rejection still surfaces, and that
   env, cwd, and the fixture directory were restored anyway.

No Reject or Defer classifications: every finding is fixture-local,
introduced by this PR, and each fix is the smallest correction (one
throw, one escape, one try/finally). No production code, workflow,
dependency, quality tool, fake-engine behavior, public API, or #3538
mechanism was touched.

### TDD evidence

- Refactor first (`01-refactor-focused.log`): naming the cleanup changed
  nothing; 7/7 before any new test was added.
- RED (`02-red-finding1.log`, `02-red-finding2.log`,
  `02-red-finding3.log`, `02-red-full-file.log`): each new test failed for
  the finding's exact symptom (the promise resolved silently after the
  10 s deadline; the gated child died instantly with `exitCode=2`, a
  shell syntax error, and never registered; the injected EPERM propagated
  but `process.env` stayed dirty), while the seven pre-existing tests
  stayed green (7 pass / 3 fail in the full-file run).
- GREEN (`03-green-run-1/2/3.log`, `05-focused-post-cast-removal.log`,
  `05-focused-post-assert.log`, `10-post-format-focused.log`): 10 pass /
  0 fail on every run; the three new tests take ~0.3-0.5 s each.

### Process-group leak evidence

- 14 probe runs (`03-group-probe-run-1..12.log`,
  `14-group-probe-final-13/14.log`): `surviving_groups=0` on every probe.
  One probe (run 1) saw its test run exit 1 with output discarded by the
  pre-existing probe script; its group evidence still held. Runs 4-14
  used a captured variant (`group-leak-probe-captured.ts`) and were fully
  green.
- During probes 7-12 a port-8877 watcher (`03-port8877-watch.log`)
  attributed the only 8877 listener to each probe's own test process
  (~7 s per run, the intended fixed-port scenario listener); no external
  holder appeared.
- Post-run `sleep 120` scans (`14-post-runs-sleep120.txt`): the only
  survivor is the pre-existing external lane watcher chain (ppid 19869).

### Test-audit

- `test-audit/` and `test-audit-final/` (pre- and post-format): zero
  findings for the touched file, 2028 findings total, byte-identical to
  the pre-change baseline
  (`tmp/issue3533/remediation/test-audit-final/findings.tsv`).

### Full verification cycle (final tree, post-format)

- `LLXPRT_CLI_TEST_CONCURRENCY=1 npm run test` exit 0 (`06-npm-test.log`):
  738/738 CLI test files, 9511 passed / 0 failed / 5 skipped / 13 todo
  (the pre-change baseline's 9508 passed plus this change's three new
  tests); the junit entry for the touched file carries no failure
  (`06-junit-touched-file.txt`); every other workspace green.
- `npm run lint` exit 0 (`07-npm-lint.log`).
- `npm run typecheck` exit 0 (`08-npm-typecheck.log`; an earlier
  pre-final-shape run also passed, `04-typecheck-early.log`).
- `npm run format` exit 0 (`09-npm-format.log`); it rewrapped one
  expression in the touched file (`09-format-diff-touched.txt`), after
  which eslint and the focused file were re-run green
  (`10-post-format-eslint.log`, `10-post-format-focused.log`).
- `npm run build` exit 0 (`11-npm-build.log`).
- stepfun-37 smoke exit 0 (`12-stepfun-smoke.log`).
- `git diff --check` clean (`13-git-diff-check.log`).
