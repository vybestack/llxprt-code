# Issue #1995 — Adopt upstream's `is_background` parameter for the shell tool

## 1. Decision (issue steps 1, 2, 4)

### What upstream gemini-cli does

Upstream's `ShellToolInvocation` accepts `is_background?: boolean` (plus `delay_ms`). When set:

1. The command is spawned normally (PTY or child process).
2. After `BACKGROUND_DELAY_MS` (200 ms, overridable via `delay_ms`), upstream calls
   `ShellExecutionService.background(pid, sessionId, command)`, which **detaches an
   already-running process from the tool call** and hands it to a session-scoped
   background-process registry.
3. The tool `await`s the same delay. If the process has not completed, it returns early
   with `Command is running in background. PID: <pid>. Initial output: …`.
4. Later output is suppressed (`updateOutput` is skipped when `is_background`), the temp
   PID file/dir is deliberately **not** cleaned up, and the user views the process's
   output through a dedicated UI surface (`Ctrl+B`).
5. `result.backgrounded` becomes a first-class field on `ShellExecutionResult`, and the
   result display carries a `BackgroundExecutionData` payload (`pid`, `command`,
   `initialOutput`).

### What LLxprt has today

`ShellExecutionService` has no `background()` method, no background-process registry, no
session ownership of detached processes, and no UI to reattach to one. `ShellTool` wraps
every command as:

```
{ <command> }; __code=$?; pgrep -g 0 ><tempfile> 2>&1; exit $__code;
```

and resolves the result on whichever of the child's `exit` / `close` events fires first
(`registerCpExitHandlers` + the `hasResolved` guard in `createCpResultPromise`).

### Measured behaviour of naive in-shell backgrounding

All of the following were measured against the real backends on macOS, not reasoned about.

**child_process backend** (`spawn('bash', ['-c', built], { stdio: [...,'pipe','pipe'], detached: true })`),
with body `{ { sleep 2; yes X | head -100000; touch S; } & }`:

| observation                | naive `&`         |
| -------------------------- | ----------------- |
| `exit` event               | 38 ms             |
| `close` event              | 2037 ms           |
| job survived               | yes               |
| pgrep captured PIDs        | yes (2)           |

The result promise resolves on `exit`, so the tool *does* return immediately — but the
surviving job inherits LLxprt's stdout/stderr pipes and holds them open for its whole
lifetime. Nothing drains them once `cleanupCpResources` removes the readers, so a chatty
server can fill the pipe buffer and block, and the descriptors are retained.

**node-pty backend** (`@lydell/node-pty`, production teardown = `destroy()` on exit,
via `makePtyResolveResult` → `teardownPtyState` → `cleanupPtyEntryResources` →
`safePtyDestroy`), same body:

| observation                | naive `&`         |
| -------------------------- | ----------------- |
| PTY `onExit`               | 45 ms             |
| sentinel present after 4 s | **false**         |

Closing the PTY master hangs up the slave, and the surviving job — which still has the
PTY as its stdio and controlling terminal — is killed by `SIGHUP`. **Naive `&`
backgrounding does not work at all on the PTY backend.** This is a pre-existing defect of
the trailing-`&` path, but a feature that advertises background execution cannot ship on
top of it.

### Measured behaviour of the adopted wrapping

Body `{ { trap '' HUP; <cmd>; } ><log> 2>&1 </dev/null & }`:

| observation                | child_process | node-pty |
| -------------------------- | ------------- | -------- |
| `exit` / `onExit`          | 31 ms         | 49 ms    |
| `close` event              | **31 ms**     | n/a      |
| job survived teardown      | yes           | **yes**  |
| sentinel created           | yes           | yes      |
| pgrep captured PIDs        | yes (2)       | yes      |
| output captured to log     | 200 000 bytes | yes      |

Three properties, each individually necessary:

- `trap '' HUP` makes the backgrounded subshell (and, through inherited `SIG_IGN`, its
  descendants) survive the `SIGHUP` that PTY teardown delivers.
- `>log 2>&1` releases LLxprt's inherited stdout/stderr pipes immediately (`close` at
  31 ms instead of 2037 ms), eliminating both the descriptor retention and the pipe-full
  deadlock, and gives the model somewhere to read the process's output from.
- `</dev/null` stops the detached job from competing for terminal input.

