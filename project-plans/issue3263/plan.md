# Plan: Session recording stops permanently after a no-op or failed compression

Issue: #3263
Branch: `issue3263`

## Problem (verified at HEAD)

`RecordingIntegration` suppresses `contentAdded` while its private
`compressionInProgress` flag is `true`, and clears that flag only in its
`compressionEnded` handler. `HistoryService.endCompression()` emits
`compressionEnded` only when given both a summary and an `itemsCompressed`
count. `CompressionHandler.performCompression` ends compression in three
shapes:

- `applied` → `endCompression(summary, preCompressionCount)` → emits
  `compressionEnded` → flag cleared. OK.
- `noop` → `endCompression()` → no event → flag stuck `true` forever.
- `failed` → `endCompression(undefined, preCompressionCount)` → no event →
  flag stuck `true` forever.

Once stuck, every subsequent `content` record for the rest of the session is
silently dropped; the session file stops growing and resume loses everything
after the failed compression.

Probe at HEAD (real `HistoryService` + `RecordingIntegration` +
`SessionRecordingService`, `tmp/issue3263-probe/probe.ts`):

- noop shape (`startCompression(); endCompression()`): content=1, expected 2.
- failed shape (`endCompression(undefined, 5)`): content=1, expected 2.
- applied shape (`endCompression(summary, 5)`): content=2, compressed=1 (correct).

## Fix direction (from the issue)

