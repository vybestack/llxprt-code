# Plan for #2981 — Windows `is_background` for `run_shell_command` (Start-Process based)

Status: ready for implementation
Owner: issue2981 branch
Related: #1995 (POSIX `is_background`), PR #2956, `project-plans/issue1995/plan.md`

---

## 1. Problem

`is_background` landed POSIX-only in #1995 / PR #2956. On Windows:

- `buildShellSchema()` omits the `is_background` property (`packages/tools/src/tools/shell-helpers.ts`).
- `ShellTool.validateToolParamValues()` rejects `is_background: true` with
  `BACKGROUND_WINDOWS_ERROR` (`packages/tools/src/tools/shell.ts`).

Windows users therefore have no managed background jobs.

---

## 2. Empirical preflight (MEASURED on win32, PowerShell 5.1 + pwsh 7.6.4 present)

These measurements are the factual basis for the design. They were obtained by
running real processes on the target platform. **Do not re-litigate the design
without re-running equivalent probes.**

### 2.1 The POSIX spawn path is structurally broken on Windows

`spawn('powershell.exe', ['-NoProfile','-Command', cmd], { detached: true, stdio: ['ignore', fd, fd] })`

| variant | exit | elapsed | command actually ran? | log |
| --- | --- | --- | --- | --- |
| `powershell.exe` + `detached: true` | 0 | ~110–280 ms | **NO** (marker file never written) | empty |
| `powershell.exe` + `detached` + `windowsHide` | 0 | ~110 ms | **NO** | empty |
| `powershell.exe` + `detached` + `windowsVerbatimArguments: false` | 0 | ~277 ms | **NO** | empty |
| `powershell.exe` + `detached` + `-NonInteractive -InputFormat None` | 0 | ~1072 ms | **NO** | empty |
| `powershell.exe` + `detached` + `-EncodedCommand` | 0 | ~3958 ms | **NO** | empty |
| `powershell.exe` + `detached` + `-File script.ps1` | 0 | ~1114 ms | **NO** | empty |
| `powershell.exe` **attached** (no `detached`) | 3 | ~1179 ms | **YES** | `hello-world\r\n` |
| `cmd.exe /c` + `detached: true` | 3 | ~819 ms | **YES** | `hello-world \r\n` |

Conclusion: `DETACHED_PROCESS` itself is fine (`cmd.exe` works); **`powershell.exe`
specifically refuses to execute when it has no console.** Reusing `spawnDetached()`
on Windows would silently produce zero-output, exit-0 phantom jobs. This is exactly
why the issue mandates `Start-Process`.

Probe gotcha for whoever re-verifies: after `child.unref()`, Node exits before the
`exit` event fires. Probes need a `setInterval` keep-alive.

### 2.2 `Start-Process` + `-EncodedCommand` solves escaping completely

The issue calls out escaping as "the hard part". `-EncodedCommand` takes
**base64 of UTF-16LE**, whose alphabet is `[A-Za-z0-9+/=]` only. There is therefore
**no escaping problem at all** for the model-authored command — it cannot contain a
character that is special to PowerShell, to `-ArgumentList` array joining, or to
`CommandLineToArgvW`.

Verified working (inner command executed correctly, output captured):

| case | command | captured stdout |
| --- | --- | --- |
| single quotes | `Write-Host 'it''s working'` | `it's working` |
| double quotes | `Write-Host "hello world"` | `hello world` |
| mixed + `&` + backslashes | `Write-Host "path: C:\Users\Test & more"; Write-Host 'two'` | `path: C:\Users\Test & more` / `two` |
| `$` expansion + backtick | `$x = 5; Write-Host "val=$x ` + "`" + `$literal"` | `val=5 $literal` |
| pipe | `"a\|b" \| Write-Host` | `a\|b` |
| embedded newlines | `Write-Host 'l1'\nWrite-Host 'l2'` | `l1` / `l2` |
| native exe stdout+stderr | `cmd /c "echo native-out & echo native-err 1>&2"` | out and err split correctly |
| empty output | `"" \| Out-Null` | `` (both logs empty) |

