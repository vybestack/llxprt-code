# Issue #2852 — Long-running Bun/Ink memory amplification on macOS

## Status

Plan of record. Supersedes the earlier revision of this document, whose
approach (32-delta UI coalescing) was rejected: it reduced a constant factor
without changing the asymptotic class, and it degraded streaming UX.

## Problem statement

Two distinct phenomenologies were reported:

**(a) Allocator high-water / churn.** Processes showed ~16 GB `ps` RSS against
only ~1.2 GB physical footprint, with ~13 GB of resident-but-**empty**
`MALLOC_SMALL` regions (247 MB dirty). This is the signature of sustained
allocation churn, not live-object retention.

**(b) Native image-surface growth.** An image-bearing resumed session
(377 MB recording, 576 media blocks, 277 MB base64) reached 22.8 GB physical
footprint with ~8.6 GB IOAccelerator/IOSurface. JS-level duplication does not
arithmetically explain this; it requires attribution.

These are treated as separate root causes.

## Confirmed root cause for (a): O(N²) streaming pipeline

For a response of length `L` delivered in `D` deltas, the CLI performs work
proportional to the **entire accumulated response on every delta**, giving
`O(L × D)` — quadratic in the response length. Every stage is implicated:

| Stage | Site | Per-delta cost |
| --- | --- | --- |
| Buffer concatenation | `contentEventProcessor.ts` `combined = currentAiMessageBuffer + eventValue` | O(accumulated) |
| Emoji sanitization | `useStreamState.ts` → `EmojiFilter.filterText(fullText)` (two full scans + copy) | O(accumulated) |
| Safe-split detection | `streamUtils.ts` `buildSplitContent` → `markdownUtilities.ts` `findLastSafeSplitPoint` → `findEnclosingCodeBlockStart` + repeated `isIndexInsideCodeBlock`, each scanning from index 0 | O(accumulated), multiple passes |
| Pending item construction | `buildSplitContent` materializes `fullTextItem` plus `before`/`after` substrings | O(accumulated) |
| Markdown parse | `MarkdownDisplay.tsx` `processLines` splits and regex-matches **all** lines each render | O(accumulated) |
| Agent block accumulation | `modelEnvelope.ts` `[...acc.content.blocks, ...chunk.content.blocks]` | O(blocks) per chunk |

**The dominant case is an unterminated fenced code block** — the normal state
for a coding agent mid-response. `findLastSafeSplitPoint` returns the code
fence's start index, so the entire growing code block stays in the pending
buffer and is rescanned, re-substringed, and re-parsed on every subsequent
delta.

The emoji filter is active by default (`emojifilter` defaults to `auto`, so
`EmojiFilter` is constructed and `filterText` runs on the full text per delta).
A stateful incremental API (`filterStreamChunk` / `flushBuffer`) already exists
in `packages/core/src/filters/EmojiFilter.ts` and is simply not wired into the
UI streaming path.

## Non-negotiable constraints on the fix

1. **No perceptible streaming-UX degradation.** Complexity must be fixed by
   making per-delta work `O(delta)`. Reducing update frequency is explicitly
   *not* the mechanism. The pipeline must remain correct and linear with any
   coalescing removed.
2. **No silent data loss.** Nothing may drop records, buffers, or queued
   operations without the content remaining recoverable and the condition being
   observable.
3. **No lossy loss of legitimate content.** Display-side bounds are acceptable
   only where the full content demonstrably survives elsewhere (core history and
   the on-disk session transcript), and the bound must be labelled to the user.
4. **No new throwing paths that can break a turn.**
5. **Fail fast, not defense in depth.** Fix causes; do not layer guards.
6. **No lint/complexity loosening; no `eslint-disable`, `@ts-ignore`,
   `@ts-expect-error`, `@ts-nocheck`.**

## Work breakdown

### P0 — Remove the rejected coalescing

Delete the 32-delta / newline publication gate. `PendingTextAccumulator`
survives only as an append-only exact-text store used to guarantee the
committed item is byte-exact; it must not gate publication. Every content delta
publishes.

### P1 — Incremental sanitization (O(delta))

Introduce a streaming sanitizer for the UI content path built on
`EmojiFilter.filterStreamChunk` / `flushBuffer`, replacing the whole-text
`filterText` call. Must handle: `allowed` mode short-circuit, `auto`/`warn`
conversions, `error`-mode blocking, `systemFeedback` emission (emitted once per
occurrence, not repeated per delta), and end-of-stream flush so no trailing
buffered text is lost on completion, cancellation, or error.

Equivalence requirement: for any input text and any chunking of it, incremental
sanitization must produce the same final string as `filterText` over the whole
text. Enforced by a property test.

### P2 — Incremental safe-split scanning (O(delta))

Introduce an incremental scanner that carries code-fence state and the last
safe split position forward across deltas, so appending `k` characters costs
`O(k)` rather than `O(accumulated)`. `findLastSafeSplitPoint` remains for
non-streaming callers.

Equivalence requirement: for any markdown corpus and any chunking, the
incremental scanner's split point must equal `findLastSafeSplitPoint` over the
whole text. Enforced by a property test.

