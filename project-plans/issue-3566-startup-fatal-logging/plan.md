# Issue #3566: Fatal sandbox preflight errors are invisible in practice

Branch: `issue3566`

## Problem

When a startup-path fatal error (a `FatalError` subclass, e.g.
`FatalSandboxError` from the sandbox dependency preflight) aborts the launch,
the only place the message goes is the TTY. The process exits immediately; in
tmux/terminal-multiplexed workflows the pane dies (`Pane is dead`) so the user
never sees the diagnosis. No durable artifact is written, so post-mortems find
nothing.

The fatal funnel is `packages/cli/index.ts`: `main()` (and the bun-launcher /
bootstrap-import paths) reject into `writeCriticalErrorAndGetExitCode()`, which
prints via `writeFatalError()` (stderr only) and then `process.exit()`. Nothing
persists the error.

Note: the github-actions draft plan on the issue proposes hooking
`cli.tsx main()`, but `main()` does not handle fatal throws itself — it throws
and `index.ts` owns printing and exiting. The integration point is the
`index.ts` entry handler, which covers the sandbox hop preflight failures, the
launcher failures, and every other startup fatal uniformly.

## Acceptance criteria

### AC1: Durable persistence of startup-fatal errors

GIVEN a `FatalError` (any subclass, including `FatalSandboxError`) reaches the
CLI entry critical-error handler (from `main()` rejection, launcher failure, or
bootstrap import failure),
WHEN the fatal message is reported,
THEN a single-line JSON record is appended to
`<logHome>/fatal.log` where `logHome = Storage.getGlobalLogDir()`
(macOS: `~/Library/Logs/llxprt-code`), containing:

- `timestamp`: ISO-8601 UTC string
- `cwd`: process working directory at failure time
- `argv`: the full `process.argv`, with `--key <value>` and `--key=<value>`
  credential values replaced by `[REDACTED]` (no other redaction)
- `exitCode`: the fatal error's exit code
- `message`: the full fatal message

The log directory and file are created if absent; repeated fatals accumulate as
additional JSONL lines.

### AC2: Persisted path is printed on the TTY

WHEN the record was persisted successfully,
THEN the stderr fatal output is followed by a line naming the persisted file
path (e.g. `Full error details saved to: <logHome>/fatal.log`) so a user whose
pane died can find the reason afterwards.
WHEN persistence fails (e.g. unwritable log home),
THEN the original message and exit code are reported exactly as before, with no
path line; a persistence failure must never mask or replace the original error.

### AC3: Pause before exit when stderr is a TTY

WHEN a `FatalError` has been reported AND stderr is a TTY AND `--no-pause` is
not present in `process.argv`,
THEN the process waits a brief fixed interval (5 seconds) after printing the
message (with a one-line notice saying it is pausing and how to skip it), then
exits with the original code. SIGINT during the pause still terminates the
process (no signal handler is installed).
WHEN stderr is not a TTY, or `--no-pause` is present,
THEN no pause occurs (the process exits immediately as it does today).

### AC4: `--no-pause` is a recognized CLI flag

`--no-pause` is accepted by the argument parser in both the root scope and the
launch-command scope (so `llxprt --sandbox --no-pause` and
`llxprt --no-pause` both parse without an unknown-argument failure), and is
documented in `--help`. The fatal handler detects it from raw `process.argv`,
so it works even for failures that occur before parsing (launcher/bootstrap
errors).

### AC5: Exit codes are unchanged

Fatal exits keep their existing exit codes (44 sandbox, 43 launcher, 41 auth,
52 config, etc.). This change adds observability only.

## Boundary cases / explicit non-goals

- Only `FatalError` instances get the new treatment. Unexpected critical errors
  (the stack-trace branch) keep their existing behavior. The issue asks for
  "startup-path fatal error" handling; `FatalError` is this codebase's fatal
  vocabulary and covers the sandbox preflight case from the issue.
- The handler hook cannot distinguish pre-TUI from post-TUI establishment
  without adding global state for no user benefit; the single funnel treats all
  `FatalError`s uniformly, which is a superset of the issue's requirement
  ("any `FatalSandboxError` thrown before the TUI session is established").
- Direct `process.exit` startup paths that are not exceptions (stdin guard
  `No input provided`, `--list-extensions`, image-mode dispatch,
  `guardUnconfiguredProvider`) are out of scope; they already print their own
  final messages and are not thrown fatals.
