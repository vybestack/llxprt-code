# Issue #3491 — PR #3515 review remediation

Four accepted findings. Implement all four. A fifth is deferred with reasoning
at the bottom; do not implement it.

## FIX 1 (CRITICAL) — the reaper can still kill the CLI

`scripts/lib/bun-test-reaper.ts` infers argv[0] from the `ps args=` display
string. A PPID-1 CLI whose prompt happens to mention a path ending in `/bun`
followed by the word `test` passes the predicate. Reproduced against the current
code:

```
      2       1 node /usr/local/share/npm-global/bin/llxprt --prompt-interactive run /tmp/bun test suite
```

`tokens.indexOf('test')` selects the prompt's `test`, the joined prefix ends in
`/tmp/bun`, the basename is `bun`, and the CLI is reaped. That is the reported
bug, back again. It must not be possible to satisfy this predicate with prompt
text.

### The fix: get the executable from `ps`, not from the argument string

`ps -eo pid=,comm=` reports the executable independently of argv, so no prompt
content can forge it. Measured behaviour:

- macOS prints the full executable path, e.g.
  `3140 /opt/homebrew/lib/node_modules/@vybestack/llxprt-code/node_modules/bun/bin/bun.exe`,
  and the llxprt shim appears as `node`.
- Linux (inside the sandbox image) prints the base command name, e.g.
  `2 bash`, `1 podman-init`.

Both identify the binary. `comm` is the last field, so parse it as pid followed
by the rest of the line.

Change `reapStaleBunTestProcesses` to make two `ps` calls through its injected
`spawnSync`:

1. `['ps', '-eo', 'pid=,comm=']` to build a pid to executable map.
2. `['ps', '-eo', 'pid=,ppid=,args=']` exactly as today.

Keep the exported signature unchanged: `spawnSync` is already
`(cmd: readonly string[]) => { stdout: string | null }`, so it is called twice
with different arguments. If either call throws, return 0 as the existing
`catch` does.

The predicate becomes: reap the process only when all of these hold.

- `ppid === 1` and `pid !== ownPid` (unchanged)
- the basename of that pid's `comm` is `bun` or `bun.exe` — this alone excludes
  the CLI shim, whose `comm` is `node`, no matter what the prompt says
- in `args`, the token immediately after the FIRST token whose basename is
  `bun` or `bun.exe` is exactly `test`

The second and third conditions together mean the `test` token has to sit right
after argv[0], and argv[0] has to be a real bun binary. A path containing spaces
still works because the anchor is the bun-basename token rather than token 0.
A path whose interior directory segment itself ends in `bun` will fail to match
and simply not be reaped; failing closed there is correct.

Update the doc comment to describe the two-source check and why the argument
string alone is not trustworthy.

### Tests

In `scripts/tests/bun-test-reaper.bun.test.ts`, the `spawnSync` stub must now
answer both queries; dispatch on whether the requested format contains `comm=`.
Extend the existing `reapFromPs` helper to take a comm table rather than
duplicating it.

Add and keep:

- the prompt-shape regression above (`… --prompt-interactive run /tmp/bun test
  suite`, comm `node`) reaps nothing — this fails against the current code
- an executable path containing spaces (comm `/path with spaces/bun`) is still
  reaped
- the sandbox container capture still reaps nothing, now with comms
  `podman-init`, `node`, and the bundled `bun.exe`
- genuine orphans (bare `bun`, absolute path, `bun.exe`) are still reaped
- a PPID-1 process whose comm is `bun` but whose argv is `bun run build` is not
  reaped
- a process missing from the comm table is not reaped

## FIX 2 — `ExitListenerTarget` types the exit code wrongly

`packages/cli/src/utils/shellJobShutdownNotice.ts` declares
`listener: (code: number) => void`. Node and Bun invoke exit listeners with
`number | undefined` (undefined on a natural exit). Change the type to
`(code: number | undefined) => void` so the declared contract matches the
runtime event.

## FIX 3 — registration is not idempotent

Every call to `registerShellJobShutdownNotice` appends another `exit` listener,
so a second call would print the notice twice. Guard so a given target is armed
at most once, and add a test that calling it twice yields exactly one notice.
Keep the guard simple; a module-level `WeakSet` of targets is enough.

## FIX 4 — test cleanup is not error contained

In `packages/cli/src/utils/shellJobShutdownNotice.test.ts` the `afterEach` loop
aborts if one `manager.dispose()` throws, leaving later managers undisposed,
temp directories on disk and background jobs running into the next test. Run
every cleanup step regardless of individual failures, then surface any collected
failure after the arrays have been reset.

## DEFERRED — do not implement

CodeRabbit asks that the notice also fire when a non-interactive session is
killed by an unhandled signal, since Bun does not emit `exit` in that case. The
observation is correct. Acting on it means installing SIGTERM and SIGINT
handlers on paths that currently have none, which suppresses the default
disposition and has to re-raise, and it has to interact with the interactive
handlers that already exist without double-reporting or cutting their cleanup
short. That is a change to signal handling in a mode the issue did not report,
where the failure is a 143 rather than the silent status 0 this work is about.
It will be filed as a follow-up instead.

## Verification

From the repo root, logs to unique paths under `tmp/issue3491/`, never bare
`/tmp`:

```
npm run lint
npm run typecheck
npm run format
bun test --preload ./scripts/tests/test-setup.ts scripts/tests/bun-test-reaper.bun.test.ts
cd packages/cli && bun test --timeout 60000 src/utils/shellJobShutdownNotice.test.ts
```

Run long commands as managed background jobs; the foreground shell is capped at
about two minutes. Do not run the full `npm run test` or `npm run build`. Watch
the 800-line max-lines rule (counted lines exclude comments and blanks) on any
file you touch. Do not commit, amend, push, or open a PR.
