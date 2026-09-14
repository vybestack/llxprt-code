# Issue 3589 Plan — Shell tool must report termination cause (inactivity kill vs external signal vs timeout vs cancel)

Generated: 2026-09-13
Branch: `issue3589`
Issue: https://github.com/vybestack/llxprt-code/issues/3589

## Root cause analysis (why the incident showed a bare `Signal: 15`)

The incident command (`tail -f | grep -m1`, a watcher that stays silent)
matched the shell tool's **inactivity timeout**, not the 900s total timeout:

1. Core sets `inactivityTimedOut: true` on `ShellExecutionResult` when the
   inactivity kill fires (`shellCpHelpers.ts` `buildCpExitResult`,
   `shellPtyExecution.ts` L133). The default window is 120s
   (`shell-inactivity-timeout-seconds`, `config.ts` L686), consistent with
   the incident's sub-900s SIGTERM on a silent watcher.
2. `CoreShellToolHostAdapter.executeShellCommand` drops the flag when
   mapping to the tools-layer result type — the tools-layer
   `ShellExecutionResult` (in `IShellToolHost.ts`) has no such field.
3. The inactivity kill resolves with `aborted: false` (it uses its own
   AbortController, not the combined user/timeout signal), so `shell.ts`
   takes `formatNormalOutput` and prints a bare `Signal: 15` field with no
   cause. The agent cannot distinguish tool timeout / user cancel /
   inactivity kill / external signal — exactly the observability gap the
   issue reports.

## Accepted behavior

1. **Inactivity-kill cause (the incident).** When a foreground execution
   resolves with `inactivityTimedOut: true`, the ToolResult carries a
   durable notice in BOTH `llmContent` and `returnDisplay` that:
   - names the cause: the shell tool terminated the command because it
     produced no output for the inactivity-timeout window;
   - names the controlling setting (`shell-inactivity-timeout-seconds`) and
     that `-1` disables it;
   - includes the effective window in seconds when the host exposes
     `inactivityTimeoutMs` (e.g. `120s`);
   - distinguishes it from the `timeout_seconds` total limit;
   - survives summarization/token-limiting (appended after
     `buildToolResult`, per the #3031 clamp / #3517 survivor durable-notice
     pattern).
2. **External/unknown signal cause.** When a foreground execution
   terminates by a signal the tool did NOT initiate (`aborted === false`,
   no inactivity flag, non-null signal), the ToolResult carries a durable
   notice in BOTH fields stating the termination originated outside the
   shell tool — explicitly not a tool timeout, not an inactivity kill, not
   a user cancellation — and referencing the signal number.
