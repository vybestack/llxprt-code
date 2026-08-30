# Issue #3132 — Guard against duplicate content records across compression boundaries

## Status of the original hypothesis

The issue assumed the bug had already been fixed incidentally, and proposed an
identity guard in `HistoryService.addInternal` keyed on `callId` / `turnId`.

Both assumptions are wrong. Empirical probe against `HEAD`
(f80a695f3) using the real `HistoryService` + `RecordingIntegration` +
`SessionRecordingService` stack:

| Probe                                                  | Expected | Actual |
| ------------------------------------------------------ | -------- | ------ |
| `clear()` + re-`add()` of 5 items OUTSIDE a compression lock | 5 records | **10 records** |
| `clear()` + re-`add()` of 3 items INSIDE a compression lock  | 3 records | 3 records |

Recorded chronology seqs on the failing probe: `[1,2,3,4,5,1,2,3,4,5]`.
In-memory history after the rebuild: 5 items, seqs `[1,2,3,4,5]`.

So:

- The bug **still reproduces at HEAD**. Acceptance criterion 3 resolves to its
  second branch: "the bug is shown still to reproduce and is fixed."
- In-memory history is **not** duplicated at rebuild time, because `clear()`
  runs first. A guard in `HistoryService.addInternal` would never fire. The
  duplication exists only in the emitted `contentAdded` stream and therefore
  only in the recorded JSONL.

## Why the duplicates matter

`ReplayEngine.handleContent` (`packages/core/src/recording/ReplayEngine.ts:197-210`)
does `acc.history.push(content)`. A file containing duplicate `content` records
replays into genuinely doubled in-memory history on resume, which is then
re-sent to the model. That is the harm the issue describes, reached through
resume rather than through the live turn.

## Root cause

`RecordingIntegration.onContentAdded` records every `contentAdded` event unless
`compressionInProgress` is true. `compressionInProgress` is driven solely by
`compressionStarted` / `compressionEnded`.

`HistoryService` emits `contentAdded` for every `add()`, including the re-`add()`
half of a wholesale history rebuild. Rebuild paths that run **outside** a
`startCompression()` / `endCompression()` window therefore re-record content
that is already in the file:

- `packages/agents/src/compression/pendingContextWindowEnforcement.ts:455-467`
  — hard-limit truncation fallback. Runs mid-turn immediately after a
  compression. This matches the issue's evidence exactly: contiguous
  `ai tool_call` / `tool tool_response` blocks, each duplicated exactly twice,
  with a `compressed` event between the copies.
- `packages/agents/src/compression/providerContentEnforcement.ts:645-686`
  `restoreHistory` — `clear()` + `addAll()`.
- `packages/agents/src/core/ConversationManager.ts:585-600` `setHistory`.
- `packages/agents/src/core/client.ts:578-602` `resetChat` /
  `619-686` `restoreHistory`.

`RecordingIntegration` is the only consumer of `contentAdded` in the repo
(`grep "'contentAdded'"` finds no other subscriber), so a guard there is a
complete fix for the observable defect.

## Accepted behavior

**AB-1.** `RecordingIntegration` writes a given content record at most once per
session file. A `contentAdded` whose identity is already present in the
recording is a re-add from a wholesale history rebuild and is not written
again.

**AB-2.** Identity is the chronology `seq` paired with a fingerprint of the
exact payload. Suppression can therefore only ever discard content that is
byte-identical to a record already written. Content carrying no chronology
marker has no identity and is always recorded.

**AB-3.** Identity state is scoped to the `SessionRecordingService` the
integration wraps, not to a subscription, and is seeded on
`subscribeToHistory` from the history already present on the service. Resume,
fork, and session seeding all attach to a file that already contains that
content, so a later rebuild must not append it. Re-subscribing the same
service does not forget what was already written.

**AB-4.** No change to compression behavior, to the recording format, or to
resume semantics. Compression still suppresses via `compressionInProgress`;
`compressed` records are unchanged; `replaceAll` still emits no `contentAdded`.

### Why `seq` alone is not a sufficient identity

An earlier draft suppressed on a monotonic high-water mark of `seq` alone.
That is unsound, and the suite now has a regression test for each way it fails:

- `seq` is unique only within one `HistoryService` instance
  (`IContent.ts:71-76`), and `merge()` can import entries from a foreign
  chronology.
- `ChronologyStamper.inherit` (`historyChronology.ts:92-95`) deliberately gives
  a *different* replacement payload the replaced entry's marker, which density
  optimization relies on.
- `validateAndFix` mints a `seq` for a synthetic entry and splices it without
  emitting `contentAdded` (`HistoryService.ts:1037-1057`), so a `seq` can be
  consumed without ever being recorded.

Pairing `seq` with a payload fingerprint removes all three failure modes: a
record is suppressed only when an identical one is already in the file.

### Accepted trade-off

Identity state is proportional to the number of distinct content records in the
session rather than O(1). The largest session observed in the issue holds
28,417 records, which costs a few megabytes against a 195 MB file. Losing
records to a cheaper guard is not an acceptable trade for that.

## Boundary cases covered by tests

Every test asserts on the real JSONL file written by a real
`SessionRecordingService` into a temp directory, plus `ReplayEngine` output
and live `HistoryService` contents where relevant. Each row lists the mutation
the test detects, verified by running the suite against that mutation.

| Test                                             | Detects                                   |
| ------------------------------------------------ | ----------------------------------------- |
| Wholesale rebuild recorded once (reproducer)      | guard removed                             |
| Compression between turns                         | over-suppression of new turns             |
| Content arriving mid-compression kept in history  | over-suppression / history loss           |
| Truncation-fallback rebuild after a compression   | guard removed                             |
| Retry crossing a compression boundary             | guard removed                             |
| Marker reused by a different payload              | `seq`-only identity (silent record loss)  |
| Resumed session rebuild                           | guard removed; identity not seeded        |
| Content with no chronology marker                 | over-suppression of unidentifiable content|
| Replacement `HistoryService` with restarting seqs | `seq`-only identity                       |
| Same `HistoryService` re-subscribed               | identity reset on re-subscribe            |

Against the unmodified code 5 of the 10 fail; against the rejected `seq`-only
watermark 3 of the 10 fail. No test passes unconditionally.

## Files changed

- `packages/core/src/recording/RecordingIntegration.ts` — the guard.
- `packages/core/src/recording/RecordingIntegration.compressionBoundary.test.ts`
  — new behavioral regression suite (new file; `RecordingIntegration.core.test.ts`
  is already 450 lines and covers a different concern).

## Out of scope — file separately

Found while probing, not fixed here:

1. `HistoryService.endCompression()` called without a summary never emits
   `compressionEnded`, so `RecordingIntegration.compressionInProgress` stays
   `true` for the rest of the session and **all subsequent content recording
   silently stops**. Reached live from
   `CompressionHandler.performCompression:676-683` on `noop` and `failed`
   outcomes. Probe: 1 recorded content where 2 were expected.
2. An `add()` that arrives mid-compression before a rebuild's queued `clear()`
   is silently wiped by that clear during the `endCompression` flush, losing
   conversation content. Probe: the mid-turn item is absent from history
   afterwards.

## Verification

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```
