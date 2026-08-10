# Issue 3169 — Fresh prompt can remain queued during cancelled-turn teardown

## Problem (verified against source at `main` b45e8cdd7)

`useCancellation` (`packages/cli/src/ui/hooks/agentStream/useAgentStreamLifecycle.ts:237-260`)
synchronously:

1. `setTurnCancelled(true)`
2. `drainSuppressedRef.current = true`
3. `abortControllerRef.current?.abort()`
4. `setIsResponding(false)`

`useStreamingState` (same file, lines 35-56) then reports `Idle`, because
`turnCancelled === true` makes outstanding tool calls count as settled.

The cancelled turn's `submitQuery` invocation, however, still owns
`activeTurnRef` — it is only released in the outer `finally` of
`useSubmitQueryCallback` (`useSubmitQuery.ts:650-660`) after `runStream`
settles asynchronously.

So a fresh prompt B submitted in that window hits
`useSubmitQuery.ts:606-618`:

```
if (current.activeTurnRef.current || isQueueable(current.streamingState)) {
  if (fromQueue) return 'requeue';
  current.enqueueSubmission({ query, promptId });   // appended to the BACK
  return 'consumed';                                // early return
}
current.activeTurnRef.current = true;
current.drainSuppressedRef.current = false;         // NEVER REACHED
```

Two defects result:

- **D1 (stuck prompt).** `drainSuppressedRef` is never cleared, so when A
  finally settles and the `finally` calls `scheduleNextQueuedSubmission`,
  `useScheduleNext` (`useSubmitQuery.ts:536-548`) rejects the drain because
  `drainSuppressedRef.current` is still `true`. B remains in the drawer until
  the user presses Enter on empty input, which routes through
  `sendAllQueuedSubmissions` (`useAgentStreamOrchestration.ts:313-316`) — the
  only place that clears suppression for queue-originated work.
- **D2 (ordering).** B is appended to the back of the queue, so if pre-cancel
  entries Q1/Q2 were preserved, an unsuppressed drain would run Q1, Q2, B.
  The issue requires B (the explicit resume intent) to run first.

Ownership analysis: `drainSuppressedRef.current === true` can only be observed
by a *fresh* (`!fromQueue`) submission when no live fresh turn has started
since the cancellation, because

- `drainSuppressedRef` is set `true` only by `useCancellation`;
- `useCancellation` early-returns unless `streamingState` is
  `Responding`/`WaitingForConfirmation` and `!turnCancelledRef.current`, so it
  cannot re-fire before a new turn's `initTurn` resets `turnCancelled`;
- the only paths that clear it are the fresh-turn path in
  `useSubmitQueryCallback` and `sendAllQueuedSubmissions`.

Therefore `drainSuppressedRef.current === true && streamingState` not queueable
is a sound, non-speculative signature for "acknowledged cancellation, teardown
possibly still pending".

## Accepted behavior

**AB1.** A fresh (non-queue-originated) ordinary submission that arrives while
drain is suppressed by an acknowledged cancellation and the public streaming
state is not `Responding`/`WaitingForConfirmation` is treated as explicit
intent to resume: it is placed at the **front** of the queued-submission store
and cancellation drain-suppression is **cleared**.

**AB2.** That prompt reaches the agent exactly once, automatically, once the
cancelled turn's aborted stream settles and releases active-turn ownership. No
second Enter is required.

**AB3.** Existing stream serialization is unchanged: the resume prompt does not
start while the cancelled turn still owns `activeTurnRef`, so no two agent
loops run concurrently.

**AB4.** Pre-cancel queued entries are preserved by cancellation itself and are
not run merely because cancellation occurred. After a fresh post-cancel
submission they drain once each, in FIFO order, **after** the resume prompt.

**AB5.** Queue-originated retry attempts (`fromQueue === true`) still return
`'requeue'` before any resume handling: they must not clear suppression nor
bypass active-turn ownership.

**AB6.** No behavior change for: ordinary submission during a genuinely live
turn (`streamingState === Responding` → append to back, keep suppression state
as-is), Ctrl+Enter steering, slash/shell queue restrictions, empty-Enter queue
release, empty-Backspace queue clearing, queued-message steering, and the
`#2259`/`#2296`/`#2882`/`#2954`/`#3048` regression suites.

## Design (minimal, at the current owner)

### Change 1 — `useQueuedSubmissions.ts`

Extract the existing `queueId` assignment into a small local helper and add one
front-insertion operation that assigns a fresh `queueId` (unlike
`requeueSubmission`, which intentionally re-inserts an already-identified item
for retry):

