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