Clear the suppression flag on a signal that ALWAYS fires when the compression
lock is released, rather than on the summary-bearing `compressionEnded` event.
Emitting `compressionEnded` unconditionally is explicitly rejected: the
`compressed` record must stay suppressed on a no-op (#2602), and `compressionEnded`
carries the summary payload semantics.

## Accepted behavior (acceptance criteria)

### AC-1: HistoryService emits a lock-release signal on every endCompression

`endCompression()` — in every argument shape (no args, summary-less, full
summary) — emits a new `compressionLockReleased` event, after the pending
operations queue is drained. `compressionEnded` remains conditional on
summary + itemsCompressed exactly as today.

### AC-2: Recording survives a no-op-shaped compression end (issue reproduction)

Real `HistoryService` + `RecordingIntegration` + `SessionRecordingService`:
`add(before)`, `startCompression()`, `endCompression()`, `add(after)` → the
recording file contains exactly 2 `content` records (`before` and `after`) and
0 `compressed` records.

### AC-3: Recording survives a failed-shaped compression end

Same as AC-2 but `endCompression(undefined, 5)` → 2 `content` records, 0
`compressed` records. Repeated no-op cycles in sequence also keep recording
(each cycle's post-compression content is recorded).

### AC-4: Applied compression behavior is unchanged

Going through the real `endCompression(summary, count)` with content queued
during the compression window: the flushed rebuild/queued content is still
suppressed (no duplicate content records), exactly one `compressed` record is
written, and post-compression content is recorded. This pins the emission
order: pending-queue drain first (still inside the suppression window), then
`compressionLockReleased`, then the conditional `compressionEnded`.

### AC-5: Subscription hygiene unchanged

`compressionLockReleased` listener is registered in `subscribeToHistory` and
removed in `unsubscribeFromHistory` (no listener leak, flag reset on
unsubscribe). Existing semantics of `unsubscribeFromHistory`, `dispose`, and
`onHistoryServiceReplaced` are unchanged. `onCompressionEnded` still clears
the flag itself so direct `compressionEnded` emissions (as existing tests do)
behave identically.

## Boundary cases

- `endCompression()` without a preceding `startCompression()` (unbalanced):
  `compressionLockReleased` still fires; harmless when flag was already false.
- Content queued during compression and flushed by a no-op-shaped
  `endCompression()`: stays suppressed this cycle (consistent with the applied
  path, where flushed rebuild content is suppressed); the NEXT content after
  the release is recorded (AC-2/AC-3).
- Multiple sequential no-op cycles: flag cleared on every release.

## Out of scope (explicitly)

- Whether external content queued during the compression window should be
  recorded (adjacent to #3132 duplicate-content territory; loss window is the
  compression duration only, not permanent).
- Any CompressionHandler changes; its three `endCompression` call shapes stay.
- ReplayEngine / resume behavior changes (correct recording fixes resume input
  data going forward).
- Emitting `compressionEnded` unconditionally or changing its payload types.

## Files

- `packages/core/src/services/history/HistoryService.ts` — emit
  `compressionLockReleased` in `endCompression()` after the queue drain.
- `packages/core/src/services/history/historyEventTypes.ts` — add
  `on`/`emit`/`off` overloads for `compressionLockReleased`.
- `packages/core/src/recording/RecordingIntegration.ts` — subscribe a handler
  that clears `compressionInProgress`; unsubscribe it symmetrically.
- Tests:
  - `packages/core/src/services/history/compression-locking.test.ts` —
    lock-release signal always fires, ordering relative to queue drain and
    `compressionEnded`, `compressionEnded` still conditional.
  - `packages/core/src/recording/RecordingIntegration.core.test.ts` — AC-2,
    AC-3, AC-4 behavioral tests through the real HistoryService API.

## Test plan (TDD; bun tests, real components, no mocks)

1. HistoryService level (compression-locking.test.ts):
   - argless `endCompression()` emits `compressionLockReleased`, not
     `compressionEnded`.
   - failed-shape `endCompression(undefined, n)` same.
   - summary-shape emits both.
   - ordering: queued `add` flushed first, then `compressionLockReleased`,
     then `compressionEnded` (record observed event order via public emitter).
   - unbalanced `endCompression()` still emits the signal.
2. RecordingIntegration level (core test, through real service API):
   - AC-2 noop shape: 2 content, 0 compressed.
   - AC-3 failed shape: 2 content, 0 compressed; sequential noop cycles.
   - AC-4 applied shape through real endCompression: [before, after] content
     texts, 1 compressed, queued-during content suppressed.

## Verification

Full cycle per the issue workflow: `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, and the stepfun-37
smoke test; then OCR (max 2 rounds), PR, CI watch, CodeRabbit triage.

## Review triage

Findings classified as Blocker-Fix / In-scope-Fix / Reject / Defer; reviewer
suggestions do not authorize scope expansion.

## Implementation notes

Changed files:

- `packages/core/src/services/history/historyEventTypes.ts` — added
  `on`/`emit`/`off` overloads for the new `compressionLockReleased` event
  (`() => void` listener), mirroring `compressionStarted`.
- `packages/core/src/services/history/HistoryService.ts` — `endCompression()`
  now emits `compressionLockReleased` after the pending-queue drain and before
  the conditional `compressionEnded`; doc comment updated.
- `packages/core/src/recording/RecordingIntegration.ts` — new
  `onCompressionLockReleased` handler clears `compressionInProgress`;
  registered/unregistered symmetrically in `subscribeToHistory`. The existing
  flag-clear in `onCompressionEnded` is kept so direct `compressionEnded`
  emissions behave as before.
- `packages/core/src/services/history/compression-locking.test.ts` — new
  `compressionLockReleased event` describe: argless/failed/summary shapes,
  flush→lockReleased→ended ordering, unbalanced endCompression.
- `packages/core/src/recording/RecordingIntegration.core.test.ts` — new tests
  in `Compression-aware filtering`: noop shape (AC-2), failed shape + repeated
  noop cycles (AC-3), applied shape through the real API with a queued add
  suppressed (AC-4).

RED evidence: with the three production files reverted (git stash of
production only), 8 of the 9 new tests fail:

- 5 in `compression-locking.test.ts` (lock-release event absent).
- 3 in `RecordingIntegration.core.test.ts` (post-noop/failed content lost).
- The applied-shape ordering guard passes on main by design — it pins
  unchanged behavior (AC-4).

Reproduction probe (`tmp/issue3263-probe/probe.ts`, real components): before
the fix noop/failed shapes recorded content=1 (expected 2); after the fix all
three shapes record content=2, with `compressed=1` only for the applied shape.