The spawned shell is `detached: true` and non-interactive (no job control), so the `&`
job stays in the wrapper's own process group — the reported `Process Group PGID` is a
valid `kill -- -PGID` target for the survivor.

### Decision

**Adopt the `is_background` parameter, implemented as protected in-shell job control.
Do NOT port upstream's detached-execution path, background registry, `result.backgrounded`
plumbing, or `delay_ms` race.**

Rationale:

- The thing LLxprt lacks is the **declarative interface** plus a wrapping that actually
  survives. The model must currently know to append `&`; when it does, the job is killed
  outright under node-pty and leaks pipes under child_process.
- Upstream's `background()` path exists to serve a `Ctrl+B` re-attach pane we do not
  have. Porting the mechanism without the UI buys no user-visible capability while
  importing the PTY-lifecycle and orphan-tracking hazards #1401/#1403 were about.
- The `trap`/redirect wrapping solves the ownership problem in the shell, where it
  belongs: after the wrapper exits, LLxprt holds no descriptor and no handle for the
  survivor, and the survivor's output is durably on disk.

**Accepted limitation.** Because the wrapper returns as soon as the job is *launched*,
LLxprt cannot distinguish "still running" from "died immediately". Upstream buys that
distinction with a 200 ms sleep. We do not: instead the notice is only emitted when the
wrapper itself succeeded, and it names the log file so the model can verify. This is
recorded deliberately, not overlooked.

**Async-task infrastructure (issue step 4):** `AsyncTaskManager` /
`AsyncTaskReminderService` / `AsyncTaskAutoTrigger` track *subagent* runs launched via
`task`, keyed by agent id. They have no process, PID, or process-group concept. A
backgrounded shell job is not an async task and must not be registered as one — no
interaction, no change.

**PTY resource protections (issue step 4):** unchanged. `is_background` adds no spawn
path, keeps no PTY entry alive past exit, and does not touch `activePtys` bookkeeping.
The surviving job is made independent of the PTY by the shell, not by weakening cleanup.

## 2. Accepted behaviour (acceptance criteria)

### AC-1 — Parameter exists

`ShellToolParams` gains `is_background?: boolean`. On non-Windows the
`run_shell_command` JSON schema exposes `is_background` as an optional boolean whose
description tells the model to use it for long-running processes instead of appending
`&`, and states that output goes to a log file rather than the tool result.

### AC-2 — POSIX wrapping detaches, protects, and redirects

On non-Windows, with `is_background: true`, the executed string is exactly:

```
{ { trap '' HUP; npm run dev; } >'<log>' 2>&1 </dev/null & }; __code=$?; pgrep -g 0 ><tmp> 2>&1; exit $__code;
```

`<log>` is a tool-generated path in `os.tmpdir()` (`shell_bg_<hex>.log`, same generation
scheme as the existing pgrep temp file, so it contains no shell metacharacters). The path
is single-quoted with POSIX escaping so that a `TMPDIR` containing spaces or shell
metacharacters does not corrupt the redirection.

### AC-3 — Returns without waiting for the job, on both backends

- Through `ShellExecutionService.execute(..., shouldUseNodePty: true)`: the returned
  result resolves while the job is still running, **and the job is still alive
  afterwards** (proved by a sentinel the job creates only after a delay, checked after
  the service has torn the PTY down).
- Through `ShellExecutionService.execute(..., shouldUseNodePty: false)`: same, and the
  child's stdout/stderr are released promptly rather than being held for the job's
  lifetime.

### AC-4 — Explicit `&` is not double-backgrounded

If the trimmed command already ends with `&`, `is_background: true` still applies the
protective group (`{ trap '' HUP; <cmd> & } >'<log>' 2>&1 </dev/null &`) but adds no second
`&` and no `;` after the existing `&`. `is_background: false` with a trailing `&` is
unchanged from today.

### AC-5 — Trailing `;` never produces `;;`

`buildCommandToExecute('echo hi;', …)` must not emit `{ echo hi;; }`, which is a bash
syntax error (`exit 2`). This holds for both the background and non-background paths.
This is a precondition of the shared body-building helper introduced for AC-2, not an
independent cleanup.

### AC-6 — Default path is unchanged

