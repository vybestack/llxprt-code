# Issue #1995 v3 — Managed background shell jobs (direct-spawn)

Supersedes `plan.md` (v1: flag-only shell wrapper) and `design-v2.md` (v2: status-file
protocol). v2's mechanism was killed in design review before implementation.

## 0. Corrections to earlier claims

- **node-pty is NOT the default backend.** `applyShellFlags` sets
  `shouldUseNodePtyShell = params.shouldUseNodePtyShell ?? false`
  (`packages/core/src/config/configConstructor.ts:417`). The PTY-teardown kill is real but
  only affects users who enable the interactive shell. Earlier statements calling it "the
  default under Bun" were wrong.
- **The child_process pipe claim was overstated.** Plain `cmd &` there returns in ~5 ms and
  the child survives; what lingers is the *`close`* event and the undrained pipe, not a
  broken job. The genuine defect is **backend inconsistency**: the same `cmd &` survives
  under child_process and dies under node-pty.
- **The v2 status-file protocol does not work.** Verified: `set -e; false` writes no status
  file; `exec` replaces the shell so the postlude never runs; a trailing `#` comment or a
  heredoc makes the generated line a syntax error; `cmd & printf …` records the *launch*
  status (recreating the false-success bug); SIGTERM/SIGKILL never runs `printf`; an
  unwritable status target yields no status at all. Dead.

## 1. Mechanism: direct detached spawn

No shell-text protocol. The manager spawns the shell itself and keeps the handle.

```ts
const logFd = fs.openSync(logPath, 'wx', 0o600);   // BEFORE spawn; fail the tool if this throws
const child = cpSpawn(executable, [...argsPrefix, command], {
  cwd, detached: true, shell: false,
  stdio: ['ignore', logFd, logFd],
  env: sanitizedEnv,
});
// attach 'error' and 'exit' listeners IMMEDIATELY, before the job is exposed
// register the job, THEN child.unref()
```

Mirrors the existing shape in `shellExecutionService.ts:82-128` (argument array,
`shell:false`, POSIX `detached`).

Why this beats v2: exit code and signal come from a real `exit` event, so `set -e`,
`exec`, heredocs, trailing comments and signals all work. The spawned shell **is** the
process-group leader, so the pid is a sound `kill -- -pgid` target with no launcher
indirection. No PTY is allocated — a file-backed non-interactive job has no use for one.

**Documented limitation:** authority covers the submitted shell and its ordinary
descendants. A command that `setsid`s or double-forks escapes the group; cancellation
cannot promise to stop it. This is stated in the tool description, not hidden.

## 2. Contract (deterministic — no timing-dependent shape)

`is_background: true` **always** returns a job-shaped result with a stable job id.
Never foreground-shaped. If the process already exited by the time we respond, the same
shape is returned with terminal status, real exit code/signal, and a bounded output tail.

v2's 300 ms handshake is cut: measured status latency under an 80-process launch storm was
p50 ≈ 304 ms / p95 ≈ 539 ms even for `true`, so the window was a load-dependent coin flip
that would make the *result schema* nondeterministic.

`timeout_seconds` bounds **launch only**; a background job's lifetime is unbounded.

## 3. Data model (`packages/core/src/services/shellJobManager.ts`)

Public states: `running | completed | failed | cancelled`.
Internal phases: `starting`, `cancelling`. Exactly-once terminal transition via a single
guarded primitive; `cancelled` wins a race with a simultaneous exit only if cancellation
was accepted first, otherwise `cancel()` returns false.

```ts
interface ShellJob {
  id: string;            // `shell_<hex>` — stable, never the pid
  command: string;
  cwd: string;
  state: ShellJobState;
  startedAt: number; endedAt?: number;
  pid: number;           // the spawned shell = process-group leader
  exitCode?: number; signal?: string;
  failureReason?: string;
  notifiedAt?: number;
}
```

`logPath` and any filesystem path are **manager-internal**. The public API is
`tailOutput(id, { lines, maxBytes })`, resolved by id — never a caller-supplied path.

## 4. Resources, safety, lifecycle

- **Files:** one `mkdtemp` dir per manager at mode `0700`; logs `0600`, opened `wx`
  (exclusive) before spawn. FDs passed to `stdio`, not interpolated paths.
- **Budget:** `shell-max-background-jobs` (default 10, `-1` unlimited), **separate** from
  `task-max-async`. Reserve atomically *before* opening the log/spawning; release on every
  launch failure. Propagated on setting change like `task-max-async`
  (`configBase.ts:215-216`).
- **Log cap:** `shell-background-log-max-bytes` (default 8 MiB). A low-frequency defensive
  poll (not the source of exit truth) fails the job with an explicit reason on exceed.
- **Tail:** read from the end; never load a huge file.
- **Retention:** bounded history + terminal TTL; deleting a job deletes its log. **Never
  evict an unnotified terminal job** (matches `asyncTaskManager.ts:328-360`).