Only the **paths** we inject into the bootstrap need quoting, and those are ours,
not the model's — PowerShell single-quote doubling (`'` → `''`) is sufficient and
correct for them.

### 2.3 Exit-code propagation requires `$null = $p.Handle`

`Start-Process -PassThru` returns a `System.Diagnostics.Process` whose `ExitCode`
is **unavailable** after the process exits unless the native handle was cached first.

| bootstrap | inner `exit` | outer exit code |
| --- | --- | --- |
| without `$null = $p.Handle` | `exit 3` | **0** (WRONG — `$p.ExitCode` was empty) |
| with `$null = $p.Handle` | `exit 3` | **3** |
| with `$null = $p.Handle` | `exit 7` | **7** |
| with `$null = $p.Handle` | `throw 'kaboom'` | **1** |
| with `$null = $p.Handle` | (clean) | **0** |

This one line is load-bearing. A regression here silently reports every failed
background job as `completed`. It must have a dedicated test.

### 2.4 `$ProgressPreference = 'SilentlyContinue'` is required

Without it, PowerShell 5.1 writes a CLIXML *progress* record
(`Preparing modules for first use.`) to the redirected stderr for essentially every
job, polluting the error log. With it, the stderr log is empty for clean runs
(verified: `err=""`).

### 2.5 Stream merging does NOT work — two log files are mandatory

Attempts to collapse stdout+stderr into one file inside the inner command all failed:

| attempt | result |
| --- | --- |
| `& { ... } 2>&1` | error still landed in the **stderr** file |
| `& { ... } *>&1` | error still landed in the **stderr** file |

`Start-Process` also refuses the same path for `-RedirectStandardOutput` and
`-RedirectStandardError`. Therefore Windows jobs have **two** log files, exactly as
the issue anticipated ("stdout and stderr must go to separate files").

### 2.6 PowerShell error records are CLIXML-encoded in the stderr file

With stderr redirected, `powershell.exe` serialises its error stream as CLIXML:

```
#< CLIXML
<Objs Version="1.1.0.1" xmlns="..."><S S="Error">kaboom_x000D__x000A_</S>...</Objs>
```

Native-executable stderr is **plain** (`native-err \r\n`). So the stderr log is a
mix of plain text and CLIXML fragments. Handing this to the model raw is unusable,
so a small deterministic decoder is in scope (§4.5).

### 2.7 Lifecycle semantics verified

| property | result |
| --- | --- |
| `taskkill /F /T /PID <outerPid>` | outer **GONE**, `Start-Process` inner **GONE** — the tree kill reaches the inner process |
| outer exit code after tree kill | `1` |
| job survives the parent Node process exiting | **YES** (marker written 3 s after parent exited) |

Because `taskkill /T` on the outer PID reliably reaps the inner, **the job record's
`pid` can be the outer PowerShell PID**. This keeps `ShellJobManager.launch()`
synchronous (no async PID hand-back) and preserves the existing `ShellJobRecord`
shape and the `exited` Promise contract.

---

## 3. Design decisions (and one deliberate deviation)

### D1 — Outer waiter + `Start-Process` inner

```
spawn(<pwsh>, ['-NoProfile','-NonInteractive','-Command', <bootstrap>],
      { cwd, env, shell: false, stdio: ['ignore','ignore','ignore'] }).unref()
```

Bootstrap (all interpolated values are ours, single-quote escaped):

```powershell
$ProgressPreference = 'SilentlyContinue';
$p = Start-Process -FilePath '<pwsh>' `
      -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','<base64>') `
      -RedirectStandardOutput '<log>' `
      -RedirectStandardError  '<errlog>' `
      -WorkingDirectory '<cwd>' `
      -WindowStyle Hidden -PassThru;
$null = $p.Handle;
$p.WaitForExit();
exit $p.ExitCode
```

Inner encoded payload = `$ProgressPreference = 'SilentlyContinue';\n` + the model's
command, encoded UTF-16LE→base64.

The outer is **attached** (§2.1 forbids `detached`) but `unref()`'d so it never holds
the CLI open, and its stdio is `ignore` so it never holds the parent's pipes. §2.7
confirms it survives parent exit.

### D2 — `record.pid` is the outer PID; cancellation is `taskkill /F /T`

Justified by §2.7. Keeps `launch()` synchronous. `killProcessGroupSafe()`
(`process.kill(-pid, …)`) is POSIX-only and must not be reached on Windows.

