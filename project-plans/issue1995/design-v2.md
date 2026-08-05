# Issue #1995 v2 — Managed background shell jobs

Supersedes the `is_background`-as-shell-wrapper approach in `plan.md`. That approach
was rejected: it kept upstream's flag while discarding the lifecycle half of upstream's
design, and it gated a fix for a **pre-existing** bug behind a new opt-in parameter.

## 0. What was wrong with v1

1. **The documented `&` path is still broken.** `getShellToolDescription()` tells every
   model "Command can start background processes using `&`". Measured: under node-pty
   (the default backend under Bun) such a job is killed by PTY teardown's SIGHUP; under
   child_process it holds llxprt's stdout/stderr pipes for its whole life. v1 built the
   cure (`trap '' HUP` + redirect) and applied it **only** when the new flag was set —
   `buildWrappedBody` returns `trimmed` verbatim otherwise. The broken promise stayed
   broken.
2. **"No Ctrl+B pane, so no registry" is a non-sequitur.** Not retaining a live PTY for a
   UI we lack is correct. But identity, enumeration, authoritative exit status,
   cancellation and completion notification need no pane, and the model needs all of them.
3. **The result misinforms.** `Exit Code: 0` is the *launcher's* status. A server that
   dies on startup is reported as started.
4. **No handle survives the turn.** A random `/tmp` path and a raw PGID held only in
   transcript context, with no enumeration, is not job management. `read_file` refuses
   the log (outside workspace), so every inspection costs a shell round trip.
5. **The async-task control plane was dismissed as "orthogonal"** on the basis of a field
   list rather than responsibilities.

## 1. Decision

Build **managed shell background jobs**: a real lifecycle owner in `packages/core`, with
authoritative state, surfaced through the **existing** async-task control plane
(`check_async_tasks`, `/task list`, `/task end`, completion reminders / auto-trigger).

Do **not** port upstream's PTY-retaining `background()` or a `Ctrl+B` pane. The job is
file-backed and detached: llxprt keeps *bookkeeping* ownership, the OS keeps *process*
ownership. That preserves the #1401/#1403 PTY protections while giving the model a real
handle.

### Test-runner constraint (drives layering)

`bun test`: **core**, auth, providers, policy, lsp, a2a-server.
`vitest`: tools, cli, agents, mcp, settings, storage, telemetry, ide-integration.

New tests must run under bun. Therefore **all non-trivial logic lives in
`packages/core`**; `packages/tools` and `packages/cli` get only thin, mechanical
adapters. This is a constraint we want anyway — the lifecycle belongs in core.

## 2. Mechanism

### 2.1 The wrapper (POSIX)

```
{ trap '' HUP; <cmd>; printf '%s' "$?" > '<status>'; } >'<log>' 2>&1 </dev/null &
```

- `trap '' HUP` — survives PTY teardown (measured: job lives; without it, it dies).
- `>'<log>' 2>&1` — group redirect captures all job output AND releases llxprt's
  inherited pipes immediately (measured: `close` at 31 ms vs 2037 ms).
- `printf … > '<status>'` — a **per-command** redirect overrides the group redirect, so
  the exit code lands in the status file, not in the log. This is the piece v1 lacked and
  is what makes authoritative completion possible.
- `</dev/null` — job does not compete for terminal input.
- trailing `&` — wrapper returns immediately; job is reparented to init.

All paths are single-quoted via the existing `singleQuoteForShell`.

### 2.2 Fast-fail handshake

After the wrapper exits, poll for `<status>` for a bounded window
(`STARTUP_SETTLE_MS`, default 300 ms, adaptive: return the instant the file appears).

- **Status appeared** ⇒ the job already finished. Return a **normal foreground-shaped
  result** — real exit code, log contents as stdout. No job is registered. This is what
  kills "reports a dead server as started".
- **Status absent** ⇒ still running. Register a job and return the background result.

This is upstream's 200 ms race, but resolved against an authoritative status file rather
than a guess.

