# Issue #3491 — remediation brief (review round 1 findings)

Branch `issue3491`, single commit `3a6aec307`. A review produced seven findings.
Each is triaged below. Implement the ones marked **FIX**. Do not implement the
ones marked **REJECT** or **DEFER**, and do not widen scope beyond what is
written here.

The whole verification cycle was green on `3a6aec307` (build, typecheck, lint,
format, `npm run test` exit 0, stepfun-37 smoke). Re-run it after these changes.

---

## FIX 1 — reaper misses genuine orphans when the bun path contains spaces

**Blocker.** `scripts/lib/bun-test-reaper.ts` currently does

```ts
const tokens = comm.trim().split(/\s+/);
const basename = (tokens[0] ?? '').split('/').pop() ?? '';
return ['bun', 'bun.exe'].includes(basename) && tokens[1] === 'test';
```

`ps -eo pid=,ppid=,args=` renders argv as a display string and does not quote an
argv[0] that contains spaces. For a real orphan spawned as
`/path with spaces/bun test src/foo.test.ts` the tokens become `/path`, `with`,
so the orphan is missed. The old substring heuristic caught it, so this is a
regression against the original purpose in #2909.

Replace the token-0 check with one that anchors on the literal `test` argument
and treats everything before it as the executable:

```ts
const tokens = comm.trim().split(/\s+/);
const testIndex = tokens.indexOf('test');
if (testIndex < 1) return false;
const executable = tokens.slice(0, testIndex).join(' ');
const basename = executable.split('/').pop() ?? '';
return basename === 'bun' || basename === 'bun.exe';
```

Confirm against the cases that matter and add tests for each:

- `/path with spaces/bun test src/foo.test.ts` — reaped
- `/usr/local/bun/bin/bun test --max-concurrency 1 src/foo.test.ts` — reaped
- `bun test src/bar.test.ts` — reaped
- `.../node_modules/bun/bin/bun.exe test src/x.test.ts` — reaped
- `node /usr/local/share/npm-global/bin/llxprt --prompt-interactive please run the test suite`
  — NOT reaped (prefix basename is `the`)
- `bun run build`, `node server.js` — NOT reaped

Update the doc comment so it describes what the predicate now does.

## FIX 2 — the shutdown notice can be swallowed by patched stdio

**Blocker.** `packages/cli/src/utils/shellJobShutdownNotice.ts` writes with
`process.stderr.write`. `patchStdio()` in `packages/core/src/utils/stdio.ts`
replaces that method with an event-bus emitter. The SIGTERM and SIGINT paths run
`runExitCleanup()` first, which restores stdio, but the quit path in
`packages/cli/src/ui/containers/AppContainer/hooks/useExitHandling.ts` calls
`process.exit(0)` directly and deliberately skips cleanup. On that path the
notice goes into the bus and may never reach the terminal. A stream write is
also not a guaranteed synchronous flush inside a process `exit` callback.

Build the whole message first, then write it synchronously to the physical
descriptor with `fs.writeSync(2, message)`. Nothing else about the handler
changes.

Add a subprocess test that pins this: a small script that calls `patchStdio()`,
creates a `ShellJobManager` with a running job, registers the notice, and calls
`process.exit(0)`; the parent asserts the notice text appears on the child's
stderr. Keep it to that; do not build a CLI or PTY harness.

## FIX 3 — the exit handler creates a ShellJobManager on job-free exits

**Blocker.** `Config.getShellJobManager()` (`packages/core/src/config/config.ts`)
delegates to `getOrCreateShellJobManager`, which constructs a manager when none
exists. `ShellJobLogStore`'s constructor calls `fs.mkdtempSync`. The manager is
created lazily — only when a background job is launched or the
`shell-max-background-jobs` setting is applied — so on a session that never
backgrounded anything, the exit listener creates a manager and a `shell-jobs-*`
temp directory during exit and then dies without disposing it.

Add a non-creating accessor next to the existing one and use it from the notice:

- `packages/core/src/config/configBase.ts`: abstract
  `peekShellJobManager(): ShellJobManager | undefined`
- `packages/core/src/config/config.ts`: return the private field directly, never
  creating
- `packages/cli/src/utils/shellJobShutdownNotice.ts`: depend on
  `Pick<Config, 'peekShellJobManager'>` and call that instead

