# Issue #3126 — Esc during shell exec can kill llxprt and its parent supervisor

Pressing <kbd>Esc</kbd> to cancel an in-flight shell tool call can terminate
llxprt itself and its parent supervisor (`jefe`), returning the user to the OS
shell. The cancel path funnels a raw, unvalidated pid into
`process.kill(-pid, signal)`.

POSIX `kill(2)` overloads its pid argument: `pid > 0` targets one process,
`pid == 0` targets **every process in the caller's own process group**,
`pid == -1` targets every process the caller may signal, and `pid < -1` targets
group `|pid|`. Because the code computes `process.kill(-pid, ...)`, a `pid` of
`0` collapses to `kill(0, sig)` — llxprt signalling its own process group. When
llxprt shares a process group with its supervisor (a `jefe`-launched child, or a
tmux pane), that one call reaps llxprt, `jefe`, and the pane shell together.

## Scope

Enforce a single invariant at every process-kill boundary in `packages/core`:

> **A non-positive or non-finite pid is never passed to `process.kill` or
> `taskkill`.**

Product changes are limited to pid validation at those boundaries, removal of
the ambiguous `-1` spawn sentinel that feeds them, and identity-based guarding
on the foreground kill paths. Spawn options are explicitly **out of scope** —
`detached: !isWindows` is already correct (POSIX children get their own group
via setsid; Windows children are descendants so `taskkill /T` walks downward
only), and `shellJobSpawn.ts` documents that `detached: true` breaks the Windows
PowerShell strategy.

Hard constraint carried into every fix: **no test may be neutered to pass.** No
deleted assertions, no matchers broadened until they cannot fail, and no
platform skips except where the production code under test is itself
platform-gated, with the gate mirroring the production one.

### Sandbox kill sites: assessed, deliberately excluded

A repo-wide sweep for `process.kill(-` found four further group-kill sites
outside the shell services: `sandbox-containers.ts` (`-sandboxPid`) and
`sandbox-seatbelt.ts` (`-proxyPid` twice, and `-pid`). They are **knowingly left
alone**:

- They are not on the Esc/cancel path, so they are not this issue's defect.
- Their pids come from `spawn` handles held in a narrow local lifecycle scope,
  not from the `-1` sentinel that made the shell paths dangerous.
- Touching sandbox teardown would need its own behavioral tests against real
  container and seatbelt lifecycles, which is a materially different change.

Two further kill sites outside the shell services are likewise untouched:
`packages/lsp/src/service/process-termination.ts` (`runTaskkill`) and
`packages/auth/src/lock-owner.ts` (`process.kill(pid, signal)`). Neither is on
the Esc/cancel path, and neither takes a negated pid, so neither can signal the
caller's own process group.

Recorded here so reviewers can see the sites were examined rather than missed.
Worth a follow-up issue applying the same `isKillablePid` chokepoint there.

## Defects

All confirmed present on `main` @ `a805a219f`.

| # | Location | Defect |
| --- | --- | --- |
| 1 | `shellJobInternal.ts` `killProcessGroupSafe` | The central defect. No validation at all before `process.kill(-pid, signal)`. Reached from `ShellJobManager.sendTermAndEscalate` and `failJobIfOverCapSync`. |
| 2 | `shellProcessKill.ts` `escalateKillUnix` | No validation before `process.kill(-pid, 'SIGTERM')` / `'SIGKILL'`. |
| 3 | `shellExecutionService.ts` `terminatePty` | No `pid <= 0` guard **and** no `isWindows` branch, unlike `ptyAbortAction`. Currently has no production callers — a latent public-API landmine. |
| 4 | `shellPtyLifecycle.ts` `ptyAbortAction` / `ptyInactivityAbortAction` | Guard only `pid === 0`, not `<= 0` and not `NaN`, so a non-finite pid reaches the escalation calls. |
| 5 | `shellProcessKill.ts` `taskkillTree` / `boundedTaskkill` | No validation before `taskkill /pid <pid> /f /t`. |
| 6 | `shellJobSpawn.ts:168`, `:206`, `:333` | `pid: -1` and `pid: child.pid ?? -1` encode "no pid" as a number that flows straight into the kill primitives, producing `process.kill(1)` — a signal aimed at init. |

Already-guarded, for contrast: `cpKillOnAbort` (`shellCpExecution.ts`) checks
`pid !== undefined && pid !== 0`, and the Windows branch of
`sendTermAndEscalate` gates on `childIsRunning(record.child)`. The same
hardening was never propagated to the shared primitives those callers invoke.

## Trigger path

`Esc` → `handleEscapeKeypress` (`useAgentStreamLifecycle.ts`, registered with
`isActive: true`, so it fires even while shell input is focused) →
`cancelOngoingRequest()` → `abortControllerRef.current?.abort()` +
`cancelAllToolCalls()` → the per-execution abort handlers → the unguarded kill
primitives.

Ruled out: no `process.exit` and no unhandled rejection is reachable from the
cancel path. The termination is genuinely signal-driven.

## Platform reality

- **POSIX** — the lethal path. `kill(0)` on a shared process group reproduces
  the report exactly.
- **Windows** — `taskkill /T` walks the process tree *downward only*. llxprt is
  the parent of the shell child and `jefe` is an ancestor, so under a **valid**
  pid neither is in the tree. Invalid pids are rejected by `taskkill` with an
  error rather than causing harm. Two narrower Windows defects remain real: the
  **foreground** kill paths target a bare numeric pid with no pid validation,
  so a non-killable pid can reach the kill primitive (stale/reused pids are
  already covered there by `exitedGuard` — see fix step 5); and
  `supportsProcessGroupKill` is computed as `ptyInfo.name !== 'bun-pty'`, which
  is `true` on Windows where POSIX process groups do not exist — harmless only
  because every Windows branch checks `isWindows` first, **except**
  `terminatePty`.
