# Plan: Propagate native exit codes through the Windows PowerShell shell path (Issue #3320)

Plan ID: PLAN-20260825-ISSUE3320
Generated: 2026-08-25
Issue: #3320
Status: In progress

## Problem statement

On Windows, `ShellExecutionService` composes
`powershell.exe -NoProfile -Command <cmd>` (from `getShellConfiguration()` in
`packages/core/src/utils/shell-utils.ts`). Windows PowerShell's `-Command`
does not adopt the exit status of the last native executable: a program that
exits 42 makes `powershell.exe` exit 1. Every consumer of the shell tool's
exit code on Windows (the model's view of a failed command, retry logic that
keys off exact codes) sees 1 instead of the real status. bash (non-Windows)
propagates natively; the codebase already works around this PowerShell quirk
in one subsystem (`packages/core/src/hooks/hookRunner.ts`,
`buildPowerShellExitCodeWrapper`) but not in the general shell path.

Evidence (issue): nightly Windows `core` shard fixture exiting 42 reported
`Expected: 42 / Received: 1`. `shellBoundedAcquisition.bun.test.ts` had to
add a fixture-level `propagateExit()` helper (`; exit $LASTEXITCODE` at the
call site) to keep its own test meaningful — proof the product path loses the
code.

## Accepted behavior (acceptance criteria)

- AC1: On the PowerShell shell configuration, a command whose underlying
  native program exits with code N (N ≠ 0) is reported with `exitCode === N`
  by `ShellExecutionService` (both the child_process fallback and the PTY
  path).
- AC2: Successful commands still report `exitCode === 0` (native exit 0 and
  successful PowerShell statements).
- AC3: PowerShell-level failures (e.g. `Write-Error`, command-not-found)
  still report a nonzero code (1). A naive `; exit $LASTEXITCODE` suffix
  would turn these into 0 because `$LASTEXITCODE` stays 0/$null when no
  native command ran — this regression is explicitly rejected.
- AC4: A user command that itself ends in `exit N` still yields N (the
  shell exits before the appended suffix runs).
- AC5: Signal/termination cases are unchanged (exitCode null + signal,
  `aborted` flag; handled upstream in `createCpResultPromise` /
  `createPtyResultPromise`, untouched by this change — verified by the
  existing abort/signal tests continuing to pass).
- AC6: bash and cmd behaviour is unchanged: `getShellConfiguration()`
  output is byte-identical; the bash composition (`shopt` guard + command)
  is byte-identical; nothing changes for non-PowerShell shell types.
- AC7: The behavior is covered by a test that fails against the current
  Windows behaviour (a real-subprocess test asserting exit code 42, which
  fails on the Windows CI runner today and passes after the fix; on
  macOS/Linux it is a regression guard since bash already propagates).

Boundary cases in scope:

- A command ending with `;` or a newline must not produce a parse error
  from the appended suffix (use newline as the statement separator between
  the user command and the suffix; a bare `;` separator would create `;;`).
- Multiline user commands keep working (PowerShell already accepts
  newlines in `-Command`; this is permitted today when the parser is
  available).
- Empty command string: composed result still exits 0 (assignment prelude
  succeeds).

## Preflight findings (verified in code)

1. Composition sites — exactly two, both in
   `packages/core/src/services/shellExecutionService.ts`:
   - `childProcessFallback` (~L95): `const guardedCommand =
     ensurePromptvarsDisabled(commandToExecute, shell);` then
     `[...argsPrefix, guardedCommand]` into `cpSpawn`.
   - `executeWithPty` (~L150): same composition into `ptyInfo.module.spawn`.
   `ensurePromptvarsDisabled` (`packages/core/src/services/shellOutputUtils.ts`)
   prepends a `shopt` guard for bash only and is a no-op for PowerShell —
   the natural sibling location for the new helper.
2. `getShellConfiguration()` on Windows ALWAYS returns shell `powershell`
   (either ComSpec pointing at powershell.exe/pwsh.exe, or the
   `powershell.exe` default); `cmd` never wins, so the wrapper is
   PowerShell-only by construction.
3. `hookRunner.ts` semantics to mirror (lines 67-80): pre-initialize
   `$global:LASTEXITCODE = 0`; after the user script, `if ($?) { exit 0 }`;
   `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`; `exit 1`. This
   ordering matters: `$?` is False after a native command exits nonzero
   (both PS 5.1 and 7.x), so native-N lands in the `$LASTEXITCODE` branch,
   while PS-level failures (no native involved) fall through to `exit 1`.
   The pre-initialization avoids `$null -ne 0 → exit $null → 0` for
   PS-level failures.
