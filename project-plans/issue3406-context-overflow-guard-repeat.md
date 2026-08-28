# Issue #3406 — Context-overflow guard repeats three times and cannot compress

## Problem statement

A user on `claudecode:claude-opus-5` saw the context-overflow guard printed three
times in a row inside a single submit:

```
Sending this message (135262 tokens) might exceed the remaining context window limit (134144 tokens). ...
Sending this message (135382 tokens) might exceed the remaining context window limit (134144 tokens). ...
Sending this message (135382 tokens) might exceed the remaining context window limit (134144 tokens). ...
```

`/compress` then reported nothing to compress, and continuing produced the guard
again. The user's objection is precise: "3 times means it retrying without
compressing and its retrying on the guard not on an error".

## Root cause (proven from source)

`Turn` maps `ContextOverflowError` to a `ContextWindowWillOverflow` event and
returns (`packages/agents/src/core/turn.ts:567-576`).

`MessageStreamOrchestrator._processStreamIteration` yields that event and then
calls `handleTerminalEvent` (`MessageStreamOrchestrator.ts:562-575`).
`handleTerminalEvent` only recognises `AgentEventType.Error` and
`AgentEventType.InvalidStream`; every other event falls through as non-terminal
(`MessageStreamTerminalHandler.ts:458-490`).

An overflow turn emits no `ToolCallRequest`, no `Content` and no `Thought`, so
`state.hadToolCallsThisTurn`, `hadContent` and `hadThinking` are all false
(`MessageStreamOrchestrator.ts:545-548`). `_evaluatePostTurn` therefore skips the
tool-call and thinking-only branches and reaches `_evaluateTodoContinuation`
(`MessageStreamOrchestrator.ts:600-651`). With an active todo or a pending
tool-call reminder, that method increments `retryCount` and resubmits
(`MessageStreamOrchestrator.ts:667-713`).

`_runRetryLoop` is bounded by `MAX_RETRIES = 3` and runs for retry counts 0, 1
and 2 (`MessageStreamOrchestrator.ts:443-492`). That is exactly three model
attempts and exactly three guard messages. The ~120-token jump between the first
and later attempts matches `todoContinuationService.applyPendingReminder` adding
the todo reminder on the resubmitted request (`MessageStreamOrchestrator.ts:464-465`).

The same event-classification omission exists one level up:
`isTerminalStreamOutcome` in `packages/agents/src/core/agenticLoop/AgenticLoop.ts:80-87`
lists `Error`, `StreamIdleTimeout`, `UserCancelled` and `LoopDetected` but not
`ContextWindowWillOverflow`, so collected tool-call requests are not dropped and
tool scheduling is not disabled after an overflow (`AgenticLoop.ts:487-497`).

The public API layer already treats overflow as terminal: `eventAdapter` sets
`state.pendingDoneReason = 'context-overflow'`
(`packages/agents/src/api/eventAdapter.ts:363-375`). The two internal loops are
the outliers.

### Numbers check

`buildContextOverflowError` reports
`estimatedRequestTokenCount = finalProjected - completionBudget` and
`remainingTokenCount = marginAdjustedLimit - completionBudget`
(`packages/agents/src/compression/contextOverflowError.ts:36-71`).
`262144 - 128000 = 134144`, matching the reported remaining budget exactly for a
262,144-token context limit with the Claude Code 128,000-token output
reservation. The arithmetic in the guard is correct; the overflow itself is real
(1,118 tokens over on the first attempt).

## Second root cause: the last-resort truncator measures the wrong thing

The reporter's other complaint — "it should have either compressed or truncated a
tool call" — is a separate, provable defect.

Hard-limit enforcement runs five reduction stages. On this configuration each one
declines:

1. **Density optimization** returns immediately: the default strategy is
   middle-out, which has no `optimize()` and is threshold-triggered rather than
   continuous (`MiddleOutStrategy.ts:86-93`, `CompressionHandler.ts:187-203`).
