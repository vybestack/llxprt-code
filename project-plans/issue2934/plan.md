# Issue #2934 — Make rewind position-independent

`/chat clear` and `/chat restore N` record a rewind as a bare item **count**.
The count is computed against the live history but replayed against the
replay-accumulated history. Density optimization
(`HistoryService.applyDensityResult`, driven by the `high-density` compression
strategy) shrinks live history without emitting any journal event, so the two
arrays diverge and the recorded count removes the wrong number of items on
`--continue`.

Fix: record the **chronology identity of the cut point** alongside the count,
and have replay cut at that marker instead of by offset.

## Scope

In scope, and nothing else:

- `packages/core/src/recording/types.ts` — add one optional field to
  `RewindPayload`.
- `packages/core/src/recording/SessionRecordingService.ts` — `recordRewind`
  accepts and writes the optional cut marker.
- `packages/core/src/recording/HistoryMutationService.ts` — read the cut item's
  chronology `seq` and pass it to `recordRewind`.
- `packages/core/src/recording/ReplayEngine.ts` — `handleRewind` resolves the
  cut by marker when present, falling back to the count when it is not.
- Behavioural tests for all of the above.

Explicitly OUT of scope (do not touch):

- Journaling density or tool-truncation mutations in general (see #1393).
- The persist-then-commit ordering in `HistoryMutationService.applyMutation()`
  — the issue states it is correct and must be left alone.
- The pre-existing lossiness of `compressed` replay (replay collapses to
  `[summary]` while live history keeps a preserved head/tail). Not caused by
  this change and not fixed by it.
- Any change to `computeClearCut` / `computeRestoreCut` cut selection.

## Design

### Recording side

`RewindPayload` gains one optional field:

```ts
export interface RewindPayload {
  /** Positive integer — number of items removed from the end of history. */
  itemsRemoved: number;
  /**
   * Chronology `seq` of the FIRST removed item, when the cut point carried a
   * chronology marker. Replay cuts at the first item whose marker `seq` is
   * >= this value, which stays correct even when live history and the journal
   * have diverged (e.g. density removed items without journalling them).
   * Absent on legacy events and whenever the cut item has no marker.
   */
  cutSeq?: number;
}
```

`SessionRecordingService.recordRewind(itemsRemoved: number, cutSeq?: number)`
omits `cutSeq` from the payload entirely when it is `undefined`, so a rewind
recorded without a resolvable marker is byte-identical to today's event.

`HistoryMutationService.applyMutation` reads
`removed[0]?.metadata?.chronology?.seq`. It passes the value through only when
it is a non-negative safe integer; otherwise it records count-only exactly as
today.

Why the FIRST REMOVED item and not the last retained item: it is the boundary
the cut is defined by, and the journal is append-only, so an item that was in
live history when the cut was computed is also in the replayed history.

### Replay side

`handleRewind` keeps its current `itemsRemoved` validation (non-number or
negative is malformed; warn and skip; history unchanged). Then:

1. If `cutSeq` is present but not a non-negative safe integer → record the
   corruption and warn, then apply the count. Discarding the whole event would
   leave the removed turns in the replayed history, which is the symptom the
   marker exists to prevent, and the count is what a journal without a marker
   already replays by.
2. If `cutSeq` is present and valid → find the entry whose
   `metadata.chronology.seq` EQUALS `cutSeq`.
   - Found at index `i` → `acc.history = acc.history.slice(0, i)`.
   - Not found → fall back to the count.
3. If `cutSeq` is absent → today's behaviour, unchanged:
   `slice(0, length - itemsRemoved)`, clamped to empty.

The match must be exact. A neighbouring marker is not evidence of where the cut
belongs, because an unmarked entry can sit on either side of it. Two real
histories are only partly marked:

- A session recorded before chronology markers existed and then resumed:
  `performResume` loads the old unmarked entries through
  `HistoryService.replaceAll`, which stamps them in memory only. The journal
  keeps them unmarked while later turns are journalled with markers. A cut
  inside that prefix has no marker to find.
- A `compressed` summary can reach the journal unmarked, because the entry
  stamped into live history is a copy of the one handed to `recordCompressed`.

In both, cutting at the nearest later marker would leave removed turns in place
(the first case) or strand the summary that a restore-all should have cleared
(the second). Falling back to the count reproduces exactly what those files
replay to today, so neither case regresses.

Neither case is fixable within this issue's scope: identifying an unmarked
journal entry needs the unjournalled mutations of #1393.

## Acceptance criteria

Numbering follows the issue.

**AC1 — restore survives resume under density.**
Record a session, apply a density result that removes items from live history
(emitting no journal event), run `/chat restore N` through
`HistoryMutationService`, replay the file from disk. The replayed history equals
the live post-restore history.

**AC2 — clear survives resume under density.**
Same setup, `clear()` instead of `restore()`. Replayed history equals the live
post-clear history; no cleared turn reappears.

**AC3 — backwards compatibility.**
A session file whose rewind event carries only `itemsRemoved` (no `cutSeq`)
replays exactly as it does today. Covered both by an explicitly hand-written
legacy fixture line and by the existing `historyMutation.integration.test.ts`
and `ReplayEngine.accumulation.test.ts` suites, whose fixtures have no
chronology markers and therefore must keep taking the count path.

**AC4 — behavioural end-to-end.**
Record → density → restore → replay, asserting the replayed history matches the
live post-restore history exactly (identity of every entry, by chronology
`seq` and by text), not merely by length.

**AC5 — token total after resume matches the total at quit.**
Feed the replayed history and the live post-restore history through the same
`HistoryService` token estimation and assert the totals are equal. This follows
from AC1/AC4 (equal histories give equal totals) but is asserted directly
because it is the user-visible symptom in the issue.

### Boundary cases that must be covered by tests

- `cutSeq` refers to an item that density REPLACED (`chronology.inherit`
  preserves the marker): the match finds the replacement at the same position.
- `cutSeq` names an entry that predates chronology markers (resumed legacy
  session): falls back to the count rather than cutting at a later marker.
- `cutSeq` names an entry a `compressed` event destroyed: falls back to the
  count rather than stranding the summary.
- Replayed history contains no chronology markers at all but the rewind carries
  a `cutSeq`: falls back to the count.
- Replayed history is empty when the rewind is applied: stays empty, no throw.
- Malformed `cutSeq` (negative, non-integer, `NaN`, string, `null`): rewind is
  skipped with a warning and history is unchanged.
- Rewind removes ALL history (restore N greater than the number of human
  turns): `cutIndex` is 0, `cutSeq` is the first item's seq, replay produces an
  empty history.
- Cut item has no chronology marker: `cutSeq` is omitted from the payload;
  count path is used; recorded JSON has no `cutSeq` key.

## Test plan (test-first)

All tests are `bun:test`, TypeScript, real files on a real temp dir, real
`SessionRecordingService` / `ReplayEngine` / `HistoryService`. No mocking of
any component under test. Density is applied through the real
`HistoryService.applyDensityResult` with a real `DensityResult`, so the test
reproduces the exact divergence the issue describes rather than simulating it.

New file: `packages/core/src/recording/rewindChronology.integration.test.ts`

1. `restore under density replays to the same history that is live after the
   restore` (AC1, AC4).
2. `clear under density does not resurrect cleared turns on replay` (AC2).
3. `token total after replay equals the token total after the live restore`
   (AC5).
4. `cut point removed by density still cuts at the next surviving item`.
5. `cut point replaced by density is matched through the inherited marker`.
6. `rewind whose cutSeq exceeds every replayed marker removes nothing`.
7. `rewind with cutSeq against an unmarked history falls back to the count`.
8. `rewind on an empty replayed history leaves it empty`.
9. `restore of more turns than exist empties the replayed history`.
10. `a cut item without a chronology marker records no cutSeq` (asserts the
    serialized JSON has no `cutSeq` key, then replays via the count).

Extend `packages/core/src/recording/ReplayEngine.replay.test.ts` (it already
owns the malformed-rewind cases) with malformed-`cutSeq` variants: negative,
fractional, `NaN`, string, `null` — each skipped with a warning, history
unchanged.

Extend `packages/core/src/recording/SessionRecordingService.test.ts` (it
already owns `rewind event contains itemsRemoved count`) with:

- `rewind event carries cutSeq when provided`.
- `rewind event omits cutSeq when not provided`.

`packages/core/src/recording/replay-test-helpers.ts::rewindLine` gains an
optional `cutSeq` argument so replay tests can write both shapes.

## Review triage

Round 1 (deepthinker) findings and disposition:

| Finding | Severity | Disposition |
| --- | --- | --- |
| A cut inside a legacy unmarked prefix resolved to the first later marked entry, resurrecting removed turns | HIGH | **Blocker-Fix.** Replaced the `>=` scan with exact-marker resolution plus count fallback. Regression guard: `falls back to the recorded count when the cut entry predates chronology markers`. |
| Restore-all after a `compressed` reset stranded an unmarked summary where the count rule emptied history | HIGH | **Blocker-Fix.** Same change. Regression guard: `falls back to the recorded count when a compressed event destroyed the cut entry`. |
| Tests omitted both mixed marked/unmarked histories | MEDIUM | **In-scope-Fix.** Both are now covered by the two guards above; each was confirmed to fail under the rejected `>=` rule. |
| Content chronology markers were accepted as any number while `cutSeq` required a safe integer | LOW | **In-scope-Fix.** Resolved by construction: `cutSeq` is validated once, and exact equality against it rejects both a missing marker and a nonsensical one, so no second predicate is needed. |
| Comment asserted `computeRestoreCut` always cuts at a human item, which is false when more turns are requested than exist | LOW | **In-scope-Fix.** Comment corrected to the property actually relied on (the journal is append-only). |

Open Code Review round 1 findings and disposition:

| Finding | Severity | Disposition |
| --- | --- | --- |
| A malformed `cutSeq` discarded the whole rewind, leaving the removed turns in the replayed history | HIGH | **In-scope-Fix.** The corruption is now warned about and counted, and the rewind still applies by count. |
| `RewindPayload` doc said replay cuts at the first marker that "reaches" `cutSeq` while the code matches exactly | MEDIUM | **In-scope-Fix.** Doc corrected, and the fallback conditions spelled out. |

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, plus
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing
else"`.