With `is_background` absent or `false`, `buildCommandToExecute` returns exactly what it
returns today for every command that does not end in `;` (see AC-5), no log file is
created, and the tool result format is byte-identical to today's.

### AC-7 — Windows rejects the parameter

On Windows the schema does not advertise `is_background`, and passing
`is_background: true` fails parameter validation with a message directing the model to
`Start-Process`. `is_background` absent or `false` on Windows behaves exactly as today.

### AC-8 — Background launches are reported honestly

For a background launch **whose wrapper exited cleanly** (`exitCode === 0`, no `error`,
no `signal`):

- `llmContent` keeps the existing `Command:`/`Directory:`/`Stdout:`/`Error:`/`Exit Code:`/
  `Signal:`/`Background PIDs:`/`Process Group PGID:` block and appends a multi-line notice:
  - Line 1 (always): `Background: command was started in the background and was not awaited.`
  - Line 2 (always): `Output: <logpath> (outside the workspace - read it with a shell command such as: tail -n 50 '<quoted-logpath>')` — the log path prefix is unquoted (human-readable); the path inside the `tail` hint is single-quoted via the shared `singleQuoteForShell` helper.
  - Lines 3 and 4 (only when a terminate id — `pgid ?? result.pid` — is available): `Status: pgrep -g <id>` and `Terminate: kill -- -<id>`.
- The log file lives in `os.tmpdir()`, deliberately **outside the workspace**, so it is
  **not reachable by workspace-scoped file-reading tools** (e.g. `read_file`); it must be
  read with a shell command (`cat`, `tail`). The notice makes this explicit.
- Non-debug `returnDisplay` reports the background start and the process group.

For a background launch whose wrapper did **not** exit cleanly (spawn error, non-zero
exit, or signal), no background notice is emitted and the normal failure formatting
applies unchanged — the tool must never claim a process started when it did not.

The log file is **not** unlinked by the tool; only the pgrep temp file is.

### AC-9 — Background intent is disclosed at confirmation time

`ToolExecuteConfirmationDetails` gains an optional `isBackground?: boolean`.
`ShellToolInvocation.shouldConfirmExecute()` sets it when `is_background` is true, and
the CLI exec-confirmation body renders a note when it is set, following the existing
`containsRedirection` warning pattern (including its available-height accounting).
`getDescription()` also appends ` [background]`. Absent the flag, the confirmation is
byte-identical to today's.

### AC-10 — Aborted/cancelled behaviour unchanged

`is_background` does not alter the cancellation or timeout branches of
`formatOutputContent` / `buildExecutionError`.

## 3. Out of scope (explicitly rejected)

- `ShellExecutionService.background()`, a background-process registry, session ownership
  of detached processes, `result.backgrounded`, `BackgroundExecutionData`.
- A `Ctrl+B` / background-output UI surface, or log tailing/streaming.
- Upstream's `delay_ms` parameter and the 200 ms "did it finish quickly?" race.
- Any change to `AsyncTaskManager` or the subagent async-task surface.
- Any change to PTY lifecycle, `activePtys`, or the pgrep/temp-file protocol beyond the
  new flag and the new log-file path.
- Rewriting the wrapper to upstream's newline/`trap 'jobs -p'` form.

**Deferred, pre-existing defects** — file a follow-up issue, do not fix here:

- `buildCommandToExecute` decides "already backgrounded" with `trimmed.endsWith('&')`,
  which misfires on an escaped terminal ampersand (`printf foo\&` is valid bash but the
  wrapper emits a syntax error), and the single-line `{ … }` wrapper is also broken today
  for trailing `#` comments and heredocs. All three predate this change and affect the
  foreground path identically.
- `tempFilePath` is interpolated unquoted into `pgrep -g 0 >${tempFilePath}`, so a `TMPDIR`
  containing spaces or shell metacharacters breaks the redirect. This predates #1995 and
  affects the foreground path; quoting it would change the foreground wrapper output that
  AC-6 pins as byte-identical, so it is deferred rather than fixed here. (The newly
  introduced `backgroundLogPath` IS quoted.)
- The bare-`IShellExecutionService` adapter (`createShellToolHostFromExecutionService`)
  unwraps the wrapper before delegating, dropping the `pgrep -g 0` suffix, and hardcodes
  `pid: undefined`. Background PIDs and PGID are therefore unavailable on that embedding
  path — a pre-existing limitation that already applied to trailing-`&` backgrounding. The
  tool omits the PGID clause instead of printing a meaningless one.
