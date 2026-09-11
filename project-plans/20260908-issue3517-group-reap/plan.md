# Plan: Foreground shell timeout must terminate and confirm the whole process group (Issue #3517)

Branch: `issue3517`. Milestone 0.12.0. Labels: Tooling, recoverability.

## Root cause analysis

Incident: a foreground `run_shell_command` with `timeout_seconds` reported
`Signal: 15` while its `bun test` grandchild kept running in the spawned
process group and kept writing to a redirected log.

The foreground POSIX path spawns `bash -c <cmd>` with `detached: true`, so the
child leads its own process group (`child.pid == pgid`). On timeout the tool
aborts an `AbortController`; the abort listener runs
`cpKillOnAbort` → `killProcessWithEscalation` → `escalateKillUnix`
(`packages/core/src/services/shellProcessKill.ts`), which:

1. Sends `SIGTERM` to the group.
2. Waits `SIGKILL_TIMEOUT_MS` (200 ms).
3. Sends `SIGKILL` to the group only `if (!exitedGuard.isExited())`.

`exitedGuard` tracks ONLY the direct child (the `bash` wrapper). When `bash`
dies from the SIGTERM, the guard is marked exited, so step 3 is skipped. A
grandchild that survives SIGTERM (the incident's `bun test`) is never
escalated to SIGKILL. The result promise resolves on the direct child's
`exit` event (plus a ≤500 ms stdio drain grace in `shellCpExecution.ts`), so
the tool returns claiming termination while group members are still alive.
Nothing in `ShellExecutionResult` or the tool output tells the caller that
survivors remain.

The PTY abort path (`ptyAbortAction` in `shellPtyLifecycle.ts`) has the same
shape: after the SIGTERM round it returns early when
`state.exitedGuard.isExited()`, skipping the group SIGKILL, and
`schedulePtyAbortFallback` resolves the result after a fixed 200 ms timer
with no confirmation that the group is empty.

## Acceptance criteria

- **AC1 — Escalation is gated on group liveness, not the direct child.**
  On POSIX, when a foreground execution is aborted (timeout or user cancel),
  after the group SIGTERM + grace period the executor sends SIGKILL to the
  entire process group whenever the group still has live members — even if
  the direct child has already exited. A grandchild that ignores or traps
  SIGTERM must be killed by the escalation.
- **AC2 — Bounded reap before the result is produced.**
  On POSIX, when an abort-timeout result is about to be resolved, the
  executor waits a small bounded window (constant, on the order of 1–2 s,
  short poll interval) until the spawned process group has no live members
  (`process.kill(-pgid, 0)` throws `ESRCH`). The result must not be produced
  while group members are still alive, unless the reap window expires.
- **AC3 — Honest reporting when survivors remain.**
  If the reap window expires with live group members, `ShellExecutionResult`
  carries that fact (new optional field), and the `run_shell_command` output
  for that execution explicitly states that child processes may still be
  running and gives the explicit cleanup instruction
  (`kill -9 -- -<PGID>`). Foreground commands have no managed task id, so
  the cleanup instruction is the mechanism the issue allows.
- **AC4 — No regression on unaffected paths.**
  - Normal completion (no abort): unchanged behavior, no added latency, no
    new waits.
  - Abort where the whole group dies promptly (the common case): resolves
    promptly with the existing timeout/cancel messaging and no survivor
    warning (group already empty → reap returns immediately).
  - Background jobs (`is_background` / trailing `&`, `shellJobManager`) are
    out of scope and untouched. `timeout_seconds` does not apply to them.
  - Inactivity timeout uses the same kill helpers, so it inherits the same
    confirm-before-resolve behavior; no separate handling.

## Boundary cases

- Group leader (direct child) dead, grandchild alive → escalation still
  fires and reaps (the incident).
- Whole group dead before the reap check → immediate resolution, no delay.
- Grandchild ignores SIGTERM but not SIGKILL (`trap '' TERM` dispositions
  survive `exec`) → killed by AC1, clean result.
- Truly unkillable survivor (permission edge) → reap window expires, AC3
  warning. At helper level this is exercised by polling a pid that exists
  and will not die (e.g. pid 1) without ever signaling it.
- `bun-pty` backend (`supportsProcessGroupKill === false`): group kill is
  not possible; keep existing direct-kill behavior and do NOT add the reap
  wait there (it would stall every abort without being able to kill
  anything). No regression, documented limitation.
- Windows: `taskkill /f /t` already walks the tree; keep `taskkillTree` as
  the kill mechanism on abort. If a bounded confirmation is trivially
  available via the existing `boundedTaskkill` primitive, wire it in and set
  the same survivor flag on failure; tests for this are gated to Windows and
  must not run on Linux CI. Optional — drop rather than expand scope.
- PID-reuse races during the short poll window are accepted (existing
  behavior already has this property; do not add pidfd machinery).

## Out of scope (explicitly)

- #3491 (sandbox session exit after intentional backgrounding) and #3514
  (bun test orphan reaper crossing checkouts).
- Any change to background job lifecycle, the job manager, or the shell tool
  schema/descriptions beyond appending the survivor warning to the result
  text of a timed-out foreground execution.
- No new public abstraction beyond the one optional field on
  `ShellExecutionResult` (core-internal type).

## Test plan (bun tests, real processes, no mock theater)

POSIX cases gated with `describe.skipIf(isWindows)` matching the existing
style in `shellProcessKill.test.ts`.

1. `packages/core/src/services/shellProcessKill.test.ts`
   - Escalation with a dead group leader but a live TERM-immune group member
     (guard pre-marked exited): group SIGKILL still fires and the member
     dies within a deadline (AC1). Choreography: detached
     `bash -c '( trap "" TERM; exec sleep 30 ) & ...; exit 0'` so the
     direct child exits while the subshell (same group) survives SIGTERM.
   - New `reapProcessGroup`-style helper: resolves promptly `true` when the
     polled pids are gone; resolves `false` when a polled pid stays alive
     for the window (poll pid 1 — signal-0 probes only, never signal it).
2. `packages/core/src/services/shellCpExecution.test.ts` (new file if absent)
   - Service-level: `ShellExecutionService.execute(..., shouldUseNodePty:
     false)` runs a command that leaves a TERM-immune grandchild in the
     group; abort after a short delay; the resolved result arrives only
     after the grandchild is dead (`process.kill(pid, 0)` throws), and
     `aborted === true` (AC1+AC2).
   - Prompt-abort case: whole group dies on SIGTERM → result resolves with
     no measurable reap delay and no survivor flag (AC4).
3. `packages/core/src/services/shellPtyLifecycle.test.ts`
   - PTY abort (lydell backend, POSIX): TERM-immune grandchild under the
     pty shell is dead by the time the result resolves (AC1+AC2). Model on
     the existing PTY bun tests; skip gracefully if no usable PTY in the
     environment.
4. `packages/tools/src/__tests__/shell-tool.test.ts`
   - Formatting: a result carrying the survivor field rendered through the
     timeout path includes the survivor warning naming the cleanup command;
     a clean timeout result does not (AC3). Pure formatting assertions on
     constructed results.

## Implementation sketch (guidance, not mandate)

- `shellProcessKill.ts`: add a bounded group-reap helper (poll
  `process.kill(-pid, 0)` until it throws or the window expires); change the
  escalation predicate in `escalateKillUnix` from `!exitedGuard.isExited()`
  to group-liveness so a dead direct child no longer suppresses the group
  SIGKILL (keep the guard for the fallback/error path).
- `shellCpExecution.ts`: after the abort kill, and before the finalizer
  resolves on the abort path, await the bounded reap; set the new
  `ShellExecutionResult` field when survivors remain. Ensure the concurrent
  escalation is not starved by `cleanupCpResources` marking the guard (it no
  longer gates the group SIGKILL after the predicate change).
- `shellPtyLifecycle.ts`: same treatment in `ptyAbortAction` (group-kill
  branch only), replacing the fixed 200 ms fallback-only resolution with
  kill → bounded reap → resolve, setting the same field on survivors.
- `shellExecutionTypes.ts`: one optional field (name at implementer
  discretion, e.g. `survivingGroupMembersOnAbort: boolean`).
- `packages/tools/src/tools/shell.ts`: append the survivor warning (with
  `kill -9 -- -PGID` instruction) to the timeout/abort `llmContent` when the
  field is set. This is the "tools layer reports it" step; it does not
  change the tool schema.

## Verification

Full cycle from the issue workflow: `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, then the
`stepfun-37` smoke test via `bun scripts/start.ts`. Then deepthinker
compliance review (≤2 rounds), OCR (≤2 rounds), PR, CI watch.

## Review-finding triage

Findings will be classified Blocker-Fix / In-scope-Fix / Reject / Defer.
Reviewer suggestions do not expand scope; anything beyond the accepted
behavior above needs explicit approval before implementation.

### Compliance review (round 1) outcome

- Finding 1 (PTY exit-race window: an abort landing while natural-exit
  output drains resolved immediately, bypassing the group-reap gate and the
  survivor warning) — **In-scope-Fix**. Fixed in `ptyExitRace`: the
  abort-win path now arms/shares the same bounded group-reap chain
  (`abortGroupReapChains`) that `ptyAbortAction`'s group branch uses and
  gates the result on it, flagging survivors via the widened
  `finalizeResult` signature. Same hazard class as the incident, on a
  foreground timeout/cancel path.
- Finding 2 (CP inactivity kill set the survivor flag but
  `formatNormalOutput` never rendered it, because inactivity results carry
  `aborted: false`) — **In-scope-Fix**. One line: `formatNormalOutput`
  appends `appendAbortSurvivorWarning`; clean results stay byte-identical.
- Signal-fidelity pin (reviewer NIT, promoted): new fake-pty test
  `PTY abort signal fidelity (fake pty, issue #3517)` asserts the real exit
  signal (9) wins over the synthetic `(1, null)` abort result when the exit
  fires before the reap chain settles, and that the survivor flag still
  lands. Guards the fix for the deterministic `main.test.ts` failure.
- Lint-driven refactors (`appendAbortSurvivorWarning` moved to
  shell-helpers.ts, `armCpStreamSettleListeners` extraction, `??=`,
  optional-chain removal) — **no action** (behavior-neutral, verified by
  diff).
- Real-process PTY probe skipping in this environment (documented
  oven-sh/bun#25822 unreliability) — **no action** (legitimate skip; PTY
  path covered by fake-pty suite plus reading).
- `ptyInactivityAbortAction` and Windows taskkill confirmation — **Defer**
  (pre-existing sibling hazards outside this issue's scope, unchanged by
  this PR).

### Open code review (round 1) outcome — 18 findings (glm-5.3, complete)

16 **In-scope-Fix** (all addressed in the OCR-r1 remediation):

- Finding 1 (survivor warning lost through `summarizeIfNeeded` on the
  `aborted: false` inactivity path and through `limitOutputTokens` on every
  path) — warning now appended AFTER `buildToolResult` by
  `appendSurvivorNoticeToResult` (durable post-processing, same pattern as
  the clamp notice, Issues #3031/#3517).
- Finding 2 + 15 (formatting coverage gaps + env-dependent `pid: 4321`
  resolution) — user-cancel and inactivity-style tests added; fake results
  carry `pgid: 4321` verbatim so `collectProcessInfo` never hits a real
  `ps` lookup.
- Finding 3 (contract asymmetry on the tools-side field doc) — comment
  rewritten to state the POSIX group-kill-abort-path restriction.
- Finding 4 (cp kill-chain rejection could stall `handle.result` forever) —
  never-reject contract enforced at the arm site:
  `cpKillOnAbort(...).catch(() => false)`.
- Finding 5 (cp survivor-branch never exercised) — new
  `shellCpExecution.test.ts` case with the established `process.kill` spy
  pattern (group probes keep reporting alive → window expires → flag set).
- Findings 7 + 18 (PTY chain rejection contract + stale inactivity-kill
  fallback timer resolving before the group-reap chain settles) —
  `reapProcessGroup(pid).catch(() => false)` tail and
  `clearPendingAbortFallback` called before arming the group chain.
- Finding 8 (module-level `await probeUsableForkptyPty()` throw took down
  the whole test file) — probe failure now skips only the real-PTY suite
  (`forkptyBackend = null`), fake-pty tests preserved.
- Finding 9 (ptyExitRace abort-during-drain branch untested) — new
  deterministic fake-pty test gates the result on the group-reap chain and
  asserts exit values win + survivor flag lands.
- Findings 10 + 12 + 13 + 14 (`kill(-1, ...)` broadcast footgun via
  negation, pid-1 probe test passing for the wrong reason, EPERM→alive and
  skip-path unpinned, convergent reap untested) — new
  `isGroupTargetPid` chokepoint (`pid > 1`) shared by
  `isProcessGroupAlive`/`reapProcessGroup`/`escalateKillUnix` with unit
  tests; reap tests now use real detached groups (`waitForGroupAlive`
  readiness gate) instead of pid-1 probes; spy-based EPERM and
  skip-the-group-SIGKILL tests; convergent mid-window-death test.
- Findings 16 + 17 (warning dropped from `returnDisplay`; POSIX-only
  `kill -9` instruction emitted unconditionally) — `returnDisplay`
  appended on aborted results; `appendAbortSurvivorWarning` is a no-op on
  win32.

2 **Defer** (documented known follow-ups, no behavioral risk):

- Finding 6 (mock infra duplicated between
  `shellExecutionService.main.test.ts` and `.fallback.test.ts`) —
  test-infra dedup refactor across files this PR does not otherwise touch.
- Finding 11 (zombie-leader can hold `kill(-pgid, 0)` alive until reaped;
  worst case adds one reap window of latency before the survivor warning) —
  accepted limitation, same class as the already-accepted PID-reuse races.

### Open code review (round 2) outcome — 7 findings (glm-5.3, complete)

Run against merge-base..HEAD including the OCR-r1 remediation (verified
model glm-5.3 in the manifest after discarding a first host-side attempt
that silently used the config default glm-5.2 — the named-provider config
overrides OCR_LLM_MODEL; explicit `--provider zai-anthropic --model
glm-5.3` flags are required on the host). All 7 findings **In-scope-Fix**
(addressed in the OCR-r2 remediation; none deferred):

- Finding 1 (HIGH, tools): cleanup instruction `kill -9 -- -PGID` had no
  integer/>1 guard — pgid 1 would print `kill -9 -- -1` (broadcast) and a
  NaN pgid from `tryResolvePgidFromPs` prints `-NaN`. `appendAbortSurvivorWarning`
  now falls back to the generic warning unless
  `Number.isInteger(pgid) && pgid > 1`; tests pin pgid 1 and NaN.
- Finding 4 (HIGH, core): `armPtyGroupAbortKill` and the inactivity group
  branch issued `process.kill(-pid, 'SIGTERM')` gated only on
  `isKillablePid` (accepts pid 1) — the exact broadcast the
  `isGroupTargetPid` chokepoint exists to prevent, missing at these new
  call sites. Both paths now guard with `isGroupTargetPid`
  (treat-as-already-gone semantics); `ptyExitRace` gate swapped to
  `isGroupTargetPid`; POSIX-gated fake-pty tests assert pid 1 never
  produces a `process.kill(-1, ...)` target. This supersedes the round-1
  compliance defer of `ptyInactivityAbortAction`: the chokepoint contract
  ("every `process.kill(-pid, ...)` call site") introduced in this PR
  makes that branch in-scope.
- Finding 5 (MEDIUM, core): a Windows taskkill spawn throw (converted to
  `false` by the arm-site catch) stamped the survivor flag on Windows
  results, violating the POSIX-only contract. Flag stamp now gated on
  `!state.isWindows`; Windows regression test added via synchronous
  taskkill-spawn failure.
- Finding 6 (MEDIUM, tools): the `result.aborted === true` gate hid the
  survivor warning from `returnDisplay` on inactivity kills
  (`aborted: false` + flag) — the gate tracked who killed, not whether
  children survived. Gate dropped; inactivity test now asserts the
  display warning too.
- Finding 7 (MEDIUM, core): `finalizeInactivityKill` could arm the 200 ms
  fallback while a caller-abort group-reap chain was in flight, resolving
  the synthetic result before the chain settled (dropping the survivor
  flag and possibly overwriting late real exit values). It now skips
  fallback scheduling when `abortGroupReapChains.has(state)`; overlapping
  abort/inactivity regression test added.
- Findings 2+3 (LOW, tools tests): win32 no-op branch of
  `appendAbortSurvivorWarning` pinned with `mockPlatform('win32')`; the
  user-cancel test's 50 ms sleep race made deterministic via an
  entered-`executeShellCommand` signal awaited before abort.

Scoped verification after fixes: core typecheck exit 0; shell service
tests 33 pass/5 skip/0 fail; execution-service contract tests 61 pass/0
fail; tools typecheck + shell-tool tests 24 pass/0 fail; eslint and
prettier clean on all six touched files.

### Verification results (candidate head)

- Targeted core files: 87 pass / 0 fail / 5 skip (POSIX/Windows gates),
  2 consecutive runs; tools `shell-tool.test.ts`: 19 pass.
- Full chain (build → core → tools → cli → lint → typecheck → format):
  build OK, lint OK, typecheck OK, format clean.
- Core suite: only `gitService.test.ts` and `editor.test.ts` fail — both
  reproduced failing on `main` (pre-existing).
- CLI suite: only `docsCommand.test.ts` and
  `sandbox-node-modules-preflight.test.ts` fail — both reproduced failing
  on `main` (pre-existing).
- Smoke test (`stepfun-37`): blocked by sandbox credential-proxy failure
  (`Invalid or missing capability token`); reproduced identically on
  `main`, so pre-existing/environmental, not this change. The sandbox no
  longer exports `LLXPRT_CAPABILITY_TOKEN` to child processes and the
  proxy rejects the token frozen in `/proc/1/environ`.

### Verification results (OCR-r1 remediation tree, chain v3/v4)

- v3 (remediation as left by the crashed session): build OK, tools OK
  (21 pass shell-tool), cli OK (743/743 files, 9581 cases — the two v2
  cli failures did not recur), format OK, **smoke OK** (the v2
  credential-proxy failure was transient and resolved).
- v3 core: FAIL, but only `skillManager.test.ts` +
  `extensionSkillRefresh.test.ts` — reproduced identically on `main`
  (worktree run: 19 pass / 2 fail, same files). Machine-state dependent
  (real global user skills leak into the assertions; 55 discovered).
  Filed as #3631. The v2-era `gitService`/`editor` failures did not
  recur this run.
- v3 caught real gaps the crashed session left: 2 lint errors
  (prefer-const on the now-unreassigned `llmContent`; shell.ts at 822
  lines vs 800 max) and 4 typecheck errors (mock signatures on
  `vi.spyOn(process,'kill')` in 3 files; `signal: null` vs
  `signal?: number` in the fake-pty drain test). Fixed by
  typescriptexpert: `const`, `appendSurvivorNoticeToResult` moved to
  shell-helpers.ts as an exported pure function, mock annotations
  matched to `process.kill`'s type, exit-listener event widened to
  `signal?: number | null` (mirroring the existing fake-pty test).
- v4/v5 (post-fix chains): build OK, targeted core shell tests OK
  (16 pass/4 skip in shellProcessKill alone; 29 pass/5 skip across the
  three files), full tools suite OK (133/133 isolated files + runner
  suites), lint OK (both shell.ts errors gone), format OK, root
  typecheck exit 0 after one knock-on tuple-annotation fix
  (`deliveredSignals` widened to `signal: string | number`).
- v6 (final, OCR-r2 remediation tree): build OK, tools OK, cli OK
  (full suites), lint OK, typecheck OK, smoke OK (stepfun-37). Core
  430/432 with only the two #3631 skills files failing (proven on
  main). format:check initially flagged one line-wrap in
  `shellProcessKill.test.ts` (the widened tuple annotation); fixed by
  the repo formatter, file re-verified green.

### CodeRabbit review outcome (PR #3637) — 1 actionable finding, fixed

- Finding (Major, core, `shellPtyLifecycle.ts`): on a pure inactivity kill
  (caller never aborts), the POSIX group branch still ran the OLD inline
  sequence — group SIGKILL skipped once the direct child exited — never
  armed the group-reap chain, and the exit handler only gated on the chain
  when `state.abortSignal.aborted`; `ptyExitRace`'s non-abort winner
  resolved immediately with no group confirmation and no survivor flag
  while TERM-immune descendants kept running. Exactly the incident shape
  on the inactivity path, which AC4 claims inherits the gate —
  **In-scope-Fix**. This fully supersedes the round-1 compliance defer of
  `ptyInactivityAbortAction` (Windows taskkill confirmation stays
  deferred). Fix: the inactivity group branch now awaits
  `armPtyGroupAbortKill` (shared chain, group-liveness-gated SIGKILL,
  bounded reap) and mirrors `ptyAbortAction`'s resolution tail
  (hasResolved/exitedGuard early returns; synthetic forward-progress
  result stamped with the survivor flag); `registerPtyExitHandler`'s
  onExit hoists the chain lookup and gates non-aborted resolution on an
  in-flight chain too (natural-exit values win, survivors flagged).
  Implemented by fallbacktypescriptcoder (typescriptexpert provider down).
- Tests: two POSIX-gated fake-pty cases through the REAL inactivity timer
  (`createPtyResultPromise` + `inactivityTimeoutMs: 10`): surviving group
  (probes alive → window expires → flag set, SIGKILL issued, elapsed ≥
  window) and confirmed-empty group (probes ESRCH → prompt resolve, no
  flag); both assert `aborted === false`, exit fidelity (143/15), and
  TERM+probe delivery. Both failed before the production change.
- Verification: targeted suite 15 pass/1 skip/0 fail; package typecheck,
  eslint, prettier clean on the two files; full chain v7 run post-fix
  (results below).
- v7 (CodeRabbit-fix tree, final): build OK, tools OK, cli OK, lint OK,
  typecheck OK, format:check OK, smoke OK (stepfun-37). Core 430/432 with
  only the two #3631 skills files failing — identical to the v6 baseline;
  no regression from the inactivity-path fix.
