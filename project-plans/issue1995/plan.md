# Issue #1995 — SUPERSEDED: flag-only shell wrapper (v1)

> **This design was REJECTED.** It has been superseded by
> [`design-v3.md`](./design-v3.md) — the managed background shell job system
> (direct detached spawn, stable job id, `ShellJobManager`). The v2
> status-file protocol (`design-v2.md`) was also killed in design review
> before implementation.
>
> What actually shipped is described in `design-v3.md` and in the
> `CHANGELOG.md` `[Unreleased]` entry for #1995.

## What was wrong with the v1 design

The v1 approach wrapped the command in a **shell-text protocol** (`{ trap '' HUP;
<cmd>; } >'<log>' 2>&1 </dev/null &`) and relied on the shell's own `&` to
detach. This has several fatal problems documented in `design-v3.md` §0:

- `set -e; false` writes no status file; `exec` replaces the shell so the
  postlude never runs; trailing `#` comments or heredocs corrupt the generated
  line; `cmd & printf …` records the launch status (false success); signals
  never run the postlude. Status tracking was unsolvable in shell text.
- Exit codes/signals had no reliable source (the postlude could fail
  independently of the command).
- The job was tracked only by raw PGID from `pgrep -g 0`, with no lifecycle
  management, no budget, no retention, and no cleanup on session end.
- A `TMPDIR` containing spaces broke the unquoted `pgrep -g 0 >${tempFilePath}`
  redirect (deferred defect below).

## Still-true measured findings (from v1 investigation)

These empirical measurements remain valid and informed design-v3:

### child_process backend — naive `&`

Body `{ { sleep 2; yes X | head -100000; touch S; } & }`:

| observation          | value   |
| -------------------- | ------- |
| `exit` event         | 38 ms   |
| `close` event        | 2037 ms |
| job survived         | yes     |
| pgrep captured PIDs  | yes (2) |

The `close` delay is the undrained pipe, not a broken job. The genuine defect
is **backend inconsistency** (next row).

### node-pty backend — naive `&`

Same body:

| observation                     | value     |
| ------------------------------- | --------- |
| PTY `onExit`                    | 45 ms     |
| sentinel present after 4 s      | **false** |

PTY teardown sends `SIGHUP` to the slave, killing the surviving job. **Naive
`&` does not work at all on the PTY backend.** This is the pre-existing defect
that design-v3's direct-spawn approach fixes (no PTY is allocated for a
file-backed non-interactive job).

### node-pty is NOT the default backend

`applyShellFlags` sets `shouldUseNodePtyShell = false` by default. The
PTY-teardown kill is real but only affects users who explicitly enable the
interactive shell.

## Deferred defects (still open — file follow-ups)

These pre-date issue #1995 and affect the foreground path identically:

1. **`endsWith('&')` misfire.** `buildCommandToExecute` decides "already
   backgrounded" with `trimmed.endsWith('&')`, which misfires on an escaped
   terminal ampersand (`printf foo\&`), `echo '&'`, and `&&`. Design-v3 slice 6
   replaced this with AST-based detection for the managed path, but the raw
   foreground wrapper path still uses the text check.
2. **Unquoted `tempFilePath`.** `pgrep -g 0 >${tempFilePath}` is interpolated
   unquoted so a `TMPDIR` with spaces breaks the redirect. Design-v3's direct
   spawn avoids this entirely (no shell-text protocol), but the legacy
   foreground wrapper retains it.
3. **`IShellExecutionService` adapter.** The bare adapter
   (`createShellToolHostFromExecutionService`) unwraps the wrapper before
   delegating, dropping `pgrep -g 0` and hardcoding `pid: undefined`.
4. **node-pty signal 0.** node-pty reports `signal: 0` for a clean exit;
   `formatNormalOutput` emits `Signal: 0` instead of `Signal: (none)`. Predates
   #1995, affects the foreground path.
