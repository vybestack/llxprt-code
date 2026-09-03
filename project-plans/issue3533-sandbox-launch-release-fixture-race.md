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
  `green-2.log`, `green-final.log`): 6/6 tests passed on seven runs total,
  including the final formatted tree.
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