### 2.3 Completion watcher

A single interval per manager (not per job), default 1 s, only while ≥1 job is running:

| status file | process group | ⇒ state |
| --- | --- | --- |
| present | — | `completed`, `exitCode` from file |
| absent | alive | `running` |
| absent | gone | `failed` (killed or vanished without writing status) |

Liveness uses `process.kill(pgid, 0)` on the negative pgid where the pid is confirmed to
be its own group leader, else the pid directly — the same verification already added to
the background test.

### 2.4 Cancellation

POSIX: `process.kill(-pgid, SIGTERM)` → escalate to `SIGKILL` after
`SIGKILL_TIMEOUT_MS` (reuse `shellProcessKill.ts`). Windows: `taskkill /T /F /PID`.
Then transition to `cancelled`.

## 3. Data model (`packages/core/src/services/shellJobManager.ts`)

```ts
export type ShellJobState = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ShellJob {
  id: string;                 // stable, e.g. `shell_<12 hex>` — NOT the pid
  command: string;            // the user's command, verbatim
  cwd: string;
  state: ShellJobState;
  startedAt: number;
  endedAt?: number;
  pid: number;                // wrapper pid
  pgid: number;               // process group target for kill
  logPath: string;
  statusPath: string;
  exitCode?: number;
  notifiedAt?: number;
}
```

`ShellJobManager` owns: `launch()` (wrapper build + handshake + register), `get`,
`getByPrefix`, `list`, `cancel`, `tailLog(id, lines)`, the watcher, retention, and
`disposeAll()`. It emits `job-completed` / `job-failed` / `job-cancelled` mirroring
`AsyncTaskManager`'s event names so the reminder/auto-trigger can consume both.

**Separate budget.** Shell jobs do **not** consume `task-max-async` (that setting means
subagent concurrency). New setting `shell-max-background-jobs` (default 10, `-1`
unlimited).

**Retention.** Bounded history like `enforceHistoryLimit`. On eviction, delete the log and
status files. On session end: default **leave the process running** (it was explicitly
detached) but mark the job `unmanaged` in the record and stop watching; a setting can opt
into kill-on-exit.

## 4. Surfacing

### 4.1 Tools interface (`packages/tools/src/interfaces/IAsyncTaskService.ts`)

Already generic (`name?`, `output?: unknown`, 4-state status). Add optional fields:

```ts
kind?: 'subagent' | 'shell';
command?: string;
logPath?: string;
pid?: number;
exitCode?: number;
```

All optional ⇒ no break for subagent tasks.

### 4.2 `CoreAsyncTaskServiceAdapter`

Merge `AsyncTaskManager` + `ShellJobManager` into one `AsyncTaskInfo[]`. Prefix-lookup
searches both; ids are disjoint by construction (`shell_` prefix).

### 4.3 `check_async_tasks`

Renders shell jobs with shell fields. **Peek mode returns the log tail directly** — this
is essential, because `read_file` refuses paths outside the workspace, so without it every
output inspection costs a `run_shell_command`.

### 4.4 `/task list` / `/task end`

Include shell jobs; `end` cancels via `ShellJobManager.cancel`.

### 4.5 Completion notification

`AsyncTaskAutoTrigger` / `AsyncTaskReminderService` subscribe to shell job events too.
`formatCompletionNotification` gains a shell branch:

```json
{ "job_id": "shell_ab12…", "command": "npm run dev", "status": "failed",
  "exit_code": 1, "log_tail": "…last lines…" }
```

## 5. Tool surface

`run_shell_command` keeps `is_background?: boolean`, but it now **creates a managed job**.
The result on a real background launch:

```
Background job started.
Job ID: shell_ab12cd34ef56
Command: npm run dev
Log: /tmp/shell_bg_….log
Check status or output with check_async_tasks; stop it with /task end shell_ab12cd34ef56.
```

No raw `pgrep`/`kill` instructions — the model gets a stable id and a tool.

### The pre-existing `&` path