3. **Existing cause reporting unchanged.** Tool total-timeout keeps the
   `formatShellTimeoutMessage` cause + effective timeout + clamp notice
   (#3031); user cancellation keeps the "cancelled by user" messaging;
   pre-cancelled keeps its message. Clean results (no signal, no flags)
   stay byte-identical — no new notice fires.
4. **Adapter passthrough.** `CoreShellToolHostAdapter.executeShellCommand`
   maps core's `inactivityTimedOut` onto the tools-layer result type, and
   the adapter's `getShellExecutionConfig()` exposes `inactivityTimeoutMs`
   from core config so the notice can state the effective window.

### Boundary cases

- Inactivity flag + user cancel raced (`aborted: true`, not
  timeoutTriggered): cancel message stands, inactivity notice still
  appended (both facts are true).
- Inactivity flag + total timeout raced: timeout message stands,
  inactivity notice still appended.
- Signal present on an aborted result (timeout or cancel): NO external
  notice — the initiating cause is already reported.
- Signal `0`/null normalized upstream: no notice.
- Tools-layer `signal` is a stringified number (`"15"`) or null; the
  notice renders it without assuming a number type; no `NaN`/`undefined`
  may leak into output when `inactivityTimeoutMs` is absent.
- Windows: notice wording is platform-neutral (no POSIX `kill`
  instructions).
- Background jobs are out of scope (no timeout machinery, #1995 slice 5).

## Changes

### `packages/tools/src/interfaces/IShellToolHost.ts`

- `ShellExecutionResult`: add optional `inactivityTimedOut?: boolean`
  (mirrors the core field; doc comment referencing #3589).
- `ShellExecutionConfig`: add optional `inactivityTimeoutMs?: number`.

### `packages/core/src/tools-adapters/CoreShellToolHostAdapter.ts`

- `executeShellCommand`: pass `inactivityTimedOut: result.inactivityTimedOut`
  through the mapping.
- `getShellExecutionConfig`: include `inactivityTimeoutMs` from
  `this.config.getShellExecutionConfig()`.

### `packages/tools/src/tools/shell-helpers.ts`

- New exported helpers following the durable-notice pattern:
  `buildTerminationCauseNotice(result, inactivityTimeoutMs)` and
  `appendTerminationCauseNoticeToResult(toolResult, result,
  inactivityTimeoutMs)`. Precedence rules from the boundary cases above.
  Wording asserts in tests below; must name `shell-inactivity-timeout-seconds`
  for cause 1 and the not-timeout/not-cancel/not-inactivity distinctions
  for cause 2.

### `packages/tools/src/tools/shell.ts`

- In `executeShell`'s return chain, insert
  `appendTerminationCauseNoticeToResult(...)` inside
  `appendSurvivorNoticeToResult` (cause closest to content), sourcing
  `inactivityTimeoutMs` from `this.host.getShellExecutionConfig()`.

## Test-first sequence and behavioral mapping

All tests are TS/Bun (`bun:test`), co-located, behavioral (no mock
theater). RED must be confirmed for each new behavior before its
implementation.

| # | Failing behavioral test (RED) | Implementation response (GREEN) |
| --- | --- | --- |
| A | `shell-tool.test.ts` (new describe `termination cause reporting @plan:issue3589`): fake host resolves `{aborted: false, inactivityTimedOut: true, signal: '15', exitCode: null}` with `getShellExecutionConfig().inactivityTimeoutMs = 120000` → llmContent AND returnDisplay contain the inactivity cause, the setting name, and the effective `120s`; content distinguishes from `timeout_seconds`. | Interface field + helper + wiring (causes 1, 4). |
| B | Same host but `trySummarizeOutput` returns `'SUMMARIZED OUTPUT'` (mirror of the #3517 durability test) → notice survives in llmContent after summarization replaces the field list. | Durable append after `buildToolResult`. |
| C | Inactivity result with host config lacking `inactivityTimeoutMs` → cause + setting name still present; output contains no `NaN`/`undefined`. | Optional-window fallback wording. |
| D | External-signal result `{aborted: false, signal: '15', exitCode: null}` (no inactivity flag) → notice in BOTH fields states the signal originated outside the shell tool, mentions signal `15`, and explicitly says not a tool timeout / not an inactivity kill / not a user cancellation; durable under summarization. | External-cause branch of the helper. |
| E | Clean result `{aborted: false, exitCode: 0, signal: null}` → no termination-cause notice anywhere (byte-identical guard). | No-op on clean path. |
| F | User-cancel result with `signal: '15'` → cancel message stands, NO external notice. | Precedence rule. |
| G | Timeout result (existing `createTimeoutAbortingHost` pattern) → timeout message stands, NO external notice, existing timeout tests unchanged. | Precedence rule. |
| H | `CoreShellToolHostAdapter.test.ts`: real silent command (e.g. `sleep 5`) through `adapter.executeShellCommand` with ephemeral `shell-inactivity-timeout-seconds` small (1s) → resolved result has `inactivityTimedOut: true`; adapter `getShellExecutionConfig()` exposes the corresponding `inactivityTimeoutMs`. | Adapter passthrough (behavior 4). |

## Verification

- Targeted per-file bun runs for every touched test file; repeat runs for
  the tool test file.
- Full cycle on the final tree: `npm run test`, `npm run lint`,
  `npm run typecheck`, `npm run format`, `npm run build`.
- Smoke test: `bun scripts/start.ts --profile-load stepfun-37 "write me a
  haiku and nothing else"` — NOTE: StepFun subscription was cancelled
  (2026-09-13); if the profile no longer authenticates, record that and
  substitute a `bun scripts/start.ts --version` startup check plus the
  earliest available working profile, documenting the substitution.
- Long shell commands (>2 min) are SIGTERM'd by an external watchdog on
  this machine: launch with `nohup ... &` and poll, never long foreground
  runs.
- OCR is currently disabled by Andrew until further notice — do not run
  `ocr` for this issue; subagent review rounds only (max 2).

## Out of scope / follow-ups

- Reclassifying inactivity/external-signal results as `error` in
  `buildExecutionError` (success/error semantics unchanged).
- Background-job termination-cause reporting (no timeout machinery).
- Signal-name mapping (`15` → `SIGTERM`).
- Any change to timeout enforcement itself (the issue explicitly does not
  establish a timeout-enforcement defect).
- Touching the `returnedInfo` field-list docs (notices follow the
  clamp/survivor appended-prose precedent, which is not listed there).

## Verification evidence (2026-09-13)

- RED→GREEN: impl stashed → 11 fail / 28 pass (exit 1); restored → green.
- Targeted: `shell-tool.test.ts` + `shell-tool-termination-cause.test.ts`
  41 pass / 0 fail / 215 assertions (multiple repeat runs, incl. by
  reviewer). Adapter test 17 pass ×2.
- Review round 1 (deepthinker): PASS-with-findings, no code defects; two
  In-scope-Fix test-strength findings (token-limit durability; exact-equality
  clean fixture) — both remediated (tests only), round 2 verified RESOLVED.
- Lint gate: post-remediation `shell-tool.test.ts` exceeded the 800-line
  max-lines rule; the issue-#3589 describe block moved mechanically to
  `packages/tools/src/__tests__/shell-tool-termination-cause.test.ts`
  (329 lines; original back to 800; no test logic changed). Bounded fix to
  keep CI green; no rule weakened.
- Full cycle on final tree: `npm run test` all packages green (432/432,
  643/643, 403/403, isolated lanes 13/13, 7/7, 33/33, 21/21, 13/13, 7/7;
  the only `(fail)` lines are intentional runner fixtures);
  LINT=0, TYPECHECK=0, FORMAT=0, BUILD=0.
- Smoke: StepFun cancelled 2026-09-13 — substituted `bun scripts/start.ts
  --version` → 0.12.0 (startup path verified; profile-load unusable).
- OCR: not run (disabled by Andrew until further notice).
- Logs: tmp/verify3589/ (red-check, cycle1-3, full-test-final{,2}).