### D3 — Two log files, merged at tail time

`ShellJobLogStore` gains a Windows-aware pair. `tailOutput` returns stdout content,
then decoded stderr content when non-empty. Log-cap enforcement sums both files.

### D4 — **Deviation from the issue's acceptance sketch (needs reviewer sign-off)**

The issue asks that the tool result surface the log path and a
`taskkill /T /F /PID <id>` string. That **directly contradicts shipped, passing
tests** from #1995:

- `shell-tool.test.ts` T14 asserts the background result does not contain
  `pgrep`, `kill`, `PGID`, or `.log`.
- T22 asserts the background result references no filesystem path at all
  (no `.log`, no `/tmp/`, no `os.tmpdir()`).

The managed-job contract deliberately hides paths and PIDs and routes the model
through `check_async_tasks`. Re-exposing them on Windows would fork the contract
per-platform and regress T14/T22.

**Resolution:** satisfy the *intent* without breaking the contract.

- The job result stays contract-clean and platform-identical.
- The Windows **tool description** and the **`is_background` parameter description**
  gain the Windows specifics: jobs are launched via `Start-Process`, and a job can
  be terminated with `taskkill /T /F /PID <pid>` (the `pid` is already a public
  field of `ShellJob`), or by `check_async_tasks`.

This gives the model both the capability and the documented termination command
while keeping one result schema. **Flag this explicitly in the PR body** so the
issue author can accept or reject it.

---

## 4. Implementation (test-first; RED before GREEN for every slice)

Vitest is the harness these files already use (`shellJobManager.test.ts`,
`shell-tool.test.ts`); extend them rather than adding new runners. Do not create
new `.js` files.

### 4.1 Schema + validation

Tests first — `packages/tools/src/__tests__/shell-helpers-schema.test.ts`:

- REPLACE `does not expose is_background on Windows` with `exposes is_background on
  Windows`: `type === 'boolean'`, description mentions `check_async_tasks` and
  `job id` (same assertions as the darwin case, so the contract is platform-identical).
- ADD: Windows tool description contains `managed background job`,
  `check_async_tasks`, `Start-Process`, and `taskkill /T /F /PID`.
- ADD: Windows tool description does **not** contain `kill -- -PGID`.

Tests first — `packages/tools/src/__tests__/shell-tool.test.ts`:

- REPLACE T21 (`Windows rejects is_background`) with: on `win32`,
  `tool.build({ command: 'echo started', is_background: true })` **succeeds**.
- KEEP T23 unchanged (standalone execution-service adapter still fails fast with
  `not supported`).
- KEEP T14/T16/T22 unchanged and passing on Windows.

Then implement:

- `shell-helpers.ts` `buildShellSchema()`: drop the `os.platform() !== 'win32'` guard.
- `shell-helpers.ts` `getShellToolDescription()`: extend the win32 branch per D4.
- `shell.ts`: delete `BACKGROUND_WINDOWS_ERROR` and its `validateToolParamValues()`
  branch.
- `shell.ts` `shouldRunAsBackground()`: keep the `os.platform() === 'win32'` early
  return for **trailing-`&` promotion only** (`&` is PowerShell's call operator, not
  a background operator — promotion must stay POSIX-only). Explicit `is_background:
  true` must still be honoured on Windows; verify the existing ordering already does
  this.

### 4.2 Windows spawn path

Tests first — new `packages/core/src/services/shellJobWindowsSpawn.test.ts`
(`describe.skipIf(os.platform() !== 'win32')`), executing the **real** generated
invocation:

- every adversarial case in §2.2 round-trips its output;
- `exit 3` ⇒ job `failed` with `exitCode === 3` (guards the `$p.Handle` fix, §2.3);
- `exit 0` ⇒ `completed`;
- `throw` ⇒ `failed` with `exitCode === 1`;
- clean run leaves the stderr log empty (guards `$ProgressPreference`, §2.4);
- native-exe stderr is captured.

Then implement in `packages/core/src/services/shellJobSpawn.ts`:

- `spawnWindowsBackground(executable, command, cwd, env, logPath, errLogPath): SpawnedProcess`
  returning the same `{ pid, child, exited, onError }` shape.