- The `uncaughtException` handler (crash path) is out of scope; crashes are a
  different class from clean fatal exits.
- No telemetry changes (the issue's suggested direction is the local durable
  file; wiring fatal events into telemetry startup infra is a separate effort).
- No changes to preflight recognition itself (#3565 is separate).

## Design

### New module: `packages/cli/src/utils/startup-fatal-log.ts`

Pure, side-effect-free at module scope; imports only `node:fs`, `node:path`,
`FatalError` from core, and `Storage` from `@vybestack/llxprt-code-storage`
(already a CLI dependency, already imported by sibling utils).

Public surface (all unit-tested):

- `resolveStartupFatalLogPath(): string` — `join(Storage.getGlobalLogDir(),
  'fatal.log')`; resolves the log dir at call time so tests can isolate via
  `LLXPRT_LOG_HOME`.
- `redactArgvForLog(argv: readonly string[]): string[]` — redacts `--key`
  values (both `--key v` and `--key=v` forms).
- `appendStartupFatalLog(record: StartupFatalRecord): { ok: true; path: string }
  | { ok: false }` — builds the JSONL line and appends; creates the log dir if
  missing; never throws (persistence failure is reported via the result so the
  caller falls back to the old behavior).
- `buildStartupFatalRecord(error: FatalError, context)` — timestamp/cwd/argv/
  exitCode/message record (`now` injectable for tests).
- `formatStartupFatalMessage(message: string, logPath: string): string` —
  message plus the saved-to line.
- `shouldPauseBeforeExit(argv: readonly string[], stderrIsTty: boolean):
  boolean` — TTY and no `--no-pause`.
- `pauseBeforeExitIfNeeded(argv, stderrIsTty, opts?)` — awaits the pause
  interval; interval and sleep function injectable for tests; never rejects.

### Entry wiring: `packages/cli/index.ts`

- `writeFatalError` persists the record first, then prints the colored message
  and, on success, the saved-to line.
- `writeCriticalErrorAndGetExitCode` returns `{ exitCode, fatal }` so callers
  know whether the pause applies.
- Both catch paths (post-`main()` and launcher/bootstrap) run cleanup, then
  `pauseBeforeExitIfNeeded(process.argv, process.stderr.isTTY === true)`, then
  `process.exit(exitCode)` — extracted into one shared `exitAfterCriticalError`
  helper.

### Flag registration: `packages/cli/src/config/yargsOptions.ts`

- `pause` boolean option in `rootOptions` and `innerCommandOptions`
  (yargs provides `--no-pause` negation for boolean options). Not mapped into
  `CliArgs`; the fatal handler reads raw argv.

## Test plan (TDD; bun:test, behavioral)

New `packages/cli/src/utils/startup-fatal-log.test.ts`:

1. Path resolution: `resolveStartupFatalLogPath()` equals
   `join(<isolated log home>, 'fatal.log')` with `LLXPRT_LOG_HOME` pointed at a
   temp dir.
2. Append creates missing dir/file and writes one valid JSON line with all five
   fields (timestamp parses as ISO date, cwd, redacted argv, exitCode,
   message).
3. A second append accumulates (two lines, both parse).
4. Redaction: `['llxprt', '--key', 'SECRET', '--sandbox']` and
   `['llxprt', '--key=SECRET']` both record `[REDACTED]`; non-key args pass
   through verbatim.
5. Persistence failure: with the log home pointed inside a read-only directory,
   `appendStartupFatalLog` returns `{ ok: false }` and does not throw.
6. `formatStartupFatalMessage` output contains both the original message and
   the path.
7. Pause decision truth table: TTY+no flag → true; TTY+`--no-pause` → false;
   non-TTY → false; non-TTY+`--no-pause` → false.
8. Pause execution: with an injected sleep spy and small interval, the TTY path
   awaits the sleep; skipped paths never call it.

New parser cases (in a `config/` parser test): `--no-pause` parses at root
scope and at launch scope without unknown-argument exit; help text documents
it.

End-to-end wiring test (in the same util test file, guarded on `Bun.spawn`
availability like `jspBootstrapStartup.test.ts`): spawn the real CLI entry
(`bun packages/cli/index.ts --prompt x`) with hermetic env
(`LLXPRT_CONFIG_HOME`/`LLXPRT_LOG_HOME` at temp dirs, `LLXPRT_SANDBOX=bogus`
to induce a deterministic `FatalSandboxError` ("Invalid sandbox command") from
`loadSandboxConfig` during bootstrap, before any network or engine probing),
cwd at a temp dir, stderr piped (non-TTY → no pause). Assert: exit code 44;
`<tmpLogHome>/fatal.log` exists and its single record has the message, argv
containing `--prompt`, cwd equal to the temp cwd, exitCode 44; stderr contains
the fatal message and the saved-to path.

Exit-code preservation is asserted by the e2e case (44) and by keeping the
handler's return values derived from `error.exitCode` unchanged.

## Files

- Create `packages/cli/src/utils/startup-fatal-log.ts`
- Create `packages/cli/src/utils/startup-fatal-log.test.ts`
- Modify `packages/cli/index.ts` (persist + path line + pause wiring)
- Modify `packages/cli/src/config/yargsOptions.ts` (register `pause` flag)
- Create/extend a `config/` parser test for `--no-pause` acceptance

## Out-of-scope guards for reviewers

- No behavior change for non-fatal paths, no exit-code changes, no preflight
  recognition changes, no telemetry wiring, no new dependencies, no settings
  schema changes, no `.js`/vitest files.

## Review log

Round 1 (compliance review): 1 Blocker-Fix + 3 In-scope-Fix accepted and
remediated; 2 findings deferred:

1. Blocker-Fix (fixed): `redactArgvForLog` redacted the next flag's NAME after
   a bare boolean flag (`--sandbox --prompt x` ate `--prompt`). Now skips
   redaction when the following token starts with `--`; two regression tests
   added.
2. In-scope-Fix (fixed): default `writeNotice` call in
   `pauseBeforeExitIfNeeded` sat outside the guarded region; a throwing notice
   writer could reject the helper and flip exit 44 → 1. Moved inside the try.
3. In-scope-Fix (fixed): `--help` documentation now pinned by asserting a
   non-empty `description` on both option registrations.
4. In-scope-Fix (fixed): default pause-notice destination (core
   `writeToStderr`) now covered by a test at the module seam (a stderr
   property spy cannot observe `writeToStderr` because it binds the original
   `process.stderr.write` at module load).
5. Defer: `getBunSpawn`'s double type assertion mirrors the existing
   `jspBootstrapStartup.test.ts` precedent; repo-wide harmonization is out of
   scope.
6. Defer: `--no-pause=true` (equals form) would not skip the pause;
   contradictory usage, yargs only negates booleans via the bare `--no-pause`
   form. Follow-up note only.

Round 2 (findings-verification review, cap reached): **APPROVE**. All four
round-1 fixes verified with file:line evidence (redaction guard +
regressions; writeNotice inside the try/swallow boundary with no exit-code
flip path; registration pinned by description assertions on both option
tables; default `writeToStderr` seam covered via `mock.module` with finally
restore). AC1-AC5 all PASS as originally scoped; no defects found in the fix
code; targeted suite independently re-run 28 pass / 0 fail.

## Verification log

- Targeted tests: 28 pass / 0 fail (`startup-fatal-log.test.ts` +
  `cliArgParser.noPause.test.ts`), re-run after prettier.
- Full chain: LINT=0, TYPECHECK=0, FORMAT=0, BUILD=0
  (tmp/verify3566/step3-lint-v6.log, step3-typecheck-v3.log, step5-format.log,
  step5-build.log).
- Full suite: exit 1 with 4 failing files — docsCommand, sandbox-node-modules
  -preflight, core editor.test.ts, core gitService.test.ts — each re-run on a
  pristine `git stash`d tree and failing identically there (sandbox-session
  env + container artifacts; logs tmp/verify3566/step4-fulltest-v2.log).
- Smoke (`stepfun-37` haiku): fails on credential-proxy auth inside this
  sandboxed session; identical failure on the pristine tree
  (tmp/verify3566/smoke.log, smoke-pristine.log).
- Local OCR review: not runnable in this sandbox. `ocr` was installed, but no
  LLM credentials exist inside the container by design (keys are held by the
  host-side credential proxy; `ocr llm test` fails for lack of endpoint). The
  repo's `.github/workflows/ocr-review.yml` runs OCR automatically on PR
  open/synchronize with credentials from repo variables/secrets, includes
  changed test files by rule, and self-limits to 2 auto-reviews — the PR OCR
  round(s) provide the AI-review coverage within the 2+2 budget.
