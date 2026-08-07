# Issue #3087 — Public `AgentEvent` stream emits `done` before tool activity, and twice on tool turns

## 1. Defect

`packages/agents/src/api/eventAdapter.ts` maps an inner `AgentEventType.Finished`
straight to a public `done`. `Finished` means "this **model iteration** ended",
not "the agentic turn ended":

- `packages/agents/src/core/turn.ts` emits `Finished` for every provider chunk
  carrying a `finishReason`, including tool-call turns.
- `TodoContinuationService.shouldDeferStreamEvent` defers `Finished`;
  `MessageStreamOrchestrator._finishWithToolCalls` flushes the deferred events
  at the end of the model iteration — i.e. **before** `AgenticLoop` schedules
  the turn's tools.
- The adapter's `Finished` branch yields `makeDone(...)` unconditionally, so a
  second iteration produces a second `done`. Only the loop-end synthesis path
  is guarded by `!state.emittedDone`.

Observed public order for one tool call followed by a normal finish:

    tool-call get_info
    done reason=stop            <- premature
    tool-status get_info:validating/scheduled/executing/success
    tool-result get_info
    done reason=stop            <- duplicate

The same defect shape exists for `AgentEventType.AgentExecutionStopped`, which
`MessageStreamOrchestrator._finishWithToolCalls` can emit from the AfterAgent
hook immediately after the deferred `Finished` and still before tool
scheduling. Its adapter branch also yields `done` unconditionally, so a
hook-clearing turn emits two `done` events **both** before tool activity.

## 2. Accepted behavior

**Contract:** `mapLoopStream` emits **at most one** `done`, and when it is
emitted it is the **final** public event of the stream.

Concretely:

- `AgentEventType.Finished` no longer yields `done`. It records the
  `FinishedValue` (`reason`, `usageMetadata`, `stopReason`) in adapter state.
- `AgentEventType.UserCancelled` no longer yields `done`. It records the
  pending done reason `aborted`.
- `AgentEventType.AgentExecutionStopped` no longer yields `done`. It records
  `lastStop` and the pending done reason `hook-stopped`.
- The existing loop-end synthesis becomes the **single** `done` emitter. Its
  reason is `pendingDoneReason ?? mapFinishReason(lastFinished?.stopReason)`,
  i.e. a stronger terminal reason (`error`, `context-overflow`, `max-turns`,
  `loop-detected`, `aborted`, `hook-stopped`) wins over the `Finished`-derived
  `stop` / `refusal`, exactly as the synthesis path already does today.
- The `done` payload keeps carrying `finished` (from the most recent
  `Finished`) and `stop` (from the most recent `AgentExecutionStopped`) — the
  same `makeDone` projection used today. One refinement is required to keep
  the payload equivalent: a provider reports `usageMetadata` only on the
  iterations whose terminal chunk carries token counts, and with one `done`
  per iteration consumers kept the last **defined** usage (see `drainToResult`
  in `agentBootstrap.ts`). `state.lastFinished` therefore carries the most
  recently reported `usageMetadata` forward when a later `Finished` reports
  none, so collapsing to a single `done` cannot blank token accounting. A
  later `Finished` that *does* report usage still overrides it.
- The emission gate is unchanged: `sawActivity || pendingDoneReason !== null`.
  A stream consisting solely of a non-terminal `AgentExecutionBlocked` still
  yields **no** `done`; an entirely empty stream still yields no `done`.
- `state.emittedDone` becomes unreachable once every branch defers, so it is
  removed rather than left as a dead guard. The `if (pub.type === 'done')`
  book-keeping in `mapLoopEvent` goes with it.

**Consumer follow-through required by the issue (in scope):**