- **Multiplexer** — not the mechanism, but it sets the blast radius. tmux places
  each pane's foreground process in its own process group; if `jefe` launches
  llxprt in that pane without llxprt creating a new session, the two share a
  group and `kill(0)` reaps both. There is no multiplexer-aware logic in the
  kill paths, and none is being added — correct pid validation makes the
  question moot.

## TDD plan

Red first: every test below must fail against current `main` for the stated
reason before any production line changes.

### 1. `shellProcessKill.test.ts` (new)

No test file exists for this module today. Behavioral, real processes, no mocks.

- `escalateKillUnix` with pid `0`, `-1`, `NaN`, `Infinity`: the calling process
  must survive. Assert `process.kill(process.pid, 0)` still succeeds afterward,
  and that a real sibling child spawned into the caller's own process group is
  **still alive** — this is the assertion that actually catches `kill(0)`.
  POSIX-gated, mirroring the production gate.
- `escalateKillUnix` with a valid pid of a real detached child: the child's
  group dies (unchanged behavior — proves the guard did not break the feature).
- `taskkillTree` / `boundedTaskkill` with `0`, `-1`, `NaN`, `undefined`: no
  `taskkill` process is spawned at all; `boundedTaskkill` resolves
  `{ ok: false, error }` and never rejects, preserving its contract.
- `boundedTaskkill` with a valid pid still spawns and resolves `{ ok: true }`.

### 2. `shellJobInternal.test.ts` (new)

No test file exists for this module today.

- `killProcessGroupSafe(0, 'SIGTERM')` is a no-op: a real child in the caller's
  own process group survives, and the test process survives.
- `killProcessGroupSafe(-1, ...)`, `NaN`, `Infinity`: no-ops, no throw.
- `killProcessGroupSafe(validPid, 'SIGTERM')` still terminates that group.

### 3. `shellJobManager` cancel path

Extend the existing suites rather than duplicating them.

- Cancel a job whose spawn failed (the `-1` / absent-pid sentinel): assert no
  signal is delivered to the caller's process group and the manager still
  transitions the job to a terminal state. Fails today because the sentinel
  reaches `process.kill(1)`.
- `failJobIfOverCapSync` with a sentinel pid: same assertion.
- In `shellJobManagerSurvivors.test.ts` and `shellJobWindowsSpawn.test.ts`, the
  injected `taskkillImpl` spy is exactly the boundary where a bad pid is
  observable. Assert every received pid is `> 0`, and add a case where the job
  carries a sentinel pid asserting `taskkillImpl` is **never** called.

### 4. `shellPtyLifecycle` abort guards

- `ptyAbortAction` / `ptyInactivityAbortAction` with a `NaN` pid: no
  `process.kill` is attempted. Fails today because the `=== 0` check lets `NaN`
  through.

### 5. `terminatePty`

- With a non-positive pid: no signal is sent.
- On Windows with a registered pty: uses the taskkill path, not
  `process.kill(-pid)`.

## Fix

Applied only after the tests above are red.

1. Add `isKillablePid(pid: unknown): pid is number` — true only for a whole
   number `> 0`. Rejects `undefined`, `0`, `-1`, `NaN`, `Infinity`, fractional
   values (which the runtime could truncate onto an unrelated group after the
   `-pid` negation), and non-numbers. One chokepoint, placed alongside the kill
   primitives.
2. Apply it as an early no-op guard in `killProcessGroupSafe`,
   `escalateKillUnix`, `taskkillTree`, `boundedTaskkill` (resolving
   `{ ok: false, error }` to preserve the never-rejecting contract), and
   `terminatePty`. Replace the narrow `pid === 0` checks in `ptyAbortAction` and
   `ptyInactivityAbortAction` with it. Purely additive — a valid pid still
   proceeds on every path, so no correct kill changes behavior.
3. Give `terminatePty` the `isWindows` branch it is missing, so it uses taskkill
   on Windows instead of a meaningless `process.kill(-pid)`.
4. Replace the `-1` spawn sentinel with an explicit absent pid so "no pid" is
   representable in the type system rather than encoded as a dangerous-looking
   number. This touches `shellJobSpawn.ts` and the `pid` fields in
   `shellJobTypes.ts`; update readers accordingly.
5. Confirm the foreground kill paths cannot act on a stale or reused pid.
   **Outcome: no code change required.** The background paths use
   `childIsRunning(child)` because they hold a `ChildProcess`. The foreground
   pty paths hold an `IPty`, which is not a `ChildProcess`, so that helper does
   not apply — but they already carry the equivalent identity signal:
   `state.exitedGuard.isExited()` is checked before the initial signal and
   re-checked before every SIGKILL escalation, so a pid whose process has
   already exited is never signalled. Adding a second, parallel mechanism would
   be premature abstraction (`dev-docs/RULES.md` anti-pattern #1). What the
   foreground paths genuinely lacked was pid validation, which step 2 supplies.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

Note that `packages/core` runs under Bun; new tests are TypeScript Bun tests.
The POSIX process-group assertions are gated to POSIX because the production
behavior they cover (`process.kill(-pid)`) is itself POSIX-gated; the Windows
`taskkill` assertions are gated to Windows for the same reason.
