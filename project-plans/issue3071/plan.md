# Issue #3071 — `todo_pause` must open a `user_input` wait on the observation channel

## Problem

When the model calls `todo_pause` successfully, `AgenticLoop.buildNextMessage`
returns `{ continueLoop: false }` and the stream finishes with `done: 'stop'`.
`observationTap.mapDoneReason` maps that to the turn outcome `completed`, so the
only thing an observer (jefe) receives is a normal successful `turn.ended`.
An agent that gave up and is blocked on a human is indistinguishable from an
agent that finished its work.

`wait.opened` had exactly one production emitter: `onWaitOpened('permission')`
on a tool-confirmation prompt. The `user_input` reason in the JSP contract had
never been emitted.

## Design decision (already decided, kept)

**Only an explicit blocked pause opens a `user_input` wait. A normal return to
the prompt does not.**

Emitting `user_input` unconditionally on every `turn.ended` would collapse the
distinction between "the agent finished and is idle" and "the agent gave up and
needs you". The second is the one that must pull attention, and it is exactly
what `todo_pause` means. So the wait is opened only when a successful
`todo_pause` tool result was observed in the turn that just settled.

## The dead-code defect this design fixes

The first uncommitted attempt opened the wait from `endTurn` (right after
`onTurnEnded`). That never fired. The real public `AgentEvent` order for a pause
turn, recorded against the real AgenticLoop + real CoreToolScheduler + real
todo_pause MockTool through `mapLoopStream`, is:

```
tool-call todo_pause
done reason=stop            <- turn.ended fires here (EARLY)
tool-status todo_pause:validating
tool-status todo_pause:scheduled
tool-status todo_pause:executing
tool-status todo_pause:success
tool-result name="todo_pause" isError=false
```

`done` arrives BEFORE the tool-result. `turn.ts` emits `AgentEventType.Finished`
whenever the provider chunk carries a finishReason;
`TodoContinuationService.shouldDeferStreamEvent` defers Finished;
`MessageStreamOrchestrator._finishWithToolCalls` flushes the deferred events at
the end of the model iteration — i.e. BEFORE AgenticLoop schedules the tools —
and `eventAdapter.ts` maps Finished to an immediate `done`. So in
`observationTap` `endTurn` runs on the early `done` while the pause tool result
has not yet been observed, and the later tool result sets its flag after
`endTurn` has already become a no-op. The net observable output was
`turn.started, turn.ended:completed, turn.started` — no `wait.opened`.

## Where the change goes

The change spans three CLI files (not `observationTap.ts` alone) plus the
terminal-phase-based success predicate:

1. `packages/cli/src/observation/observationTap.ts` — the hook and predicate.
2. `packages/cli/src/observation/jspWiring.ts` — a wiring export.
3. `packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` — the call site.

No change is needed in `packages/tools/src/tools/todo-pause.ts`, in
`AgenticLoop.ts`'s pause handling, in `TodoContinuationService.ts`, in the JSP
contract, or in the producer. The `done`-before-result ordering in
`packages/agents` is a separate pre-existing defect and is explicitly left
untouched; the tap works with the stream as it actually is.

### The `onStreamSettled` hook (why `endTurn` is the wrong place)

`done` is not the moment control returns to the prompt. The tap exposes a new
`onStreamSettled(): void` on its `ObservationTap` interface, implemented by both
the disabled no-op tap and the real tap. Semantics: the agent stream for the
current turn has fully settled and control has returned to the prompt. If a
successful `todo_pause` was observed during the settled turn AND the recorded
turn outcome was `'completed'` AND no pause wait is already open, it emits
`onWaitOpened('user_input')` and sets the session-scoped `pauseWaitOpen`.

`endTurn` no longer opens the wait. It records the outcome into a closure
variable (`lastOutcome`) before calling `target.onTurnEnded(outcome)`; the wait
opening moves entirely to `onStreamSettled`, which runs after the late tool
result has set `successfulPauseObserved`. `onTurnStarted` resets `lastOutcome`
to `null` alongside the turn-scoped state, so a malformed later stream that
settles without its own terminal `done` cannot reuse a previous turn's
`completed` outcome and open a false wait.