- Because node-pty reports `signal: 0` for a clean exit and `CoreShellToolHostAdapter`
  stringifies that to `'0'`, `formatNormalOutput` already emits `Signal: 0` instead of
  `Signal: (none)` in `llmContent`, and for an empty-output command it already sets
  `returnDisplay` to `Command terminated by signal: 0`, on the node-pty backend. This
  predates issue #1995, affects the foreground path identically, and is deliberately not
  fixed here (fixing it requires normalising signal 0 globally, which is out of scope).

## 4. Test plan (behavioural, written first)

All tests assert observable behaviour: the string handed to the shell, real process
survival through the real execution service, the advertised schema, validation outcomes,
confirmation details, and `ToolResult` content. No assertions on call counts. No test may
leave an orphaned process behind.

### 4.1 `packages/tools/src/__tests__/shell-helpers-schema.test.ts`

| #  | Test                                                                                              | Covers |
| -- | ------------------------------------------------------------------------------------------------- | ------ |
| T1 | POSIX + `is_background: true` produces the exact AC-2 string (log path substituted)                | AC-2   |
| T2 | POSIX + `is_background: false` produces today's string and no log path                             | AC-6   |
| T3 | POSIX, command ends with `&`, background: protective group applied, no second `&`, no `;` after `&`| AC-4   |
| T4 | POSIX, command ends with `&`, foreground: unchanged from today                                     | AC-4/6 |
| T5 | POSIX, command ends with `;`, non-background: `{ echo hi; }`, no `;;`                               | AC-5   |
| T6 | POSIX, command ends with `;`, background: no `;;` inside the protective group                       | AC-5   |
| T7 | Windows returns the command unchanged for both flag values                                         | AC-7   |
| T8 | Non-Windows schema exposes `is_background` as `{ type: 'boolean' }` with a description mentioning background and the log file | AC-1 |
| T9 | Windows schema has no `is_background` property                                                     | AC-7   |

Must not use type assertions — use the file's existing `getObjectProperty` helper.

### 4.2 `packages/core/src/services/shellExecutionService.background.test.ts` (new)

POSIX-only. Drives the **real** `ShellExecutionService.execute()` so both production
backends are exercised. Each test must deterministically clean up its own process group
(`process.kill(-pgid, 'SIGKILL')` in a `finally`/`afterEach`) and must not leave the
sentinel job running past the test.

