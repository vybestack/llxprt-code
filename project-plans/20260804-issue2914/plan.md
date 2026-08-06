# Issue #2914 — Observation tap: a tool-result event overwrites a prior cancelled tool phase

## Problem

`routeToolEvent` in `packages/cli/src/observation/observationTap.ts` maps a
`tool-result` event to a headline tool phase based solely on `isError`:

```ts
target.onToolPhaseChanged(
  label,
  event.result.isError === true ? 'failed' : 'succeeded',
);
```

If a preceding `tool-status` event already reported the tool as `cancelled`, the
subsequent non-error `tool-result` overwrites that phase with `succeeded`, so a
cancelled tool is published to JSP/1 observers as having completed successfully.

## Required design decisions (from the issue)

### 1. Can a cancelled tool still emit a terminal `tool-result`?

**Yes.** `packages/agents/src/api/eventAdapter.ts` `mapLoopEvent` emits:

- `tool-status` for every `ToolCall` in a loop `tool_update` event
  (`projectToolUpdate`), including `status: 'cancelled'`; and
- `tool-result` for **every** `CompletedToolCall` in a `tools_complete` event
  (`projectToolResult`), with no filtering of cancelled calls.

So the canonical event stream does deliver `tool-status(cancelled)` followed by
a terminal `tool-result` for the same call id.

### 2. Is `isError` a reliable cancellation signal?

**No.** `projectToolResult` computes:

```ts
isError:
  x.status === 'error' ||
  (x.status === 'cancelled' && x.outcome === ToolConfirmationOutcome.Cancel),
```

A tool cancelled by abort (signal/turn cancellation) rather than by an explicit
user `Cancel` confirmation outcome yields `isError: false`. That is precisely
the reported failure mode: `cancelled` -> `succeeded`.

### 3. What is the correct terminal phase?

**The first terminal phase observed for a tool call wins.** `succeeded`,
`failed` and `cancelled` are all terminal in `JspToolPhase`. Once a tool call
has been reported in a terminal phase, no later event for that same call id may
change it — neither a redundant terminal event (the `cancelled` -> `succeeded`
bug) nor a stale non-terminal event (which would resurrect a completed tool as
`executing`).

This is safe against genuine disagreement: `tool_update` and `tools_complete`
project the **same** `ToolCall` object, so a status/result disagreement can only
arise from the `isError` derivation above, where `tool-status` carries the more
faithful value.

## Implementation

File: `packages/cli/src/observation/observationTap.ts`

1. Add a module-level predicate:

   ```ts
   function isTerminalPhase(phase: JspToolPhase): boolean {
     return phase === 'succeeded' || phase === 'failed' || phase === 'cancelled';
   }
   ```

2. Extend `TurnScope` with per-tool terminal tracking:

   ```ts
   interface TurnScope {
     readonly toolLabels: Map<string, string>;
     readonly awaitingConfirmation: Set<string>;
     /** Call ids that already reported a terminal phase this turn. */
     readonly terminalTools: Set<string>;
   }
   ```

3. In `routeToolEvent`:
   - **`tool-status` branch**: call `mapToolStatus` exactly **once** (it is
     currently called twice) and store it in a local. If
     `scope.terminalTools.has(event.update.id)`, do **not** call
     `onToolPhaseChanged`. Otherwise emit the phase and, when
     `isTerminalPhase(phase)`, add the id to `scope.terminalTools`.
     The pending-approval bookkeeping (`awaitingConfirmation.delete` +
     `onWaitResolved`) must run **unconditionally**, i.e. it must not be
     skipped by terminal suppression, or a suppressed event could strand a wait.
   - **`tool-result` branch**: if `scope.terminalTools.has(event.result.id)`, do
     **not** call `onToolPhaseChanged`. Otherwise emit
     `isError === true ? 'failed' : 'succeeded'` and record the id as terminal.
     The existing `toolLabels.delete` and pending-approval bookkeeping stay
     unconditional.

4. In `createObservationTap`, initialise `terminalTools: new Set<string>()` and
   clear it in `resetTurnScopedState()` alongside `toolLabels` /
   `awaitingConfirmation`, so the suppression is turn-scoped and cannot leak
   into a later turn (and cannot grow for the life of the session).

Add a short comment explaining *why* terminal phases are sticky (the `isError`
derivation above), not *what* the code does.

No changes to `jspProducerState.ts` / `jspProducer.ts`: the defect is entirely
in the tap's event->phase mapping.

## Tests

File: `packages/cli/src/observation/observationTap.test.ts`

This file already runs **Bun-native only** — it is registered in
`scripts/bun-test-manifest.ts` and excluded from Vitest discovery by
`packages/cli/vitest.test-groups.ts` (`'**/src/observation/**/*.test.ts'`).
It currently still imports from `'vitest'` via Bun's shim.

**Conversion requirement:** change the import to `import { describe, expect, it }
from 'bun:test';`. No new Vitest/Node tests. Do not add the file to any Vitest
config. Do not change `bun-test-manifest.ts` (already listed) or
`vitest.test-groups.ts` (already excluded).

Behavioral tests to add (real `createObservationTap`, real `AgentEvent`
payloads, recording target — no mocks of the unit under test):

1. **cancelled survives a non-error tool-result** — `tool-call`,
   `tool-status(cancelled)`, `tool-result{isError: false}`. Assert the recorded
   phase changes for the tool are exactly `['cancelled']` and that
   `succeeded` never appears.
2. **cancelled survives an error tool-result** — `tool-status(cancelled)` then
   `tool-result{isError: true}`. Assert `failed` is not emitted after
   `cancelled`.
3. **a terminal phase is not resurrected by a later non-terminal status** —
   `tool-status(error)` then `tool-status(executing)`. Assert only `failed` is
   recorded.
4. **first terminal wins across two disagreeing terminal statuses** —
   `tool-status(cancelled)` then `tool-status(success)`; only `cancelled`.
5. **normal success is unaffected** — `tool-call`, `tool-status(executing)`,
   `tool-result{isError: false}` still reports `succeeded`; and
   `tool-result{isError: true}` alone still reports `failed`. This guards
   against the suppression over-firing.
6. **suppression is turn-scoped** — cancel tool id `tool-1` in turn 1, start a
   new turn, replay `tool-call` + `tool-result{isError:false}` for the same id,
   and assert `succeeded` **is** emitted in turn 2.
7. **terminal suppression does not strand a wait** — `tool-call`,
   `tool-confirmation` (wait opened), `tool-status(cancelled)` (wait resolved
   once), then `tool-result{isError:false}`; assert exactly one
   `wait.resolved` and no `succeeded` phase.

Keep the existing tests passing unchanged (notably the full canonical-event
ordering assertion and the `ToolUpdateStatus` -> `JspToolPhase` mapping table).

## Verification (all must pass)

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/run_bun_tests.ts --workspace cli
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```
