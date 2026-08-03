# Issue #2942 — BeforeTool hook exiting 2 with empty stderr fails open

## Problem

`HookRunner.parseHookOutput` (`packages/core/src/hooks/hookRunner.ts`) only converts a
non-zero hook exit into a `HookOutput` when `stderr.trim()` is non-empty:

    } else if (exitCode !== EXIT_CODE_SUCCESS && stderr.trim()) {

A hook that exits `2` and writes nothing to stderr therefore produces `output === undefined`.
`HookAggregator.aggregateResults` only collects `result.output`, so `finalOutput` stays
undefined, and `checkHookDecision` in `packages/agents/src/scheduler/tool-executor.ts`
(which reads only `shouldStopExecution()` / `isBlockingDecision()`) never fires. The tool
executes. Exit code 2 is the documented blocking signal, so this fails open on a security
control.

## Decision

A **blocking** exit code is authoritative on its own. `parseHookOutput` no longer requires
stderr to produce a blocking decision:

- exit `2`, stderr present → `{ decision: 'deny', reason: <stderr> }` (unchanged)
- exit `2`, stderr empty → `{ decision: 'deny', reason: 'Hook exited with code 2 without an error message' }`
- other non-zero, stderr present → `{ decision: 'allow', systemMessage: 'Warning: <stderr>' }` (unchanged)
- other non-zero, stderr empty → `undefined` (unchanged)

Explicit sub-decisions:

- The behavior is **not** gated on event name. Non-zero exit with non-empty stderr already
  produces a deny for every event; empty stderr must behave identically. Gating on
  `BeforeTool` only would create a second, divergent code path.
- A default message is synthesized **only** for the blocking exit code. Synthesizing an
  output for every non-zero exit would make a silent exit-`1` hook emit
  `{ decision: 'allow', … }`, and `HookAggregator.mergeWithFieldReplacement` (used by
  `BeforeModel` / `AfterModel`) lets a later `allow` overwrite an earlier `deny`. A hook
  that says nothing must not be able to manufacture a permissive decision.
- Exit `1` therefore stays non-blocking and stays silent when it writes nothing, matching
  `EXIT_CODE_NON_BLOCKING_ERROR`.
- Exit `0` is untouched: the stdout JSON path, the double-encoded JSON path, the
  plain-text-to-`systemMessage` path, and the empty-stdout `undefined` result are unchanged.
  Empty stderr on exit `0` never reaches the non-zero branch.
- Timeout and spawn-error results are out of scope; they take different code paths
  (`timeoutResult` / `errorResult`) and the issue does not cover them.

## Acceptance criteria

1. `BeforeTool` hook exiting `2` with empty stderr and empty stdout blocks the tool and
   surfaces the default reason.
2. `BeforeTool` hook exiting `2` with a stderr message still blocks, using that stderr text
   as the reason (unchanged).
3. Hook exiting `1` with empty stderr remains non-blocking and produces no output.
4. Hook exiting `1` with stderr text remains non-blocking with `Warning: <stderr>` (unchanged).
5. Exit code `0` behavior is unchanged in every existing case.

## Test plan (tests first)

### `packages/core/src/hooks/hookRunner.exitCode.test.ts`

Behavioral tests that run real hook processes through `HookRunner.executeHook(...)` (same
style as `hookRunner.windows.test.ts`), asserting on `result.output`:

- exit `2`, no output → `{ decision: 'deny', reason: 'Hook exited with code 2 without an error message' }`; `success === false`, `exitCode === 2`.
- exit `2`, stderr `'denied by policy'` → `{ decision: 'deny', reason: 'denied by policy' }`.
- exit `1`, no output → `output === undefined`, `exitCode === 1`.
- exit `1`, stderr text → `{ decision: 'allow', systemMessage: 'Warning: <text>' }` and not a blocking decision.
- exit `0`, no output → `output === undefined`.
- exit `0`, plain-text stdout → `{ decision: 'allow', systemMessage: <text> }`.

### `integration-tests/hooks/hooks-e2e.integration.test.ts`

Real hook script (`process.exit(2)` with no output) fired through
`HookSystem.getEventHandler().fireBeforeToolEvent(...)`; assert the aggregated result is a
blocking decision with the default reason.

### `integration-tests/hooks-system.test.ts`

Rig-level `BeforeTool` test reusing `hooks-system.block-tool.responses`: hook script exits 2
with no stderr; assert no successful `write_file` tool call in the tool logs, that the target
file was never created, and that hook telemetry carries the synthesized deny reason.

## Out of scope

- Changing `HookAggregator` or `checkHookDecision`.
- Making timeouts or spawn failures fail closed.
- Parsing stdout on non-zero exits.
- Any documentation rewrite (handled by #2937).