4. Tests asserting the exact composed spawn args through the service
   (must be updated when the command string changes):
   - `packages/core/src/services/shellExecutionService.fallback.test.ts`
     L477 (`dir "foo bar"`), L609 (`echo hello`) — win32-stubbed, run on
     every platform.
   - `packages/core/src/services/shellExecutionService.main.test.ts` L625
     (`dir "foo bar"`, PTY path, `../utils/runtime.js` mocked) — runs on
     every platform.
   - `packages/core/src/services/shellExecutionService.windows.test.ts`
     L75, L96 — `skipIf(!isWindows)`, Windows CI only.
   - `packages/core/src/services/shellExecutionService.windows.multibyte.test.ts`
     L104, L185 — win32-stubbed, every platform.
   - NOT affected (spawn PowerShell directly, not through the service):
     `shellProcessKill.test.ts`, `shellExecutionService.terminatePty.test.ts`,
     `shellJobWindowsSpawn.test.ts`, `shellJobManager.test.ts` (job manager
     is not modified).
5. Real-subprocess cross-platform test pattern exists in
   `shellBoundedAcquisition.bun.test.ts`: temp-dir `.mjs` fixture run via
   `process.execPath`, with the `&` call operator prefix needed for
   PowerShell expression-mode quirks. `.bun.test.ts` files run under the
   normal suite (`packages/core` `test` = `bun run-bun-tests.ts`).

## Implementation design

### Production change (2 files)

1. `packages/core/src/services/shellOutputUtils.ts` — add
   `ensureNativeExitCodePropagated(command: string, shell: ShellType): string`
   next to `ensurePromptvarsDisabled`:

   ```ts
   const POWERSHELL_EXIT_CODE_PRELUDE = '$global:LASTEXITCODE = 0;';
   const POWERSHELL_EXIT_CODE_SUFFIX =
     'if ($?) { exit 0 }\n' +
     'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n' +
     'exit 1';

   export function ensureNativeExitCodePropagated(
     command: string,
     shell: ShellType,
   ): string {
     if (shell !== 'powershell') {
       return command;
     }
     return `${POWERSHELL_EXIT_CODE_PRELUDE}\n${command}\n${POWERSHELL_EXIT_CODE_SUFFIX}`;
   }
   ```

   Newline separators tolerate a trailing `;` in the user command. Comment
   references hookRunner's wrapper and issue #3320 (why the ladder, not a
   bare `; exit $LASTEXITCODE`).

2. `packages/core/src/services/shellExecutionService.ts` — at both
   composition sites:

   ```ts
   const guardedCommand = ensureNativeExitCodePropagated(
     ensurePromptvarsDisabled(commandToExecute, shell),
     shell,
   );
   ```

   (The two helpers are mutually exclusive by shell type: shopt guard is
   bash-only, propagation is powershell-only.)

### Tests

1. NEW `packages/core/src/services/shellExitCode.bun.test.ts`
   (copyright 2026, real subprocesses, model after
   `shellBoundedAcquisition.bun.test.ts`):
   - Unit describe for `ensureNativeExitCodePropagated` (pure
     transformation, literals on the input side):
     - powershell: exact composed string for a representative command
       (prelude, command on its own line, exit ladder).
     - powershell: command ending in `;` still composes without `;;`.
     - bash: identity. cmd: identity.
   - Behavioral describe (child_process fallback, real subprocesses,
     cross-platform):
     - fixture script exiting 42 → `result.exitCode === 42` (AC1/AC7;
       fails on Windows today).
     - fixture script exiting 0 → `result.exitCode === 0` (AC2).
   - Windows-only describe (`describe.skipIf(process.platform !== 'win32')`):
     - `Write-Error` command → `exitCode === 1` (AC3; fails if the fix
       regresses PS-level failures to 0).
     - `exit 7` command → `exitCode === 7` (AC4).
   - Fixture: temp-dir `.mjs` with `process.exitCode = N`; invoke via
     quoted `process.execPath` with `& ` prefix when
     `getShellConfiguration().shell === 'powershell'` (documented
     PowerShell expression-mode quirk).
2. Updated spawn-arg assertions (keep those tests focused on what they
   actually test — shell/executable/spawn options — by matching the command
   arg with `expect.stringContaining(<original command>)`):
   - `shellExecutionService.fallback.test.ts` (2 sites) + add ONE new
     exact-args assertion pinning the full composed command
     (prelude + command + ladder) through the service on win32 stub, so
     the wiring is proven on non-Windows dev machines.
   - `shellExecutionService.main.test.ts` (1 site, PTY path — proves the
     PTY composition site).
   - `shellExecutionService.windows.test.ts` (2 sites).
   - `shellExecutionService.windows.multibyte.test.ts` (2 sites).

### Out of scope (rejected/deferred)