- `packages/cli/src/observation/observationTap.ts` — `endTurn` now runs after
  the turn's tool results, so a successful `todo_pause` **is** observable at
  turn close. The `user_input` wait moves back into `endTurn` (published after
  `turn.ended`, preserving today's ordering). The `onStreamSettled` seam and
  its `lastOutcome` bookkeeping, which existed only because `done` was early,
  are removed along with `observeTurnSettled` in
  `packages/cli/src/observation/jspWiring.ts` and its `useSubmitQuery.ts`
  call site.
- The characterization test
  `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.todoPause.test.ts`
  ("emits the terminal done BEFORE the todo_pause tool-result …") pinned the
  defect. It is rewritten to assert the corrected ordering.
- `packages/cli/src/ui/hooks/useAgentStream-test-helpers.ts` and
  `packages/agents/src/api/__tests__/helpers/eventAdapterStatic.ts` mirror the
  private `AdapterState`; both are updated to the new shape.

## 3. Explicitly out of scope

- Changing when `turn.ts` emits `Finished`, when
  `TodoContinuationService.shouldDeferStreamEvent` defers it, or when
  `MessageStreamOrchestrator._finishWithToolCalls` flushes it. The inner
  stream keeps its per-iteration semantics; only the **public** projection
  changes.
- Whether `AgentExecutionStopped` should stop the `AgenticLoop` (today it does
  not appear in `isTerminalStreamOutcome`). Only its `done` projection moves.
- Accumulating `usageMetadata` across iterations. `state.lastFinished` already
  keeps only the most recent `Finished` today, and today's terminal `done` for
  a multi-iteration turn already carries that same most-recent value.

## 4. Boundary cases the tests must cover

| Case | Expected public stream |
| --- | --- |
| One tool call, then a normal finish (2 model iterations) | exactly one `done{stop}`, strictly after every `tool-call` / `tool-status` / `tool-result` |
| Turn ended by a successful `todo_pause` | exactly one `done{stop}`, strictly after the `todo_pause` `tool-result` |
| Single iteration, `Finished` only | one `done{stop}` (unchanged) |
| `Finished` with `stopReason: 'refusal'` | one `done{refusal}` carrying `finished.stopReason === 'refusal'` (unchanged) |
| `Finished` with a non-refusal `stopReason` | one `done{stop}` carrying that `stopReason` (unchanged) |
| `UserCancelled` | one `done{aborted}`, last (unchanged reason) |
| `AgentExecutionStopped` | one `done{hook-stopped}` carrying `stop`, last (unchanged reason) |
| `AgentExecutionStopped` emitted on a tool iteration (hook context-clear) | exactly one `done{hook-stopped}`, after the tool events |
| `Error` / `StreamIdleTimeout` / `ContextWindowWillOverflow` / `LoopDetected` / `MaxSessionTurns` | one `done` with the stronger reason, last (unchanged) |
| `Error` then a later `Finished` | one `done{error}` (the stronger pending reason still wins) |
| `AgentExecutionStopped` then a later `Finished` | one `done{hook-stopped}` (the explicit terminal signal stays authoritative) |
| Content-only stream, no terminal event | one synthesized `done{stop}`, last (unchanged) |
| Standalone `AgentExecutionBlocked` only | **no** `done` (unchanged) |
| Empty loop stream | **no** events at all (unchanged) |
| `Finished` with usage, then a `Finished` without | the `done` carries the earlier reported usage |
| `Finished` with usage, then a `Finished` with different usage | the `done` carries the later usage |

## 5. Test plan (test-first, behavioral, per dev-docs/RULES.md)

All new/changed tests use `bun:test` (via `packages/agents/src/testApi.ts`
inside the agents package). No mock theater: the ordering tests drive the real
`AgenticLoop` with a real `CoreToolScheduler` and a real `MessageBus`; only the
provider stream is scripted.

1. **`packages/agents/src/core/agenticLoop/__tests__/agenticLoop.todoPause.test.ts`**
   - Replace the characterization test with:
     "emits exactly one terminal done AFTER the todo_pause tool-result through
     mapLoopStream (issue #3087)" — asserts `done` count is 1 and its index is
     greater than the pause `tool-result` index and is the last event.
2. **New `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.doneOrdering.test.ts`**
   - Real loop + real scheduler, one normal tool call then a clean finish:
     asserts exactly one `done`, that it is the final event, and that every
     `tool-call` / `tool-status` / `tool-result` precedes it.
3. **`packages/agents/src/api/__tests__/event-adapter-projection.spec.ts`** —
   synthetic `AgenticLoopEvent` streams through the real `mapLoopStream` for
   the table in §4, including the `AgentExecutionStopped`-on-a-tool-iteration
   case, the `Error`-then-`Finished` and
   `AgentExecutionStopped`-then-`Finished` precedence cases, the empty stream,
   and both usage-carry-forward cases.
4. **`packages/cli/src/observation/observationTap.test.ts`** — rewritten pause
   tests drive the corrected ordering (`tool-call`, `tool-status`,
   `tool-result`, then `done`) and assert `turn.ended:completed` is published
   before `wait.opened:user_input`, with no `onStreamSettled` call.

## 6. Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