If `ConfigBase` has other concrete subclasses or test doubles that must
implement the abstract member, update them; that is required for the build.

Add a test that a job-free exit writes nothing AND does not construct a manager
or create any filesystem state.

## FIX 4 — correct the documented invocation shape

The mechanism write-up cites a `ps` capture taken with `--prompt`, but
`resolveInteractiveMode` in `packages/cli/src/config/interactiveContext.ts`
treats `--prompt` as non-interactive, and the silent status-0 SIGTERM handler in
`packages/cli/src/cliTerminalSession.ts` is installed only for interactive runs.
The two halves of the chain therefore need the same invocation to hold together.

They do, under `--prompt-interactive`: `resolveInteractiveMode` returns true when
`argv.promptInteractive !== undefined`, and that flag also puts the prompt text
into argv where `ps` shows it. That is the shape that satisfies both halves —
interactive, so the status-0 handler is installed, and prompt-bearing argv, so
the old predicate matched.

Update `project-plans/issue3491-sandbox-background-job-exit.md` and the doc
comment in `scripts/lib/bun-test-reaper.ts` to say this precisely: the capture
was taken with `--prompt` to obtain the argv and PPID shape, and the failing
session's silent status-0 exit requires an interactive run whose argv carries the
word, which `--prompt-interactive` produces. Note plainly that under a
non-interactive `--prompt` run the same reap still kills the session, just with
status 143 instead of 0. Change the fixture argv in the reaper tests to
`--prompt-interactive` so the fixture and the prose agree.

Do not change any interactive-mode logic. This finding is about the accuracy of
the record, not about behaviour.

## FIX 5 — test hygiene

- `packages/cli/src/utils/shellJobShutdownNotice.test.ts`: the
  `registers the exit listener on the real process by default` case leaves a
  real `exit` listener installed in the shared test process. Capture the
  listener and remove it in cleanup.
- `packages/core/src/services/shellBackgroundIntegration.test.ts`: the new
  several-turns case depends on a fixed `sleep 5` for its still-running
  assertions, which is wall-clock fragile on a loaded runner. Gate the job on an
  explicit signal the test controls (for example a sentinel file the job waits
  for) instead of a fixed sleep, and move the sentinel-directory cleanup so it
  runs on failure as well as success.
- `scripts/tests/bun-test-reaper.bun.test.ts`: the header says every assertion
  is unchanged from the file it was moved out of, which is no longer true. Say
  what actually happened.

## FIX 6 — add a sandbox-topology regression case for the coupled exit

One test, in `scripts/tests/bun-test-reaper.bun.test.ts`: a fabricated `ps`
table representing the container mid-run — the CLI shim at PPID 1, the managed
background job, and genuine orphaned `bun test` children at PPID 1 — asserting
that the orphans are reaped and the CLI shim is not. This is the case that
directly pins the coupled exit: the reaper runs while a managed job is live and
must not touch the session it is running under.

---

## REJECT — do not implement

- **Replacing the several-turns test with a full sandbox/agent-loop harness.**
  The review asks for a harness that runs real agent turns, a podman container
  and the reaper together. That is a new integration subsystem, needs a
  container engine in CI, and is outside the issue's scope. FIX 6 pins the same
  regression at the level where it actually happens. Keep the several-turns case
  as the guard for the "outlives several turns" clause, with the FIX 5 hygiene
  applied and an honest name.
- **A subprocess/PTY suite covering SIGTERM, SIGINT and quit end to end through
  the real CLI.** The single subprocess test in FIX 2 pins the mechanism that was
  actually broken. A full CLI lifecycle suite is scope expansion.

## DEFER — record, do not implement

- The predicate still matches any PPID-1 `bun test`, including one belonging to
  a different checkout on the same machine. PPID 1 does not prove ownership.
  This is pre-existing behaviour, unchanged by this work, and already recorded
  as out of scope in the plan. Leave it; it is follow-up material.

---

## Verification

Full cycle after the changes, writing logs to unique paths under
`tmp/issue3491/` and never to bare `/tmp`:

```
npm run build
npm run typecheck
npm run lint
npm run format
npm run test
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Run `npm run test` as a background job and poll it. Fix every failure. Amend the
existing commit rather than adding a second one. Do not push and do not open a
PR.