| #   | Test                                                                                                                     | Covers |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------ |
| T10 | `shouldUseNodePty: true`: the result resolves promptly and the backgrounded job is **still alive** afterwards (sentinel appears after the result, log file receives the job's output) | AC-3 |
| T11 | `shouldUseNodePty: false`: same survival guarantee                                                                        | AC-3   |
| T12 | `shouldUseNodePty: false`: a chatty background job does not hold the tool's streams — the result resolves and the job's output lands in the log file, not in `result.output` | AC-3 |
| T13 | Foreground (non-background) wrapping of the same command resolves only after the job has finished                          | AC-3 contrast |

If `getPty()` yields no implementation in the environment, T10 must skip explicitly
rather than silently pass through the fallback.

### 4.3 `packages/tools/src/__tests__/shell-tool.test.ts`

| #   | Test                                                                                                    | Covers |
| --- | ------------------------------------------------------------------------------------------------------- | ------ |
| T14 | Successful background launch: `llmContent` ends with the notice, and the notice names the log path and `kill -- -<PGID>` | AC-8 |
| T15 | Successful background launch: non-debug `returnDisplay` reports the background start and PGID             | AC-8   |
| T16 | Background launch whose wrapper exited non-zero: **no** notice, normal failure formatting                  | AC-8   |
| T17 | Background launch whose wrapper reported an error: **no** notice                                           | AC-8   |
| T18 | `is_background` absent: no notice anywhere in `llmContent`                                                 | AC-6   |
| T19 | `getDescription()` ends with ` [background]` when set, and does not when absent                             | AC-9   |
| T20 | `shouldConfirmExecute()` returns exec details with `isBackground === true` when set, and without the flag when absent | AC-9 |
| T21 | Windows: building with `is_background: true` returns a validation error naming `Start-Process`               | AC-7   |
| T22 | User-cancelled background invocation keeps the existing cancellation `llmContent`, no notice                 | AC-10  |

### 4.4 `packages/cli/src/ui/components/messages/ToolConfirmationMessage.test.tsx`

| #   | Test                                                                          | Covers |
| --- | ----------------------------------------------------------------------------- | ------ |
| T23 | Exec confirmation with `isBackground: true` renders the background note        | AC-9   |
| T24 | Exec confirmation without the flag renders no background note (unchanged)      | AC-9   |

## 5. Implementation outline

- `packages/tools/src/tools/shell-helpers.ts`
  - `buildCommandToExecute(strippedCommand, isWindows, tempFilePath, backgroundLogPath?)`
    — a defined `backgroundLogPath` selects the background wrapping. Keep the argument
    list within `max-params`; if it would exceed the limit, take an options object.
  - Body builder: foreground keeps today's `<cmd>;` / verbatim-`&` behaviour with the
    trailing-`;` normalisation; background emits
    `{ trap '' HUP; <cmd>; } ><log> 2>&1 </dev/null &` (or `{ trap '' HUP; <cmd> & } …`
    when the command already ends with `&`).
  - `prepareShellExecution(strippedCommand, isBackground)` generates the log path when
    backgrounding and returns it alongside `tempFilePath` / `commandToExecute`.
  - `getBackgroundParamDescription()` for the schema text.
- `packages/tools/src/tools/shell.ts`
  - `ShellToolParams.is_background?: boolean`; schema property only on non-Windows;
    `validateToolParamValues` rejects `true` on Windows; `getDescription()` appends
    ` [background]`; `shouldConfirmExecute` sets `isBackground`; `executeShell` threads
    the flag and the log path; the background notice is applied only in the non-aborted,
    clean-exit branch.
- `packages/tools/src/tools/tools.ts` — `ToolExecuteConfirmationDetails.isBackground?: boolean`.
- `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx` — render the note
  when `isBackground`, mirroring the `containsRedirection` warning including its height
  accounting.
- `CHANGELOG.md`: one `### Added` bullet under `[Unreleased]`.

## 6. Guardrails

- No new `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`.
- No loosening of complexity/size thresholds — extract helpers instead.
- No `any`, **no type assertions** (including in tests); explicit return types.
- No explanatory `AC-n` comments in production code — the tests are the specification.
- Fail fast; no speculative guards or swallowed errors.
- Verification gate: `npm run test`, `npm run lint`, `npm run typecheck`,
  `npm run format`, `npm run build`, plus the profile smoke test. All five must be clean
  on this branch — `main` is currently clean for lint and typecheck, so any failure is
  ours.

## 7. Review log

- **Round 1 (deepthinker).** Blocker: naive `{ cmd & }` is killed by PTY teardown —
  confirmed empirically (sentinel absent after 4 s under `@lydell/node-pty`). Major:
  abandoned stdout/stderr pipes on the child_process path — confirmed (`close` at
  2037 ms). Major: background success reported even when the wrapper failed. Major:
  confirmation messaging never reached `shouldConfirmExecute`. Major: tests never
  exercised either production backend and leaked a process. Minor: prohibited type
  assertion in a test. All accepted and folded into AC-2/3/4/8/9 and §4 above.
  Minor finding on `endsWith('&')` versus escaped ampersands, plus the pre-existing
  heredoc/trailing-comment wrapper defects, deferred to a follow-up issue (§3).
- **Round 2 (Open Code Review).** Applied the following fixes:
  - **F1** — `backgroundLogPath` is now single-quoted with POSIX escaping in both
    background branches of `buildWrappedBody`, so a `TMPDIR` containing spaces or shell
    metacharacters no longer corrupts the redirection.
  - **F2** — `prepareShellExecution` no longer computes `backgroundLogPath` on Windows,
    where `buildCommandToExecute` returns early and the path can never be used.
  - **F3** — `applyBackgroundNotice` now uses the noticed `llmContent` for the debug-mode
    display (it was reusing the pre-notice copy).
  - **F4** — the non-debug background `returnDisplay` no longer prints a meaningless
    `PGID: (none)`; when neither a pgid nor a pid is available the PGID parenthetical is
    omitted entirely.
  - **F5** — T10 and T11 reordered to `echo done; touch ${sentinel}` so the sentinel's
    existence guarantees the echo already happened (real race fix).
  - **F6** — T13 now registers its foreground pid for the `afterEach` process-group kill
    via a shared `registerPid` helper, preventing orphaned processes on timeout/failure.
  - **F7** — T17 now also asserts `Exit Code: 127` and the stderr text, matching T16.
  - **F8** — removed every redundant per-test `darwin` platform mock in the `is_background`
    describe block (the `beforeEach` already sets it); only the `win32` override remains.
  - **F9** — deleted the duplicate `mockConfig` in the `exec confirmation background note`
    describe block, using the file-level one already in scope.
  - REJECTED: "`is_background` combined with a trailing `&` double-backgrounds and puts
    the job in a separate process group." Measured against real bash: for
    `{ trap '' HUP; sleep 5 & } >log 2>&1 </dev/null &`, the surviving `sleep` was captured
    by `pgrep -g 0` AND was still in the wrapper's process group 1.5 s later (bash -c is
    non-interactive, so there is no job control and `&` does not create a new process
    group). The reviewer's process-group claim is factually wrong, and stripping a
    user-supplied `&` would silently rewrite their command.
  - REJECTED: "background log files are never reclaimed." Deleting the log would truncate
    a still-running job's output, and a log lifecycle/registry service is explicitly out
    of scope for this issue (§3). The files live in `os.tmpdir()` and are reclaimed by
    the platform's temp cleanup. Recorded as an accepted, documented limitation.

