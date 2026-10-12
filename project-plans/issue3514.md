# Issue #3514: scope the bun test orphan reaper to this checkout and count confirmed exits

## Problem

`scripts/lib/bun-test-reaper.ts` kills any PPID-1 `bun test` process, including
orphans of other checkouts, other users, or parallel CI jobs. It also counts and
logs a process as reaped as soon as `kill(pid, 'SIGTERM')` does not throw, even
when the process ignores SIGTERM and keeps running.

## Design

### Ownership marker

- `scripts/run_bun_tests.ts` gets a private helper that builds the marker
  `llxprt-bun-runner-owner-<first 16 hex chars of sha256(resolve(repoRoot))>`.
- The marker is appended as the last argv element of every spawned
  `bun test` (every file, every retry), after the test file. It is one valid
  positional token for `bun test`. It is a path filter that matches no file, so
  it does not select extra tests.
- `buildSpawnArgs` keeps its signature and output. The marker is added where
  the runner assembles the command for a spawn attempt.
- `main()` computes the reaper's token with the same helper and `repoRoot`.
- `reapStaleBunTestProcesses(spawnSync, kill, ownPid, ownerToken, sleep, stderr?)`:
  `ownerToken` and `sleep` are required; `sleep` is the infrastructure seam used
  for the bounded synchronous confirmation (the runner passes `Bun.sleepSync`).
  `stderr` is the optional log sink. `kill` accepts `string | number` signals
  so the reaper can send signal 0.
- A candidate is reaped only if every existing check holds (PPID 1, not own pid,
  `comm` basename `bun`/`bun.exe`, token after the first bun-basename token is
  `test`) and the final whitespace-separated argv token equals the exact owner
  token.

### Confirmation

1. SIGTERM every owned candidate. A SIGTERM that throws leaves the process
   uncounted.
2. Shared TERM grace: poll signal 0 every 50 ms for up to 2 s. Only an `ESRCH`
   from signal 0 confirms a process gone. A live result, `EPERM`, or any
   other error never confirms.
3. Re-run both `ps` captures and revalidate ownership of the survivors. Only a
   survivor that is still an owned orphan receives SIGKILL; one whose identity
   changed is left alone and uncounted.
4. Shared KILL grace: poll signal 0 every 50 ms for up to 1 s, same rules.
5. The count is the number of ESRCH confirmations. The log line text is
   unchanged and means "confirmed gone". No sleeping happens when nothing is
   pending. No survivor diagnostics are added.

### Legacy orphans fail closed

Orphans spawned by a runner from before this change carry no owner marker and are
therefore never reaped by the new runner. This is deliberate: an unmarked
`bun test` cannot be attributed to this checkout. They need a one-time manual
kill.

### Known limits

- The `ps` snapshot and the signal are not atomic. A PID that is reused between
  the final ownership snapshot and the signal can still be hit. Revalidating
  ownership before SIGKILL closes only the long window (the TERM grace), not
  that last gap. Closing it needs OS-specific process handles (pidfd on Linux,
  job objects or handles on Windows) and is deferred.
- Legacy unmarked orphans fail closed (see above): they are never reaped by the
  new runner and need a one-time manual kill.
- The args `ps` runs with `-ww` because procps `ps` truncates piped output to
  `COLUMNS`, which would cut off the final owner token. The real-process test
  runs the reaper with `COLUMNS=40`. Apple `ps` ignores `COLUMNS` for piped
  output, so the test could not be RED on macOS (`tmp/verify3514/red-columns.log`
  records the attempt and the measurement); it only fails without `-ww` under
  procps. GREEN: `tmp/verify3514/green-columns.log`.

## Acceptance criteria and tests

Tests in `scripts/tests/bun-test-reaper.bun.test.ts` use a small process-table
fake (infrastructure: `ps`, `kill`, sleep) whose `ps` output and liveness
answers derive from simulated process state, so assertions are on returned
counts, log lines, and which processes are alive afterwards.