- `shellJobManager` background-job Windows path (Start-Process semantics,
  separate subsystem) — potential follow-up issue, not this PR.
- `hookRunner` (already correct; do NOT unify its wrapper with the new
  helper — different context, different constraints).
- Removing the now-redundant `propagateExit` fixture helper in
  `shellBoundedAcquisition.bun.test.ts` (owned by #3253's test; harmless
  and self-contained; touching it couples this PR to another effort).
- Zed terminal manager, shellProcessor, prompt processors (interactive
  shell selection, not `-Command` execution with exit codes).
- Any change to `getShellConfiguration()` itself.

## Test-first ordering

1. Write the unit tests for `ensureNativeExitCodePropagated` + the
   behavioral test file → RED (helper missing; on Windows CI the 42-test
   is the true red, on macOS the unit tests are red first).
2. Implement the helper + wire both composition sites → GREEN locally.
3. Update the six existing assertions (they pin the old composed string
   and go red the moment the helper lands — update together with it).

## Verification

Full cycle per the issue workflow (run by the implementer, the reviewer,
and after any remediation):

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Windows-specific proof: the cross-platform behavioral tests + the
Windows-only describe run on the Windows CI shard of the PR (AC7); locally
on macOS we prove composition wiring via the win32-stubbed tests.

## Review triage policy

Findings classified as Blocker-Fix / In-scope-Fix / Reject / Defer.
Scope additions (job manager, hookRunner unification, fixture cleanup)
## Review triage policy

Findings classified as Blocker-Fix / In-scope-Fix / Reject / Defer.
Scope additions (job manager, hookRunner unification, fixture cleanup)
require user approval before inclusion.

## Review outcomes

### deepthinker review (round 1, 2026-08-25)

Verdict: PASS, findings NONE. Independently re-ran the six targeted test
files (all green), lint (0), typecheck (0), `git diff --check` (clean),
and the test-audit scanner (no findings on the new test or changed
lines). Scope assessment: working tree stays strictly within plan.md.

### OCR round 1 (local, workspace scope, ocr v1.10.0, run 20260825T170523Z-5e315e95)

Status complete, 7/7 files reviewed, 3 findings:

1. MEDIUM (test): Windows-only tests never run on Linux CI; suggested
   pwsh cross-platform detection. **Reject.** The repo's Windows CI
   shard (where #3253 observed the original bug) executes these
   `skipIf(!isWindows)` suites — the established pattern in sibling
   test files. pwsh 7 propagates native exit codes natively, so the
   42→42 test would pass without the fix on pwsh and could never
   detect the Windows PowerShell 5.1 regression it exists to catch;
   the suggestion would also add out-of-scope test infrastructure.
2. LOW (maintainability): exact-string assertion in
   `shellExecutionService.fallback.test.ts` duplicates the ladder
   format. **Reject.** The single exact pin through the real service
   path is deliberate (proves composition order and separators at the
   wiring site; all sibling assertions were relaxed to
   `stringContaining`). Exporting the constants and composing the
   expectation from them would make the assertion circular.
3. LOW (bug): file-scoped `afterAll` could call `rmSync('')` when the
   describe-scoped `beforeAll` never ran (test-name filtering or
   beforeAll throw), masking results. **In-scope-Fix (applied):**
   guarded cleanup on `fixtureDir !== ''` in
   `shellExitCode.bun.test.ts`.

Verification cycle re-run after the fix (round 2): targeted test file
green, format 0; full suite/lint/typecheck/build re-run — results in
tmp/verify3320/*2.log.

### Environmental notes (both verification rounds)

- First typecheck failed on `packages/core/src/telemetry/sdk.test.ts`
  (`getTelemetryLogApiBodiesEnabled` missing): stale local
  `packages/telemetry/dist` built before main HEAD e84a100a9 added the
  property; green after `npm run build` refreshed dist. Not related to
  this change.
- First full-suite run had 6 timeout-signature failures in unrelated
  subsystems (grep tool internals, direct-web-fetch transport, agents
  cli-turn-parity/scheduler-factory/session); the suite ran concurrently
  with build+typecheck. Every one of the 6 files passed when re-run
  individually on the idle machine (tmp/verify3320/rerun.log).
- Smoke test fails with provider 400 "you have no active step plan
  subscription" (account state on the stepfun provider); startup itself
  boots cleanly to the API call. Unrelated to this diff.
- Round 2 full-suite run: 2 timeout-signature failures
  (config.scheduler.test.ts, engineTodoContinuation.behavior.test.ts),
  both in unrelated subsystems; both files pass when run individually
  (tmp/verify3320/rerun2.log). Same load-flake pattern as round 1.
require user approval before inclusion.