- **Round 3 (PR #2956 CI review).** Applied the following fixes:
  - **G1 applied.** Background logs are now reclaimed when the launch failed; retained
    on success by design (the detached job is still writing and the model has been told
    the path). The inline background-success predicate was extracted into
    `isCleanBackgroundLaunch(result, backgroundLogPath)` (called from
    `applyBackgroundNotice`), and `executeShell` now unlinks `backgroundLogPath` when it
    is defined and the launch was not clean (including the aborted/cancelled case).
  - **G2 applied.** Removed the duplicated spacer when both confirmation warnings render:
    `buildBackgroundNote` now omits its leading `<Box height={1} />` (and drops its
    reported height by one) when a preceding warning was already rendered, so a
    redirecting-and-background command shows a single blank line before the warning block
    and no blank line between the two notes.
  - REJECTED, with evidence: the claim that `WRAPPED_PREFIX` and `WRAPPED_SUFFIX` in
    `packages/tools/src/tools/shell-helpers.ts` are unused dead constants. They are both
    read by `unwrapCommandForExecutionService` (lines 67, 74 and 78), which is itself
    called from `createShellToolHostFromExecutionService` (line 120). The finding is
    factually incorrect and no change is warranted.

- **Round 4 (PR #2956 second CI review).** Applied the following fixes:
  - **H1 applied.** Both temp-file deletions in `executeShell` now use
    `fs.rmSync(path, { force: true })`, closing the TOCTOU window between
    `existsSync` and `unlinkSync`, and ensuring a cleanup failure can never replace the
    command's actual result from the `finally` block. This covers both the pre-existing
    `tempFilePath` deletion in the `finally` and the new `backgroundLogPath` deletion in
    `reclaimBackgroundLogIfNeeded`.
  - **H2 applied.** The background test now verifies a pid is its own process-group
    leader before issuing a negative-pid SIGKILL (via `spawnSync('ps', ['-o', 'pgid=',
    '-p', pid])`), falling back to a single-pid kill when the pgid does not strictly
    equal the pid, so a node-pty change can never make the test signal the runner's own
    group.
  - REJECTED: "T14/T15/T15b use a fake whose result omits `signal`, `error` and `pid`,
    so they assert implementation-specific formatting of missing fields." Factually
    incorrect about the type: those tests fake `IShellExecutionService`, whose
    `ShellResult` is `{ stdout, stderr, exitCode, aborted }` and has no `signal`/`error`/
    `pid` members to omit — `createShellToolHostFromExecutionService` synthesises them.
    The `Background PIDs:` and `Process Group PGID:` labels are unconditional parts of
    the tool's documented output contract (they are listed in
    `getShellToolDescription()`'s "The following information is returned" block), so
    asserting them is asserting the contract, not incidental formatting. The
    complete-shape case with a real `pid` is already covered by T25, which fakes the full
    `IShellToolHost` and asserts the `kill -- -<PGID>` clause.
  - REJECTED: "`echo hi;;` still produces `;;`; strip all trailing semicolons."
    `echo hi;;` is not valid bash input in the first place (`bash -c 'echo hi;;'` exits 2
    with a syntax error), and no valid command ends in `;;` — a `case` arm's `;;` is
    always followed by `esac`. AC-5 requires only that a VALID command ending in a single
    `;` not be corrupted into `;;`. Silently rewriting a malformed command to make it run
    would violate the project's fail-fast preference.
  - REJECTED: "`is_background` with a trailing `&` nests backgrounding and gives the job a
    different PGID than expected." Rejected on measured evidence (already recorded in
    Round 2): for `{ trap '' HUP; sleep 5 & } >log 2>&1 </dev/null &` the surviving
    `sleep` was captured by `pgrep -g 0` AND was still in the wrapper's own process group
    1.5 s later, because `bash -c` is non-interactive and `&` therefore does not create a
    new process group. The inner subshell exits immediately, so no lasting extra process
    remains. Stripping a user-supplied `&` would silently rewrite their command. The
    interaction is already documented in AC-4 and in the `is_background` schema
    description ("use this for long-running processes instead of appending & to the
    command").

- **Round 5 (PR #2956 CodeRabbit).** One finding, rejected on measured evidence:
  - REJECTED: "Do not emit a process-group termination command for `bun-pty`;
    `Bun.Terminal` does not create a new session or process group, so the reported PGID
    may be inherited." Taken seriously, because `bun-pty` is the default PTY backend
    under Bun and `shellPtyLifecycle.ts:73,87` does set
    `supportsProcessGroupKill: ptyInfo.name !== 'bun-pty'`. Measured instead of assumed.
    A `Bun.Terminal` child is its own process-group leader (child pid 31658, pgid 31658;
    llxprt's own pgid 31654 — not shared). End-to-end through `Bun.spawn({ terminal })`
    with the exact production background wrapper: wrapper pid 32262 exited, the surviving
    job (pids 32263 and 32265) remained in process group 32262, `kill -- -32262`
    succeeded, all survivors were gone afterwards, and the job's completion sentinel was
    never created. So the emitted `kill -- -<PGID>` command is correct on `bun-pty`; the
    other two backends were already guaranteed (`detached: !isWindows` for
    `childProcessFallback`, forkpty/setsid for `@lydell/node-pty`).
    `supportsProcessGroupKill` gates llxprt's *own* in-process `process.kill(-pid)` during
    PTY teardown and abort (`shellExecutionService.ts:253,271`), which is a different
    question from what PGID is reported to the user. The     `Process Group PGID:` line is
    also pre-existing and unchanged here — this PR only adds the human-readable hint next
    to it. Propagating a backend-capability flag into the tool layer would require a new
    field on `ShellExecutionResult` and `IShellToolHost` across two packages, which is not
    warranted given the measurements.

- **Round 6 (post-review usability fix).** The background log lives in `os.tmpdir()`,
  outside the workspace, so the `read_file` tool rejects it (verified:
  `read_file /var/folders/.../T/shell_bg_probe_test.log` → "File path must be within one
  of the workspace directories"). The old single-line notice ("Its output is being written
  to <path>") invited the model to reach for a file-reading tool and fail on the very first
  follow-up step of the feature's primary workflow, and it never told the model how to
  check whether the job was still alive. Fixed by replacing the single-line notice with a
  multi-line block: `Output:` names the log path and gives a `tail -n 50 '<quoted-path>'`
  hint; `Status: pgrep -g <id>` and `Terminate: kill -- -<id>` are added when a terminate
  id is available (`pgid ?? result.pid`). The `tail` hint reuses the existing
  `singleQuoteForShell` helper (exported from shell-helpers.ts and imported into shell.ts)
  as the single source of truth for shell quoting. `getBackgroundParamDescription()` was
  updated with one added sentence telling the model the log file is outside the workspace
  and must be read with a shell command rather than a file-reading tool. This closes the
  gap where the feature's primary follow-up step (reading the output) would fail on first
  attempt.
