# Shell Tool (`run_shell_command`)

The `run_shell_command` tool executes a shell command and returns the output,
exit code, and process information.

## Platform Behavior

| Platform | Shell                                   | Invocation                      |
| -------- | --------------------------------------- | ------------------------------- |
| Windows  | PowerShell (`powershell.exe` or `pwsh`) | `-NoProfile -Command <command>` |
| POSIX    | Bash                                    | `bash -c <command>`             |

On Windows, quote paths containing spaces with single quotes (for example,
`New-Item -ItemType Directory -Force -Path 'C:\My Folder'`) and represent an
apostrophe inside a single-quoted path with two single quotes.

## Background Jobs (`is_background`)

When `is_background` is `true`, the command is launched as a **managed
background job** and the tool returns immediately with a stable job id.
The command output is **not** returned inline. Use
[`check_async_tasks`](./index.md#agents-and-tasks) (`action: 'list'`,
`'peek'`, or `'cancel'`) or the `/task list` / `/task end <id>` slash commands
to inspect output or cancel a running job.

The `timeout_seconds` parameter is **not** applied to background jobs at all —
neither to the launch nor to the job's lifetime. A background job may run
indefinitely, but may be cancelled (via `check_async_tasks` `action: 'cancel'`)
or forcibly terminated by lifecycle management (`dispose`) or log-cap
enforcement.

### POSIX Details

On POSIX, a trailing `&` in the command is detected via AST parsing and
automatically promoted to a managed job. The job runs in its own process group.
Cancellation targets the group with SIGTERM, escalating to SIGKILL after a
short grace period.

### Windows Details

On Windows, background jobs are launched via PowerShell `Start-Process`:

- The model's command is passed as an `-EncodedCommand` (base64 of UTF-16LE),
  which eliminates all quoting and escaping concerns.
- `$ProgressPreference = 'SilentlyContinue'` is prepended to suppress progress
  records that would otherwise pollute the output.
- Stdout and stderr are written to **two separate log files**.
- Exit-code propagation relies on caching the process handle before waiting
  (`$null = $p.Handle` → `$p.WaitForExit()` → `$p.ExitCode`).

On an ordinary Windows session, a background job keeps running after the LLxprt
process that started it exits. That is not guaranteed in every environment: when
LLxprt runs inside a Windows job object that terminates its processes when the
job closes, the background job is torn down along with LLxprt. This has been
observed on GitHub Actions Windows runners. Treat survival past the LLxprt
process as environment dependent rather than as a guarantee.

To **cancel** a Windows background job, use `check_async_tasks` with
`action: 'cancel'`, or `taskkill /T /F /PID <pid>` from a shell (the `pid` is
available from `check_async_tasks` with `action: 'peek'`). The `/T` flag ensures
the entire process tree is reaped.

CLIXML-encoded error records in the stderr log are decoded automatically for
readable display.

### Settings

| Setting                          | Default | Description                                      |
| -------------------------------- | ------- | ------------------------------------------------ |
| `shell-max-background-jobs`      | 10      | Maximum concurrent background jobs.              |
| `shell-background-log-max-bytes` | 8 MiB   | Maximum log output per job before forced cancel. |

## Related

- [Tools Overview](./index.md)
- [Sandboxing](../sandbox.md) — running in a container
- [Settings](../settings-and-profiles.md) — configuring tool behavior