### P3 — Stop materializing full text per delta

`contentEventProcessor` / `streamUtils` must append the sanitized delta to the
pending item and only perform substring/split work when the scanner reports an
actual new split point. No `fullTextItem` construction on the non-splitting
path.

### P4 — Bounded pending-render work

`MarkdownDisplay` currently parses every line of the pending text on every
render even though `RenderCodeBlock` later truncates to the viewport. Pending
rendering must be bounded by the available terminal height (parse only what can
be displayed), with fence/context state supplied by the P2 scanner. Behaviour
for non-pending (committed) items and for the unconstrained-height mode must be
unchanged.

### P5 — Rework the rejected retention changes

- **Session recording.** Remove the silent `stopRecording()` on overflow and
  the buffer discard. Restore the append loop in place of the reintroduced
  `[...queue, ...preContentBuffer]` spread. Guarantee the drain is always
  rescheduled and `draining` is cleared on every path, so the queue's bound is
  disk throughput. Emit an observable high-water warning. Test that queue depth
  and bytes return to zero after drain and that no record is dropped.
- **UI history bytes.** Keep the incremental cached-byte accounting. Replace
  silent truncation with an explicit, labelled display bound, and prove by test
  that the full content remains in core history and in the session transcript.
  Replace the `JSON.stringify`-per-iteration binary search with direct byte
  budgeting.
- **Compression queue.** Remove the throw and the queue drain (which discards
  operations). Ensure `isCompressing` is cleared on every path so the queue
  cannot grow unboundedly; emit an observable high-water warning.
- **Live tool output.** Fix the correctness bug where truncation state is
  recovered by searching the content for a magic marker string (tool output
  containing that string corrupts the accumulator). Carry truncation state
  explicitly. Reconcile the inconsistent 1 MiB cap versus 128 KiB retention.

### P6 — Media retention

- Replace `HistoryService.clone()`'s `JSON.parse(JSON.stringify(...))` deep copy
  with structural sharing for immutable media blocks.
- Address per-request data-URI re-materialisation of every retained image.
- Add aggregate retained-session media accounting with an explicit bound and a
  release point; per-request budgets already exist, aggregate does not.
- Add a media dimension to the benchmark using real image files, recording
  IOAccelerator bytes, to either reproduce, attribute, or refute (b).

### P7 — Lifecycle release

- `DebugLogger`: dispose instances and unsubscribe configuration listeners at
  shutdown; confirm namespaces are static (bounded) and fix if not.
- `StreamProcessor`: behavioural tests proving accumulated blocks are released
  on cancel, error, and stall — not only on normal terminal.

### P8 — CI-guardable measurement

The benchmark must not be un-CI'd tooling. Add deterministic
complexity-guard tests that run in the normal suite and assert linear scaling
via instrumented work counters (characters scanned, substrings created), not
wall-clock timing. Retain the macOS `vmmap`/`footprint` benchmark as tooling,
and add the repeated-turn post-GC plateau assertion.

### P9 — Verification

`npm run test`, `lint`, `typecheck`, `format`, `build`, the profile smoke test,
and the tmux TUI harness, plus Open Code Review before push.

## Measured results

`bun scripts/issue-2852-memory-runner.ts <dir> text 4` on macOS/Bun, driving the
real `PendingResponseBuffer` over a 40-paragraph response ending in a 4,000-line
unterminated code fence, four equivalent turns:

| Checkpoint | JSC heap | `ps` RSS | Physical footprint | MALLOC empty dirty | IOAccelerator |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 1.2 MB | 45 MB | 20 MB | 0.1 MB | 4.0 MB |
| turn 1 post-GC | 3.0 MB | 188 MB | 29 MB | 0.1 MB | 3.7 MB |
| turn 2 post-GC | 3.0 MB | 188 MB | 29 MB | 0.1 MB | 3.7 MB |
| turn 3 post-GC | 3.0 MB | 189 MB | 24 MB | 0.1 MB | 3.7 MB |
| turn 4 post-GC | 2.5 MB | 190 MB | 24 MB | 0.1 MB | 3.7 MB |

Post-GC JSC heap growth across the settled turns is 0.03%, so repeated
equivalent turns reach a stable plateau. The run also reproduces the reported
shape in miniature: RSS sits at ~190 MB while the physical footprint settles at
~24 MB, confirming that RSS alone is not a valid leak criterion on Bun/JSC.

The media dimension (`media 4`) shows IOAccelerator oscillating between 3.7 MB
and 6.5 MB and returning to baseline after a full GC — bounded, with no growth
across turns. **The base64/data-URI JavaScript path therefore does not on its
own reproduce the reported IOAccelerator growth.** That component is not
attributed by this work; reproducing it requires the native image decode path
under Instruments, and it should not be claimed as fixed.

## Explicitly rejected approaches

- Coalescing UI publication by delta count or on newline as the mechanism for
  bounding work.
- Silently deactivating session recording on queue overflow.
- Throwing from `HistoryService.add()` and draining the pending queue.
- Silent, unlabelled truncation of history content.
- Periodic forced GC, larger heap limits, broad history purges, or relaxed
  lint/complexity rules.