- Add pure, individually-tested helpers (keep them exported for direct testing):
  - `escapePowerShellSingleQuoted(value: string): string` — `'` → `''`, wrap in `'`.
  - `encodePowerShellCommand(command: string): string` — UTF-16LE → base64.
  - `buildWindowsBackgroundBootstrap({...}): string` — assembles the §D1 script.
- `spawnDetached()` keeps the existing Bun/Node POSIX branches untouched.

### 4.3 Log store pair

- `ShellJobLogStore.openLogPaths(jobId)` → `{ logPath, errLogPath }` for Windows
  (created empty, mode 0600, `wx` semantics preserved). POSIX `openLog()` unchanged.
- `getErrLogPath(jobId)`, and `deleteLog()` removes both.

### 4.4 Manager wiring

Tests first — extend `packages/core/src/services/shellJobManager.test.ts` with a
`describe.skipIf(os.platform() !== 'win32')('ShellJobManager on Windows')` block
mirroring the POSIX suite. Reuse `makeManager` / `waitForTerminal`; **extract the
shared `beforeEach`/`afterEach` into one helper** rather than duplicating it
(RULES.md "DRY setup"). Cover:

- fast success ⇒ `completed`, `exitCode 0`, output in tail;
- fast failure ⇒ `failed`, real non-zero exit code;
- long-running job reaches `running` and its `pid` is alive;
- `cancel()` ⇒ `cancelled`, and the process tree is gone (assert via
  `Get-Process -Id`, not `process.kill(-pid)`);
- a job that spawns a grandchild has the whole tree reaped (`/T`);
- `dispose()` leaves no survivors;
- log-cap breach fails the job.

Then implement in `shellJobManager.ts`:

- `launch()`: branch on `os.platform() === 'win32'` to the new spawn path and the
  log pair; POSIX path byte-for-byte unchanged.
- `sendTermAndEscalate()`: on Windows call `taskkillTree(pid)` and skip the SIGKILL
  timer entirely (`/F` is already forceful; there is no graceful stage).
- `failJobIfOverCap()`: on Windows use `taskkillTree`, and sum both log sizes.
- `ShellJobRecord`: add optional `errLogPath`.

### 4.5 CLIXML decoding for the stderr tail

Tests first (pure-function tests, real CLIXML captured in §2.6):

- `<S S="Error">kaboom_x000D__x000A_</S>` ⇒ `kaboom\r\n`;
- XML entities (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&apos;`) unescape;
- multiple `<S>` records concatenate in order;
- `Warning` / `Verbose` / `Debug` records decode too;
- **plain (non-CLIXML) stderr passes through byte-identical** (native-exe case);
- malformed / truncated CLIXML falls back to the raw text rather than throwing.

Then implement `decodeClixmlStderr(raw: string): string` and use it in
`shellJobTail.ts` when reading the Windows error log. Merged tail shape:
stdout content, then decoded stderr content when non-empty. Respect the existing
`lines` / `maxBytes` bounds across the merged result.

### 4.6 Docs

- `docs/tools/shell.md` (or the equivalent current page): document Windows
  background jobs, the two-log capture, and `taskkill /T /F /PID`.
- `CHANGELOG.md`: note Windows `is_background` support via `Start-Process`.

---

## 5. Hard constraints

- **Do not change POSIX behaviour.** The POSIX branches of `shellJobSpawn.ts`,
  `shellJobManager.ts`, and `shell-helpers.ts` stay as they are.
- **Do not weaken existing tests.** T14, T16, T18, T19, T20, T22, T23 keep passing
  unmodified. Only T21 changes, because its premise (Windows rejects) is what this
  issue removes.
- No `eslint-disable*`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, no new
  `ignores:` blocks, no severity downgrades, no complexity-threshold bumps.
- No `any`, no type assertions; explicit return types.
- No mock theater: every Windows behavioural test drives real processes. The
  litmus test — deleting the implementation must fail the test.
- New files carry a **2026** copyright header.
- Windows-only suites use `describe.skipIf(os.platform() !== 'win32')` so POSIX CI
  stays green; POSIX-only suites keep their existing `skipIf`.

## 6. Verification gate (every slice)

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