```ts
const enqueueSubmissionFirst = (submission: QueuedSubmission): void => {
  setQueuedSubmissions((prev) => [withQueueId(submission), ...prev]);
};
```

Export it from the hook. `types.ts` is unchanged.

### Change 2 — `useStreamState.ts` / `useAgentStreamOrchestration.ts`

Thread `enqueueSubmissionFirst` through `UseStreamStateReturn` and
`buildSubmitQueryDeps` into `UseSubmitQueryDeps`. No new subsystem.

### Change 3 — `useSubmitQuery.ts`

In `useSubmitQueryCallback`, inside the existing queue branch and strictly
after the `fromQueue` guard:

```ts
if (isResumeAfterAcknowledgedCancellation(current)) {
  current.enqueueSubmissionFirst({ query, promptId });
  current.drainSuppressedRef.current = false;
  return 'consumed';
}
current.enqueueSubmission({ query, promptId });
return 'consumed';
```

with

```ts
function isResumeAfterAcknowledgedCancellation(
  deps: SubmitQueryCallbackDeps,
): boolean {
  return (
    deps.drainSuppressedRef.current && !isQueueable(deps.streamingState)
  );
}
```

No new scheduling call is added: the branch is only reachable because
`activeTurnRef.current === true`, and that turn's `finally` already calls
`scheduleNextQueuedSubmission` after verifying `isCurrentTurn`. Adding a
redundant schedule here would be speculative hardening.

## Behavioral tests (Bun + `bun:test`, written first, must fail before the fix)

New file:
`packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.cancelResumeRace.bun.tsx`

It renders the **real** `useSubmitQuery` together with the **real**
`useCancellation` and the **real** `useQueuedSubmissions` store (not the
fixture stub) so queue state, drain reservation, suppression, and stale-turn
guards are exercised for real. Only the Agent/provider boundary is faked, via a
deferred `runStreamRef` that lets the test hold the aborted stream unresolved.

### T1 — primary race

1. Submit A; assert `runStream` called once and `setIsResponding(true)`;
   rerender with `Responding`.
2. `cancelOngoingRequest()`; assert `turnCancelledRef.current === true`,
   `setIsResponding(false)`, A's signal aborted, and the `Request cancelled.`
   history item added. Rerender with `Idle`.
3. Keep A's `runStream` promise unresolved. Submit B.
4. Assert `runStream` still called once (no concurrent second iterator).
5. Resolve A's stream.
6. Assert `runStream` called exactly twice with B's query and the drawer/queue
   is empty — with **no** additional `sendAllQueuedSubmissions`/empty-Enter
   call.
7. Resolve B; assert queue empty and responding released.

### T2 — queue preservation, priority, exactly-once

1. Submit A; rerender `Responding`; submit Q1 and Q2 (both queued).
2. Cancel A, hold its stream unresolved, rerender `Idle`.
3. Assert Q1 and Q2 still queued and `runStream` still called once (cancellation
   alone does not run them).
4. Submit B.
5. Resolve A, then resolve each subsequent turn's stream in order.
6. Assert observed `runStream` query order is exactly `A, B, Q1, Q2`, each once.

### T3 — timing counterpart (teardown wins)

Cancel A, resolve A's stream *before* submitting B, then submit B: assert B runs
directly (fresh path), queue stays empty, order `A, B`.

### T4 — suppression preserved for queue-originated retry

With suppression `true`, active turn held, invoke the executor via
`submitQueryRef.current(..., fromQueue = true)`: assert it returns `'requeue'`
and `drainSuppressedRef.current` is still `true`.

### T5 — live-turn submission unchanged

With `streamingState === Responding` and suppression `false`, a fresh
submission is appended to the **back** of the queue (existing behavior), and
suppression remains `false`.

### T6 — cancellation alone still preserves the drawer

Reuses the `#2882` invariant against the real store: after cancel with queued
entries and no fresh submission, the queue is unchanged and no drain occurs.

Also add to `useQueuedSubmissions.test.ts`: `enqueueSubmissionFirst` inserts at
the front, assigns a fresh unique `queueId`, and updates both the ref and the
reactive state.

## Non-goals (explicitly out of scope)

- No changes to providers, `AgenticLoop`, queue storage semantics beyond the one
  front-insert operation, the scheduler algorithm, or retry policy.
- No change to steering, slash/shell handling, drawer presentation, input
  history, prompt restoration, or paste handling.
- No auto-drain caused by Escape/Ctrl+C alone.
- No defensive teardown wrappers, no swallowed errors, no extra redundant
  schedule calls.
- The separate pre-`Responding` Escape readiness gap is not addressed here.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