The ordering that makes this work: `resetTurnScopedState()` runs inside
`endTurn` (on the early `done`), i.e. BEFORE the pause tool-result arrives, so
`scope.successfulPauseObserved` is cleared and then re-set by the late
tool-result, and survives until the next `onTurnStarted`. `successfulPauseObserved`
continues to be cleared in `resetTurnScopedState`.

`turn.ended` (published by `endTurn` on the early `done`) and `wait.opened`
(published by `onStreamSettled`) are two separate revisions, so a consumer
sampling between them momentarily sees the idle state. Ordering (`turn.ended`
first) is still correct: the wait must not claim the agent is blocked before
control has actually returned.

### The call site

`packages/cli/src/observation/jspWiring.ts` exports `observeTurnSettled()`,
routed through the existing `isolate()` boundary (the one sanctioned telemetry
swallow), matching the style of `observeTurnStarted` / `observeTurnFailed` /
`observeTurnCancelled`.

`packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` calls
`observeTurnSettled()` in the `finally` block of `runSubmitQueryCore`, guarded
by `isCurrentTurn(cbd, turn.abortSignal)` so a superseded turn cannot open a
wait for a turn that no longer owns the controller.

### The terminal-phase-based success predicate (cancelled-pause false positive)

The previous predicate only checked `isError !== true && errorType === undefined`.
The predicate it claimed to mirror — `hasSuccessfulTodoPause` in `AgenticLoop.ts`
— additionally requires `status === 'success'`. A `todo_pause` cancelled by abort
projects (via `projectToolResult` and `buildCancelledTransition`) to
`isError: false` and `errorType: undefined`, because the abort path leaves error
and errorType unset. So the old predicate counted a cancelled-by-abort pause as
successful. Under the `onStreamSettled` fix this becomes a live false positive
(the early `done` already recorded outcome `'completed'`, so the outcome gate
does not catch it).