2. **Compression** runs, but middle-out needs 4 messages in its compressible
   middle (`MINIMUM_MIDDLE_MESSAGES`) and its no-op routes to one-shot, which
   needs 4 too (`MINIMUM_COMPRESS_MESSAGES`). Those are message-count guards, so
   a handful of very large messages passes straight through both.
3. **Compression retry** is skipped: the provider path converts a structural
   NOOP into a `compressionFailure` (`providerContentEnforcement.ts:436-449`) and
   the retry is gated on `compressionFailure === undefined` (lines 466-470).
4. **TopDownTruncation fallback** — the defect.
5. **Tool-response truncation** only has candidates when the bulk sits in
   `tool_response` blocks.

`TopDownTruncationStrategy.ts:52-59` decided whether to act with:

```ts
const target = compressionThreshold * contextLimit * 0.6;
if (currentTokenCount <= target) return this.structuralNoop(originalCount, 'already-under-target');
```

`currentTokenCount` is `historyService.getTotalTokens()` — committed history only
(`compressionContextBuilder.ts:53`). The enforcer that invoked it needs the
finalized prompt envelope (system prompt + tool schemas + committed history +
pending content) under `marginAdjustedLimit`, with `completionBudget` reserved.
`CompressionContext` had no field to carry the real deficit
(`core/compression/types.ts:139-177`), so the strategy invented its own yardstick
and was never told how many tokens had to go.

On the reported session:

```
context limit          262,144
completion budget      128,000
enforcer input budget  134,144   (matches the reported "remaining" exactly)
reported input         135,262   → over by 1,118
TopDown's own target   0.85 × 262,144 × 0.6 = 133,693
```

TopDown refuses unless committed history alone exceeds 133,693, but the whole
envelope has to fit in 134,144. The 451-token gap is far smaller than the system
prompt plus tool schemas, so committed history is essentially always under
TopDown's target by the time the finalized payload is over budget. The last-resort
truncator structurally refuses in exactly the situation it exists to rescue.

### Fix

`CompressionContext` gains an optional `targetTokenCount`, set only by hard-limit
enforcement, which is the only layer that knows the real deficit. TopDown prefers
it and keeps its ephemeral target when absent, so threshold-triggered compression
is unchanged. Both enforcers compute it through one shared helper,
`computeHistoryTruncationTarget(projected, marginAdjustedLimit, historyTokens)` in
`contextLimitPolicy.ts`: truncation can only remove committed history, so the
target is the current history total less the overage. No arbitrary safety cushion
— the enforcer re-projects afterwards and still falls through to tool-response
truncation when it comes up short.

### Additional acceptance criteria

**AC6 — Explicit target honoured.** TopDownTruncation truncates when given an
explicit `targetTokenCount` below `currentTokenCount`, even when its own
ephemeral target says it is already under.

**AC7 — No target, no change.** With no explicit target the strategy behaves
exactly as before.

**AC8 — Provider path recovers.** When the finalized envelope overflows while
committed history is under the ephemeral target, `ProviderContentEnforcer.enforce`
resolves with contents that fit instead of throwing ContextOverflowError.

**AC9 — 413 recovery path recovers.** Same for `PendingContextWindowEnforcer`
when the pending request supplies the overage.

**AC10 — Requests that fit are untouched.** Neither enforcer truncates history
when the request is already within budget.

### Still NOT treated as defects

- The guard's token arithmetic. It is correct for the configured context limit
  and completion budget.
- `/compress` returning NOOP. Manual compression sees only curated committed
  history, and middle-out and one-shot both require a minimum number of
  compressible messages, so a truthful structural no-op is reachable. Changing
  strategy minimums is a different, unproven change.
- `TopDownTruncationStrategy` returning `kind: 'applied'` with unchanged history
  when `finalRemoveCount === 0`. A truthfulness wart with no proven user-visible
  symptom.

