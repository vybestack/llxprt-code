# Debounce Session Stats Updates

## Background / Problem Statement

Running the CLI frequently emits `Warning: Maximum update depth exceeded` originating from `SessionStatsProvider`. Investigation shows the following chain:

1. `useGeminiStream` receives a stream of `ServerGeminiEventType.UsageMetadata` events.
2. For **each** metadata event it calls `addUsage` provided by `SessionStatsProvider`.
3. `addUsage ➜ aggregateTokens ➜ setStats` schedules a React state update.
4. React re-renders _App_, which remounts `useGeminiStream`, the stream loop delivers more buffered `UsageMetadata` events synchronously, and the cycle repeats dozens of times in the same tick.
5. React bails out with _Maximum update depth exceeded_.

Continuous per-event updates are unnecessary – users only need one cumulative update per _turn_ or at a reasonable frequency.

## Proposed Solution

Debounce / batch the updates coming from `addUsage` so that, within a single render/frame, only **one** state update is made regardless of how many `UsageMetadata` events arrive.

### High-level approach

1. **Queue incoming metadata** inside `SessionStatsProvider` rather than updating state immediately.
2. Use `useRef` to accumulate events and a `setTimeout(0)` (or `requestAnimationFrame`) scheduled once per flush cycle.
3. On flush, merge all queued metadata into a single aggregate object, apply `setStats` once, and clear the queue.
4. Ensure the flush timer is cancelled on unmount.

Alternate or complementary options:

- Throttle updates to e.g. 100 ms with a simple timestamp check.
- Accept only the **last** metadata event per render using `useTransition` or `unstable_batchedUpdates`.

## Implementation Steps

1. **Add queue + timer in `SessionContext.tsx`**
   ```ts
   const queueRef = useRef<QueuedUsage[]>([]);
   const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
   ```
2. **Modify `addUsage`** to push into the queue and schedule `flush()` exactly once.
3. **Implement `flush()`**
   - Combine all queued items with `addTokens` into temporary `delta` objects.
   - Call `setStats` _once_ with the aggregated delta.
4. **Cleanup** – clear timer in the provider cleanup function.
5. **Unit tests** in `SessionContext.test.tsx`
   - Verify that 10 consecutive `addUsage` calls result in only one `setStats` update (can spy on `setState`).
   - Verify stats aggregation correctness.
6. **E2E smoke test** – run CLI, confirm no recursion warning appears.

## Risks & Mitigations

| Risk                                                | Mitigation                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Delayed UI update might hide real-time token counts | Flush on **turn end** (`startNewTurn`) and when stream ends to guarantee timely update. |
| Timer never fires if provider unmounts early        | Clear queue in cleanup to avoid memory leak.                                            |

## Acceptance Criteria

- CLI no longer prints “Maximum update depth exceeded”.
- Stats displayed in footer remain correct (validated by tests).
- No measurable performance regression.