| #   | Behavior                                                                                | Test                                                               |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Same-checkout manual `bun test` with no marker is not reaped                            | not-reaped, process still alive, count 0                           |
| 2   | Another checkout's orphan with identical flags but a different marker is not reaped     | not-reaped, alive                                                  |
| 3   | Marked orphan with a bun path containing spaces is reaped                               | reaped, count 1, dead                                              |
| 4   | Marked process whose PPID is not 1 is not reaped                                        | alive                                                              |
| 5   | Marked CLI-shaped process (`node`, prompt text) is not reaped                           | alive                                                              |
| 6   | Owned orphan that exits on SIGTERM is counted and logged; no SIGKILL is sent            | count 1, log text, no KILL                                         |
| 7   | Owned orphan that ignores SIGTERM and dies on SIGKILL is counted after escalation       | count 1, dead, escalation after TERM grace                         |
| 8   | Unkillable owned orphan is not counted or logged; total sleep stays within the bound    | count 0, no log, alive, sleep <= 3000 ms                           |
| 9   | Signal failure (EPERM on SIGTERM/SIGKILL, EPERM on signal 0) never counts               | count 0, no log                                                    |
| 10  | Mixed outcomes count only confirmed exits                                               | count equals exited pids only                                      |
| 11  | A survivor whose ownership changed before escalation is not SIGKILLed or counted        | not killed, count excludes it                                      |
| 12  | No sleeping occurs when no candidate exists or all exit on the first confirmation       | zero sleep calls                                                   |
| 13  | Existing #2909/#3491 predicate behavior is retained with marked argv                    | existing cases updated to the marker and process table             |
| 14  | Runner appends the marker to every spawn, including retries; differs across roots       | `run_bun_tests.test.ts` captures spawned argv                      |
| 15  | The spawned argv's marker is accepted by the reaper for that root and not for another   | argv from the runner fed to the reaper                             |
| 16  | Real `bun test <absolute file> <marker>` runs exactly that file's tests                 | real Bun invocation with a sibling test file that would also count |
| 17  | Real orphaned `bun test` child of a killed parent is reaped (where PPID reparents to 1) | real processes, `ps`, `process.kill`, `Bun.sleepSync`              |

Rows 14-16 live in `scripts/tests/run_bun_tests.owner-marker.test.ts` (split out
of `run_bun_tests.test.ts` to stay under the 800-line lint limit). The real
process test asserts that both children start, that killing the parent
reparents them, and, only when reparenting reached PID 1, that the owned orphan
is reaped and the foreign one survives. If a subreaper adopted them instead
(parent neither the killed parent nor PID 1), the test logs a `console.warn`
naming the adopting pid and stops after asserting that topology.

RED evidence for each behavior is recorded in the "Evidence" section below as it
is implemented.

## Out of scope

No workflow, lint, dependency, or quality-tool changes. No survivor
diagnostics. No change to the reaper's other predicate checks.

## Verification

`npm run test`, `npm run lint`, `npm run lint:ci`, `npm run lint:eslint-guard`,
`npm run typecheck`, `npm run format`, `npm run build`, and the lunahigh smoke
profile run. Test-audit scanner compared between baseline and branch. Logs live
under `tmp/verify3514/`. Review skipped per Andrew 2026-10-09.

## Evidence

All logs are under `tmp/verify3514/`.

- RED, reaper: `red-reaper.log` and `red-reaper-skeleton.log` (each 14 fail,
  20 pass of 34) from the new reaper tests against the pre-change reaper and
  against the signature skeleton.
- RED, runner: `red-runner.log` (5 fail, 48 pass of 53) from the marker and
  reaper-agreement tests before the runner appended the marker.
- GREEN, staged: `green-ownership-stage.log` (ownership filtering only, 24 pass,
  10 fail of 34, the failures being the confirmation behaviors), then
  `green-reaper.log` (34 pass, 0 fail).
- GREEN, both files after implementation: `green-both.log` (87 pass, 0 fail,
  2 files).
- Review-fix pass (marker tests moved to
  `scripts/tests/run_bun_tests.owner-marker.test.ts`; fake-kill call
  assertions replaced by process-table exit state):
  `fix-focused.log` (87 pass, 0 fail, 3 files, `EXIT=0`),
  `fix-eslint.log` (clean, `EXIT=0`), `fix-tsc-scripts.log`
  (`tsc --noEmit --project tsconfig.scripts.json`, `EXIT=0`).
- Discovery of the new test file by the `scripts-tests` root:
  `discovery-dryrun-full.log`.
- Test-audit comparison: `scan-base/` against `scan-branch2/`, see
  `scan-branch2.log`.
- Full `npm run test`, `lint`, `typecheck`, `build`, `format`, and the smoke run
  are recorded by the final verification pass.
