# Issue #3491 — Sandboxed session exits 0 mid-task after backgrounding a long shell job

## 1. Mechanism (established, with evidence)

The report listed three candidate mechanisms and asked that they be told apart
before anything was changed. They have been. The cause is none of the three as
originally worded: it is the repository's own test runner sending `SIGTERM` to
the sandboxed CLI.

### The chain

1. The container is started with `--init`
   (`packages/cli/src/utils/sandbox-containers.ts`, the `run` argument list).
   Under `--init`, `/run/podman-init` is PID 1 and the container's main process
   is its direct child, so the main process has **PPID 1**.

2. The container's main process is the published `llxprt` bin shim, exec'd by
   the sandbox entrypoint. Its `ps` argv begins with `node`:

   ```
   1  0  /run/podman-init -- bash --noprofile --norc -c exec llxprt --prompt "please run the test suite"
   2  1  node /usr/local/share/npm-global/bin/llxprt --provider openai --key xx --prompt please run the test suite
   9  2  /usr/local/.../node_modules/bun/bin/bun.exe /usr/local/.../bundle/llxprt.js -- --prompt please run the test suite
   ```

   Captured from `ghcr.io/vybestack/llxprt-code/sandbox:0.11.0-nightly.260831.393a0080f`,
   the exact image named in the report.

   The capture was taken with `--prompt` to obtain the argv and PPID shape.
   The reported silent status-0 exit requires an invocation that satisfies
   both halves of the chain — an interactive run, so the status-0 SIGTERM
   handler from `cliTerminalSession.ts` is installed, and prompt-bearing
   argv, so the old substring predicate matched. `--prompt-interactive` is
   that invocation: `resolveInteractiveMode` in
   `packages/cli/src/config/interactiveContext.ts` returns true when
   `argv.promptInteractive !== undefined`, and the flag also places the
   prompt text in argv where `ps` shows it. Under a non-interactive
   `--prompt` run the same reap still kills the session, just with status
   143 instead of 0, because no status-0 handler is installed and the
   unhandled signal terminates the process.

3. `scripts/run_bun_tests.ts` reaps "stale orphaned test processes" at the start
   of every run. `isOrphanedTestProcess` matches any process that has PPID 1 and
   whose argv contains `bun` **or** `node`, and contains `test` **or** `spec`.
   The sandboxed CLI at PID 2 satisfies all of it: PPID is 1, argv starts with
   `node`, and the session prompt carries the word `test`.

4. Feeding the verbatim `ps` capture above to the real exported
   `reapStaleBunTestProcesses` reaps exactly one process — PID 2, the CLI — and
   prints the exact line the report quotes from the job log:

   ```
   [run_bun_tests] Reaped 1 stale orphaned test process(es) (PPID=1) before run.
   ```

5. `packages/cli/bin/llxprt.mjs` installs handlers for the shared-group signals
   and forwards them to the Bun child, then propagates the child's exit code
   (`process.exit(code ?? 0)`).

6. The interactive CLI's own `SIGTERM` handler, installed by
   `enableInteractiveRawModeIfNeeded` in `packages/cli/src/cliTerminalSession.ts`,
   runs `runExitCleanup()` and then `process.exit(0)`. It prints nothing.

7. Exit 0 from the container's main process ends the container. `--rm` removes
   it, taking the background job with it; `podman` exits 0, the host CLI exits 0,
   and the tmux pane records `status 0`.

Every observation in the report follows: a clean status-0 exit with no signal
and no message, the job's log stopping in the same second as the exit (container
teardown, not a separate kill), the `--rm` removal consistent with the main
process exiting normally, and the reap line sitting in the job log itself.

### Why it only happens in a sandbox

Outside a container the CLI's parent is the user's shell, never PID 1, so the
reaper's PPID test excludes it. The delay between the reap and the visible exit
is the CLI draining `runExitCleanup()`.

### What the three original candidates were

- stdin EOF: not involved. The host spawns the container with `stdio: 'inherit'`
  and background jobs are spawned with `stdio: ['ignore', logFd, logFd]`, so no
  child ever holds the CLI's stdin.
- Process-group teardown from the job side: not involved. `Bun.spawn` honours
  `detached: true` (verified: the child's pgid equals its own pid), so the job
  runs in its own process group.
- Managed background-job lifecycle: not involved. The job was launched and
  tracked correctly; it died with the container.

## 2. Accepted behaviour

### AC1 — the reaper must not be able to kill the CLI

`scripts/run_bun_tests.ts` must only reap processes that are actually the
`bun test` children this runner spawns. `buildSpawnArgs` produces
`<bun-executable> test [flags...] <file>`, so the predicate must require:

- PPID is 1 and the pid is not the runner's own pid (unchanged), and
- the first argv token's basename is `bun` or `bun.exe`, and
- the second argv token is exactly `test`.

The substring tests on `node`/`bun` and `test`/`spec` anywhere in the argv are
removed. A process whose argv merely mentions `test` — including the sandboxed
CLI, and including any user command that happens to contain the word — is no
longer a candidate.

This preserves the original purpose from #2909: children orphaned when the
runner is killed are exactly `<bun> test … <file>`, and they still match.

### AC2 — shutting down with managed background jobs running must be announced

When the CLI process exits while the `ShellJobManager` has jobs in the `running`
state, it must write a message to stderr naming how many jobs were running and
identifying each one (job id and command), instead of exiting silently.

The message must be emitted on the paths that produced the reported silence —
`SIGTERM`, `SIGINT`, and the quit path — and must not be emitted when no job is
running. The exit code itself is not changed by this work.

### AC3 — behavioural coverage

Tests that fail before the change and pass after it:

1. `scripts/tests/run_bun_tests.test.ts`
   - The verbatim sandbox `ps` capture from section 1 reaps nothing.
   - A genuine orphan spawned in this runner's own shape
     (`/path/to/bun test --max-concurrency 1 --timeout 60000 src/foo.test.ts`,
     PPID 1) is still reaped with `SIGTERM`.
   - The runner's own pid is never reaped (existing behaviour, keep).
   - The existing `node src/bar.spec.ts` expectation is updated: that shape is
     not something this runner spawns, and matching it is the defect.

2. CLI behavioural test for AC2
   - With a running managed background job, the shutdown path writes a message
     naming the job; with no running job it writes nothing.

3. Background job outliving several turns
   - A managed job launched during one turn remains registered and `running`
     across several subsequent turns, and nothing in the turn loop terminates it
     or ends the session.

## 3. Out of scope

- Changing the CLI's `SIGTERM` exit code. The report asks for an announcement,
  not a different status.
- Reworking sandbox signal forwarding, the `--init` choice, or the bin shim.
- Cross-repository reaping. After AC1 the reaper can still match a genuine
  `bun test` orphan belonging to a different checkout on the same machine. That
  is pre-existing behaviour and unchanged here; record it as a follow-up rather
  than widening this change.
- Any adjacent cleanup in `shellJobManager`, `shellJobSpawn`, or the sandbox
  entrypoint.

## 4. Verification

Full cycle before commit, before push, and before the PR: `npm run test`,
`npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and the
`stepfun-37` smoke run.