The fix makes the tap's notion of success match the scheduler's terminal phase.
`TurnScope.terminalTools: Set<string>` became
`terminalPhases: Map<string, JspToolPhase>`, recording the FIRST terminal phase
seen for each call id (preserving the existing sticky-suppression behavior for
the #2914 tests unchanged). In the tool-result branch the effective terminal
phase is computed as `terminalPhases.get(id) ?? (isError === true ? 'failed' : 'succeeded')`,
and the pause counts as successful only when the correlated label matches
`todo_pause` case-insensitively AND the effective phase is `'succeeded'` AND
`result.isError !== true` AND `result.errorType === undefined`.

The pause check stays OUTSIDE the existing `terminalPhases.has(id)` guard:
production delivers `tool-status:success` BEFORE the tool-result, so guarding it
would suppress every genuine pause.

`isSuccessfulPauseResult` now takes the typed values (resolved label, the typed
tool result, and the effective phase) instead of three loose positionals that
invited an argument swap.

### Tool name resolution

The CLI operative path delivers the pause result via `tools_complete` /
`CompletedToolCall`, which `projectToolResult` projects with the true name
(`todo_pause`) — not the empty name the raw a2a-stream projection carries. So in
the CLI the result name is non-empty and the `toolLabels` correlation is not the
operative path. The `toolLabels` correlation (for a result whose projection
carries `name: ''`) is retained as a fallback for that real-but-non-CLI path;
because the terminal `done` resets turn-scoped state before the result arrives,
intervening `tool-status` updates refresh the call-id→label correlation so the
fallback still functions under the real event ordering.

## Accepted behavior

1. **Open on successful pause, after settle.** When a turn ended with outcome
   `completed` and a successful `todo_pause` tool result was observed during the
   settled turn, `onStreamSettled` emits `onWaitOpened('user_input')`.
2. **Ordering.** `turn.ended` is emitted first (on the early `done`); the wait
   opens after the stream settles. The agent is blocked on the human only once
   control has actually returned to the prompt.
3. **Failed pause opens nothing.** A `todo_pause` tool result with `isError: true`
   or with an `errorType` set does not open a wait.
4. **Cancelled-by-abort pause opens nothing.** A pause whose terminal phase is
   `cancelled` does not open a wait, even though its projected result carries
   `isError: false` and no `errorType`.
5. **Case-insensitive name match**, matching `AgenticLoop.hasSuccessfulTodoPause`.
6. **No pause, no wait.** A turn that ends `completed` without a successful
   `todo_pause` emits no `wait.opened`. Idle is not needs-you.
7. **Only the current turn's `completed` opens the wait.** A turn that ended
   `cancelled` or `failed` (recorded in `lastOutcome`) does not open a pause wait
   even if a successful pause was observed. `lastOutcome` resets at turn start,
   so a stream that settles without its own terminal `done` also opens nothing.
8. **The wait survives the turn boundary.** `pauseWaitOpen` is session-scoped and
   survives `resetTurnScopedState`; that is the entire point — the agent stays in
   needs-you while it sits at the prompt.
9. **Resolved by the next prompt.** On the next `onTurnStarted()`, the tap emits
   `onWaitResolved()` exactly once, before `target.onTurnStarted()`, and clears
   `pauseWaitOpen`. A later turn with no pause emits no further `wait.resolved`.
10. **At most one open per turn.** Duplicate or repeated `todo_pause` tool results
    in a turn, and a duplicate `onStreamSettled` call, produce exactly one
    `wait.opened`.
11. **Permission waits are unaffected.** A pending tool-confirmation stranded at
    turn end still resolves through `resetTurnScopedState` (on the early `done`),
    and the pause wait opens after settle.
12. **Disabled observation stays inert.** `createObservationTap(null)` remains a
    no-op on every path, including `onStreamSettled`.

## Tests (behavioral)

In `packages/cli/src/observation/observationTap.test.ts`, every pause test drives
the PRODUCTION event ordering (tool-call, done, tool-status:success, tool-result)
and the new `onStreamSettled()` hook. The tool-result-before-done ordering does
not appear in any pause test. Coverage:

1. successful `todo_pause` + `done: 'stop'` + status/result + settle → ordered
   calls end with `turn.ended:completed` then `wait.opened:user_input`.
2. `onStreamSettled()` before any pause → no `wait.opened`.
3. result with `isError: true` → no `wait.opened`.
4. result with `errorType` set → no `wait.opened`.
5. cancelled-by-abort: `tool-status:cancelled` + result `isError:false`,
   `errorType:undefined` → no `wait.opened` (the step-2 regression guard; fails
   against a predicate that ignores the terminal phase).
6. `TODO_PAUSE` / mixed case → wait still opens.
7. result whose `name` is `''` but correlates to a `todo_pause` tool-call → wait
   still opens.
8. `done: 'aborted'` / `done: 'error'` with a successful pause → no `wait.opened`;
   a later turn that settles without its own `done` cannot reuse a prior
   `completed` outcome.
9. after the wait is open, the next `onTurnStarted()` emits exactly one
   `wait.resolved` before `turn.started`; a following turn with no pause emits no
   further `wait.resolved`.
10. two successful `todo_pause` results in one turn → exactly one `wait.opened`;
    a duplicate `onStreamSettled()` → still exactly one.
11. a stranded pending confirmation plus a successful pause → `wait.resolved`
    (stranded permission) then `turn.ended:completed` then `wait.opened:user_input`.
12. two consecutive pause turns → the wait resolves and re-opens exactly once each.
13. `createObservationTap(null)` through the whole pause sequence including settle
    throws nothing and emits nothing.

Additionally, `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.todoPause.test.ts`
has a characterization test that runs the real AgenticLoop through `mapLoopStream`
for a `todo_pause` turn and pins the ordering assumption at its source: the
terminal `done` is emitted BEFORE the `todo_pause` tool-result, and the result
carries name `todo_pause` with `isError` false. If that ordering ever changes,
the tap's `onStreamSettled` design must be revisited.

## Out of scope

- Emitting `question`, `elicitation`, `choice` or `other` wait reasons.
- Any `user_input` wait on a normal idle return to the prompt.
- Changing `done` semantics in `packages/agents`.
- Changes to `todo-pause.ts`, `AgenticLoop.ts`'s pause handling,
  `TodoContinuationService.ts`, the JSP contract, or the producer.