- **Disposal:** `Config.dispose()` terminates running jobs (TERM → bounded wait → KILL),
  reconciles terminal state, removes the temp dir. Session-owned means session-cleaned.
  Config currently has no shell field (`configBaseCore.ts:138-142`) and no shell cleanup
  (`config.ts:940-1006`) — both get wired.

## 5. Surfacing — one namespace, two managers, one facade

`AsyncTaskManager` stays subagent-specific (its input *requires* `subagentName`,
`goalPrompt`, `AbortController`, `OutputObject` — `asyncTaskManager.ts:20-35`). A new core
facade aggregates it with `ShellJobManager`. Ids are disjoint by prefix; prefix lookup
must still detect cross-source ambiguity.

Tools DTO becomes a **discriminated union with a required `kind`**, not optional-field
soup:

```ts
type AsyncWorkInfo = SubagentTaskInfo | ShellJobInfo;   // kind: 'subagent' | 'shell'
```

Known subagent leaks to fix (all verified): `check-async-tasks.ts:41-50` helper names,
`:170-178` always emits `subagentName`/`goalPrompt`, `:228-253` always renders `Goal` and
casts output to `emitted_vars`, `:310-330` error text names `AsyncTaskManager`;
`tasksCommand.ts:41-56` requires `goalPrompt` and `:59-71,108-142,195-230,264-269` use
`agent.tasks` **exclusively** when an Agent exists (so a Config-only manager would be
invisible); `agent.ts:786-806` mandates subagent fields; `tasksControl.ts:30-87` projects
only the subagent manager; `asyncTaskReminderService.ts:19-24,100-132` and
`asyncTaskAutoTrigger.ts:27-35,78-92` bind to one concrete manager.

### Model must be able to cancel

`/task end` is a **human** surface. `check_async_tasks` is list/peek only
(`check-async-tasks.ts:68-81,300-305`). The model therefore gets a `cancel` action on the
model-facing tool (async). Without it, "the model can stop the job" is false.

### Notifications

Reminder/auto-trigger consume both sources. Shell completions are **debounced/coalesced**
with a capped log-tail payload; failures may auto-trigger a turn, ordinary completions can
ride the next turn. Re-check pending notifications after an in-flight trigger
(`asyncTaskAutoTrigger.ts:48-55,100-146` currently drops them).

## 6. The pre-existing `&` path

Plain `cmd &` is auto-promoted to a managed job **using AST recognition**, not
`trimmed.endsWith('&')` (`shell-helpers.ts:282-297`), which misreads `echo '&'`, `&&`, and
`cmd & # comment`. Use the existing tree-sitter Bash parser
(`packages/core/src/utils/shell-parser.ts:121-136`) to confirm the final top-level
construct is an async operator, then strip only that operator and launch the remainder
under the manager. If the parser is unavailable or the parse is ambiguous, **do not
promote** — run normally. This finally makes the promise in `getShellToolDescription()`
true, and identically on both backends.

## 7. Windows

Out of scope for this PR; keep the existing explicit fail-fast (schema omits
`is_background` on win32, validation rejects it). Direct-spawn makes the follow-up clean:
PowerShell executable + command as argument-array elements, pre-opened fds, and
`taskkillTree`/`killProcessWithEscalation` (`shellProcessKill.ts:17-58`) for the tree —
but it needs real Windows CI coverage before the schema exposes it. Tracked in #2981.

## 8. Layering

`ShellJobManager` and the facade live in **core** — because process execution, escalation,
shell config, env sanitisation and Config session ownership already live there and a job
must outlive one tool invocation, shared by CLI, model tools, Agent API and notifications.
*Not* because core runs bun. Presentation stays in its owning package and gets tests
there even though those run vitest; the architecture is not distorted to dodge a runner.

## 9. Build order (one PR, reviewable increments; do not surface before the core is green)

1. `ShellJobManager`: direct spawn, secure files, atomic budget, exactly-once transitions,
   async cancel + escalation, bounded tail, log cap, retention, dispose. **Bun tests.**
2. Config ownership + disposal wiring.
3. Core facade over both managers; discriminated tools DTO.
4. `check_async_tasks`: shell rendering, peek → bounded tail, **cancel action**.
5. `run_shell_command is_background` → managed job; deterministic job-shaped result.
6. AST-based `cmd &` promotion (fixes the documented bug on both backends).
7. Reminder/auto-trigger shell branch with coalescing; `/task` + Agent `tasks` projection.

## 10. Test plan (core = bun test; real processes; zero orphans)

Fast success / fast failure (real exit code, still job-shaped) · spawn `error` · killed by
signal (signal recorded) · cancel race with exit (exactly one terminal transition, one
event) · cancel escalation TERM→KILL · output tail while running · log cap exceeded ·
retention eviction deletes logs but never evicts unnotified · budget exhaustion + atomic
reservation release on launch failure · dispose terminates everything and leaves no
orphans · PTY-enabled `cmd &` regression proving the documented path no longer dies.

## 11. Guardrails

No `eslint-disable`, no TS suppressions, no threshold increases, no `any`, no type
assertions, fail fast. New core tests run under `bun test` and stay out of
`run-bun-tests.ts`'s EXCLUDE list.