**Plain `cmd &` routes through the same managed path.** One mechanism, and the promise in
the tool description finally holds. Detection still uses the existing `endsWith('&')`
check, whose known defects (escaped `&`, heredocs, trailing comments) are tracked in
#2980 and are *not* made worse here.

> **OPEN QUESTION for review:** is auto-promoting `cmd &` to a managed job the right call,
> or should plain `&` only get the *protection* (trap + redirect) without registration?
> Auto-promotion is more coherent but is a larger behavioural change to an existing path.

## 6. Windows

`Start-Process powershell -ArgumentList '-NoProfile','-Command',<cmd> -RedirectStandardOutput <log> -RedirectStandardError <err> -PassThru`,
job id from `.Id`, termination via `taskkill /T /F /PID`. Status/exit code needs a
PowerShell equivalent of the status file (`$p.ExitCode` written by a waiter, or
`Register-ObjectEvent`).

> **OPEN QUESTION for review:** the hard part is escaping an arbitrary model-authored
> command into a PowerShell argument array. Does Windows land in this PR, or does the
> manager ship with a Windows provider stub that fails fast (as today) plus a follow-up?

## 7. Test plan (all behavioural; core tests run under **bun test**)

`packages/core/src/services/shellJobManager.test.ts` and
`shellJobManager.integration.test.ts` — real processes, both backends, deterministic
process-group cleanup:

| # | Behaviour |
| - | --- |
| 1 | Fast-exiting command returns a **foreground-shaped** result with the real exit code; no job registered |
| 2 | Fast-*failing* command returns the real non-zero exit code and its stderr — not "started" |
| 3 | Long-running command registers a job in `running` with a stable id ≠ pid |
| 4 | Job survives PTY teardown (`shouldUseNodePty: true`) and keeps writing to the log |
| 5 | Job does not hold the tool's stdio (child_process `close` is prompt; chatty output lands in the log, not `result.output`) |
| 6 | Watcher transitions `running → completed` with the correct exit code when the job ends |
| 7 | Watcher transitions `running → failed` when the group is killed externally without a status file |
| 8 | `cancel()` terminates the whole group and transitions to `cancelled` |
| 9 | `tailLog` returns the last N lines while the job is running |
| 10 | Completion emits an event carrying job id, command, exit code, log tail |
| 11 | Retention evicts oldest terminal jobs and deletes their log/status files |
| 12 | Shell jobs do not consume the subagent async budget |
| 13 | **Plain `cmd &` gets the same protection** — survives PTY teardown (the pre-existing bug, fixed on the documented path) |
| 14 | Windows provider behaviour (or explicit fail-fast, per the open question) |

Adapter/tool/CLI layers get thin mechanical tests only, to keep new vitest to a minimum.

## 8. Increments (all in one PR)

1. `ShellJobManager` + wrapper + handshake + watcher + cancel + retention (core, bun tests).
2. Fix the pre-existing `&` path through the same mechanism.
3. Adapter merge + `IAsyncTaskService` fields + `check_async_tasks` rendering & log tail.
4. Reminder / auto-trigger shell branch.
5. `/task list` / `/task end` support.
6. `run_shell_command` `is_background` → managed job; result text rewritten.
7. Windows (per open question).

## 9. Magnitude

Substantially larger than v1 — new core service with a state machine and a watcher, a
merged task surface across three packages, notification integration, and the Windows
question. Order of a few hundred lines of production code plus a comparable amount of
real-process tests. The v1 wrapper primitives (`trap '' HUP`, redirect, `</dev/null`,
`singleQuoteForShell`) survive; the v1 *contract* (prose notice, raw PGID as handle,
launcher-exit-code semantics) is replaced.

## 10. Guardrails

No `eslint-disable`, no TS suppressions, no threshold increases, no `any`, no type
assertions. Fail fast. New core tests must run under `bun test` (not in
`run-bun-tests.ts`'s EXCLUDE list) and must not use vitest-only APIs.