## Acceptance criteria

**AC1 — Overflow ends the turn.** When a turn's stream yields
`AgentEventType.ContextWindowWillOverflow`, `MessageStreamOrchestrator` ends the
current submit immediately. With an active todo present, exactly one
`ContextWindowWillOverflow` event is emitted and `Turn.run` is invoked exactly
once (today: three of each).

**AC2 — Overflow ends the turn with a pending tool-call reminder.** Same as AC1
when `todoContinuationService.toolCallReminderLevel !== 'none'` and there are no
active todos.

**AC3 — Terminal bookkeeping still runs.** The overflow terminal path flushes any
deferred events and fires the AfterAgent hook, emitting
`AgentExecutionStopped` with `contextCleared: true` when the hook asks to clear
context — matching the existing `Error` / `InvalidStream` terminal paths
(`MessageStreamTerminalHandler.ts:393-456`).

**AC4 — No tool scheduling after overflow.** `AgenticLoop` treats
`ContextWindowWillOverflow` as a terminal stream outcome: collected tool-call
requests are discarded and no tool is executed.

**AC5 — No regression for non-overflow turns.** A turn with active todos and no
overflow still continues up to `MAX_RETRIES`; `Error` and `InvalidStream`
handling, including the 413 recovery path, is unchanged.

### Boundary cases to cover

- Overflow with no active todos and no reminder: still exactly one guard (must
  not regress; this already works today).
- Overflow arriving after a `ToolCallRequest` in the same turn: the turn still
  terminates and no tools are scheduled.
- Deferred events present when overflow arrives: they are flushed, not dropped.

## Test plan (write these first, watch them fail)

All new tests are `bun:test`, TypeScript, behavioral.

1. `packages/agents/src/core/MessageStreamOrchestrator.contextOverflow.test.ts`
   (new). Drives the real `MessageStreamOrchestrator` with a mocked `Turn.run`
   that yields a `ContextWindowWillOverflow` event and a fresh generator per
   call (use `mockImplementation`, not `mockReturnValue`, so repeat attempts are
   observable). Mirror the dependency harness in
   `MessageStreamOrchestrator.todoPause.test.ts:122-281`.
   - AC1: active todo present → assert `mockTurnRun` call count is 1 and the
     collected events contain exactly one `ContextWindowWillOverflow`.
   - AC2: no active todos but `toolCallReminderLevel: 'warning'` → same
     assertions.
   - AC3: AfterAgent hook returns `shouldClearContext() === true` → assert an
     `AgentExecutionStopped` event with `contextCleared: true` is emitted after
     the overflow event.
   - AC5 guard: a non-overflow turn (content + finished) with an active todo
     still produces more than one `Turn.run` invocation.

2. `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.terminal-outcomes.test.ts`
   (existing). Add `ContextWindowWillOverflow` to the existing `it.each` terminal
   table at lines 41-68 so the "does not execute collected tools after %s" case
   covers it. This satisfies AC4 with zero new harness code.

## Implementation plan

1. `packages/agents/src/core/MessageStreamTerminalHandler.ts`: add a
   `handleContextWindowOverflowEvent` generator that logs, flushes
   `deferredEvents`, runs `fireAfterHookAndEmitClearContext`, and returns
   `earlyIterResult(state.hadToolCallsThisTurn, { ...state, deferredEvents })`.
   Dispatch to it from `handleTerminalEvent` for
   `AgentEventType.ContextWindowWillOverflow`. The overflow event itself has
   already been yielded by the caller, so the handler must not re-yield it.
2. `packages/agents/src/core/agenticLoop/AgenticLoop.ts`: add
   `type === AgentEventType.ContextWindowWillOverflow` to
   `isTerminalStreamOutcome`.

No other production files change. No new public abstractions, no dependency,
workflow or settings changes.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and the `stepfun-37` smoke prompt.
