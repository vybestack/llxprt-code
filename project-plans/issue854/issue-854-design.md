# Issue #854: File-driven scrollback for the Ink UI — design

Status: draft for discussion (branch `issue854`)
Labels: Ink UI, Context Management. Milestone 0.12.0.

## Verdict

Scrollback today is bounded by discarding: the UI ledger trims to
`ui.historyMaxItems` / `ui.historyMaxBytes` (effective shipped defaults 100
items / 1 MiB) and everything trimmed is gone. The model side holds a second,
different copy in `HistoryService`, and after compression the originals vanish
from memory with no way to see them again.

The redesign makes scrollback a windowed view over an append-only on-disk
journal. Memory holds the visible viewport, a margin, and the live turn.
Everything else, including everything compressed out of context, stays on disk
and pages in when the user scrolls back. When the user scrolls forward, loaded
pages are dropped again. Items are marked in the UI as "in context" or
"purged", and each compression boundary gets an expandable summary row.

The model-side context stays fully in memory this phase. The design leaves a
clean seam (the context range API) so `HistoryService` can adopt the same
journal-windowing pattern later without UI changes.

## Goals

1. G1 — Bounded UI memory: resident set = visible window + margin + live turn,
   regardless of conversation length.
2. G2 — Nothing older than the context start stays resident by default; it is
   loaded from disk on scroll-back and purged again when scrolled away (or at
   compression).
3. G3 — Visual marking of which scrollback entries are still in the model
   context (issue item 2).
4. G4 — Expandable summary under the purged boundary (issue item 3).
5. G5 — Exact-fidelity scrollback: UI-only items (info boxes, command
   feedback) are persisted and replayed, unlike today's lossy resume.
6. G6 — Do not block the future "context itself on disk" work; do not do it
   now.

## Non-goals

- Changing what the model sees. `HistoryService` keeps its full in-memory
  array this phase.
- OpenTUI: removed from main (`--experimental-ui` / `@vybestack/llxprt-ui` are
  gone). Issue text predates the removal; design targets the Ink UI only.
- Paging the terminal-native scrollback in primary-buffer mode (there is no
  in-app scroll there; see Buffer modes).

## Current state (verified on main)

Three copies of the conversation exist:

| Store | Location | Contents | Lifetime |
|---|---|---|---|
| UI ledger | `packages/cli/src/ui/stores/turn/historyLedger.ts` | every `HistoryItem`: model content, tool groups, ~200 call sites of UI-only info/error boxes | trimmed to 100 items / 1 MiB, then discarded |
| Model context | `packages/core/.../HistoryService` `this.history: IContent[]` | what the model sees | replaced on compression (originals dropped) |
| Session journal | `<chatsDir>/session-*.jsonl` (append-only, seq-numbered) | one `content` record per `IContent` addition + `compressed`/`rewind` events | durable; replayed sequentially on resume |

Gaps this design closes:

- No correlation key between UI items and context entries (UI ids are a
  counter; resume assigns negative ids).
- No query for "what is in context"; the boundary only exists implicitly
  after compression.
- UI-only items are not persisted anywhere; resume rebuilds the transcript
  lossily from `IContent` via `iContentToHistoryItems`.
- The journal has no offsets; random access requires a full scan.
- Rendering materializes a React element for every ledger item in both buffer
  modes (`useListItems` / `useStaticItems`); only the paint is virtualized,
  and only in alternate-buffer mode.

## Design overview

One sentence: the ledger becomes a file cursor over the existing session
journal, with residency driven by the viewport and floored by the context
boundary reported by `HistoryService`.

Principles (per Andrew's three rulings, 2026-09-18):

- `session-*.jsonl` is the ONLY durable artifact: no duplicate content
  file, no UI state persisted anywhere, no marks written into the file.
  Ids and pointers live in memory only.
- LOW memory usage and high eviction without functionality loss: the
  pager holds the resident window plus a handful of byte offsets;
  nothing scales with session length. Scrolling reads the file in
  bounded chunks, backward and forward.
- UI-only rows are live-only; the durable scrollback is the conversation
  exactly as `/continue` reconstructs it.
- Context truth stays with `HistoryService`; the UI asks for the boundary,
  it does not infer it.

## Components

### 1. Durable state — session journal only, unchanged

**Decisions 2026-09-18 (Andrew), in order:**

1. *No duplicate of conversation content on disk.*
2. *No UI state persisted at all* — "anything about what is being
   displayed or has been displayed or was evicted from the ui is not a
   thing. we can use ids or pointers but not marking in the file."

Consequences:

- **No new files.** No `sb-*.jsonl`, no `sb-*.idx.jsonl`, no UI marks
  appended into `session-*.jsonl`. The model journal keeps its existing
  format and writer, byte-for-byte. Discovery/janitor/cleanup are
  untouched (they already glob exactly `session-*.jsonl`).
- **Scrollback is a view over `session-*.jsonl`.** Conversation-backed
  rows (user, assistant, tool calls/results, compression, rewind, shell)
  page in from the session journal on demand, reconstructed through the
  same conversion `/continue` uses (`iContentToHistoryItems`, already
  chronology-stamped). Control state (compression boundaries, rewind
  truncation) comes from the journal's existing `compressed`/`rewind`
  event records — nothing is re-marked.
- **UI-only rows are live-only.** Info banners, error/warning toasts,
  help/stats/panels, profile notices, and per-item UI state (collapse
  toggles, etc.) render during the live session and are gone once
  evicted; they are not reconstructible and that is accepted. A restarted
  UI shows the conversation, not the chrome around it — same as
  `/continue` today.
- **`updateItem` on off-screen items needs no story.** There is no
  persisted revision; paged-in rows reconstruct to the session journal's
  final state. Visible items update in place as always.
- Ids and pointers live in memory only: `chronologySeq`/`seqSpan` on
  `HistoryItem`, and the index entries below (byte offsets + seq).

### 2. File cursor — no index, no map

**Decision 2026-09-18 (Andrew), ruling 3: a giant map in memory is also
rejected.** "the point is to scroll up and down the file, not have shit
in memory. goal is LOW memory usage and high eviction without
functionality loss." The pager scrolls the file itself:

- Persistent pager state is a handful of byte offsets (window start/end)
  plus the resident items. Nothing scales with session length: no index
  array, no `Map`, no scan-at-startup.
- `pageBack(n)`: seek to `max(0, windowStart - CHUNK)`, read through
  `windowStart`, drop the torn head partial line, parse lines into
  records. The journal is append-only and seq-numbered, so reverse byte
  order IS reverse chronology. Default CHUNK 64 KiB (tunable); repeat
  while the viewport's item budget for the page is unmet.
- `pageForward(n)`: symmetric, reading forward from `windowEnd`.
- File size via `stat()` gives the timeline's byte extent for the
  scrollbar: position = `windowStart / fileSize`, byte-proportional. No
  item-count knowledge and no height bookkeeping beyond the visible
  viewport.
- Tool groups span exactly 2 adjacent records (resolved during design);
  if a chunk boundary splits a pair, read the companion line with one
  extra bounded read — group atomicity.
- Crash-torn trailing line (partial final record) is ignored on parse —
  the same tolerance `/continue` already applies.
- Rebuild cost: none. There is nothing to build, write, or repair.

### 3. ScrollbackPager (resident store) — replaces ledger residency

Data model:

- Logical timeline: journal records in seq order, discovered as pages are
  read; scrolling back stops at the context floor (oldest in-context item,
  resolved OQ7). No total item count is maintained.
- Each resident slot is a materialized `HistoryItem`. In-viewport
  virtualization uses measured heights; nothing is tracked for off-screen
  rows. UI-only rows occupy live slots only; they leave nothing behind
  when evicted.

Residency rules:

- Always resident: pending/live items of the current turn.
- Resident window: viewport ± margin (margin: 2 viewport heights),
  subject to a byte/item budget (proposal: keep `ui.historyMaxBytes` /
  `ui.historyMaxItems` as the budget knobs, retargeted from "display trim" to
  "resident window"; docs update required).
- At bottom (steady state): anything with `cseq < contextWindow.firstSeq` is
  evicted immediately when not visible. This is the issue's "trim anything not
  in HistoryService" rule.
- Scroll-back beyond the window start: async `pageBack` chunk-reads the
  file before the window via the cursor and converts records with the
  replay converter; a transient loading state renders meanwhile. Loaded
  sub-context items are the transient peek.
- Scroll-forward / return to bottom: transient peek pages that left the
  viewport are purged (debounced ~1–2s after scrolling stops), sub-context
  items first.
- Hard budget: evict from the far end of the window regardless of context
  state.

Feedback loop: `VirtualizedList`'s `useViewportRange` already computes
`startIndex..endIndex`; add an `onViewportRangeChanged` callback up to the
pager. The data array the list maps over becomes slots, and unloaded slots
render as spacer boxes, which is what the top/bottom spacer mechanism already
does for off-window rows.

### 4. ContextRangeProvider — small core addition

On `HistoryService` (the array is the context, post-curation):

```ts
getContextWindow(): {
  firstSeq: number;            // chronology.seq of first entry in history
  lastSeq: number;
  totalEntries: number;
  tokens: number;
}
getContextSummaries(): Array<{
  seq: number;                 // summary entry's own seq
  replacedFromSeq: number;     // from chronologyReplaced
  replacedToSeq: number;
  itemCount: number;
  text: string;
}>
```

Event: `contextRangeChanged` emitted after `replaceAll` (compression),
`commitHistoryMutation` (rewind/clear/restore), and first entry add. The UI
already has subscription patterns (`useTokenMetricsTracking`,
`RecordingIntegration` service-swap handling).

### 5. Correlation stamping

- `HistoryItem` gains optional `chronologySeq?: number` and
  `seqSpan?: [number, number]` (tool groups).
- Stamped at creation: `contentEventProcessor` (assistant items),
  user-submission echo, tool-group assembly, `iContentToHistoryItems` (resume
  fallback; the seq is available on replayed `IContent`).
- `contextState` is derived at render time (`in-context` | `purged` | `n/a`
  for UI-only items), never stored.

Verified tool-group facts (research, read-only pass over main):

- A standard model-issued group of N tool calls spans exactly 2 adjacent
  IContent entries: one `ai` entry holding all N tool_call blocks (stamped at
  stream finalization via `recordHistoryWithUsage`) and one `tool` entry
  holding all N tool_response blocks (first entry of the next stream's
  finalization batch). Nothing lands between them: the agentic loop is
  serialized, one scheduler per turn, and the group's `addItem` fires from
  `notifyAllToolCallsComplete` before the next turn streams
  (`useAgentEventStream.ts` `handleToolsComplete`). So `seqSpan` is
  well-defined and tight (2 seqs, occasionally 1).
- A committed tool_group is written once and never updated afterward
  (in-progress groups are ephemeral React state, not ledger items), so the
  journal needs no `rev` records for tool groups.
- Client-initiated groups (slash/@-commands via the main scheduler) have a
  tool entry only (no `ai` entry); `seqSpan` degenerates to `[seq, seq]`.
- Replay already reconstructs groups as "one tool_group per `ai` IContent
  with tool_call blocks, results joined globally by callId"
  (`iContentToHistoryItems.ts`), and chronology seq is stamped in insertion
  order, never reused, and inherited by compression replacements — so seq
  ordering plus callId joins are sufficient for deterministic reconstruction.
- Pre-existing replay quirk to keep in mind (not introduced by this design):
  steer text merged into a tool entry flips its speaker to `human`, which
  replay's response map skips, replaying those calls as Pending.

### 6. Rendering

- `HistoryItemDisplay` takes `contextState`:
  - `in-context`: unchanged (optional left rail marker).
  - `purged`: dimmed, "not in context" chip.
  - `n/a`: no marking (info boxes, shell echoes).
- Compression boundary row (new synthesized item type, journaled as
  `boundary`): collapsed shows "compressed N messages [expand]"; expanded
  shows the summary text from `getContextSummaries()` / the journal record.
- Placeholders render as blank space of estimated height until paged in.

Buffer modes:

- Alternate buffer (in-app scrollback exists: shift-arrows, page-up/down,
  home/end, mouse wheel/drag): full pager behavior. This is where the feature
  lives.
- Primary buffer (no in-app scroll; Ink `<Static>` flushes rows once and the
  terminal owns them): eviction-on-flush. Once `<Static>` prints an item it is
  dropped from the ledger. On `refreshStatic` remounts (post-clear), only
  resident items reprint plus a one-line notice. Paging does not apply; the
  terminal's own buffer is the scrollback there.

### 7. Resume

- Single path: open a file cursor on `session-*.jsonl`, resident =
  context-range items + last viewport page, older rows chunk-read backward
  on demand.
  Fidelity is conversation-exact (what `/continue` reconstructs, with
  `chronologySeq` stamped). UI-only rows (banners, toasts, panels) do not
  exist after restart — accepted property of the no-UI-state ruling, same
  as today's `/continue`.

### 8. Settings / flags

- `ui.scrollbackJournalEnabled` (phase 1): **obsolete, removed by the P01b
  rework** — there is no journal to gate. Stamps and the range API are
  internal and always-on.
- `ui.scrollbackPagerEnabled` (phase 2, default false until baked): pager +
  eviction + paging in alternate-buffer mode.
- `ui.historyMaxBytes` / `ui.historyMaxItems`: retargeted to the pager budget
  (same defaults: 1 MiB / 100; revisit margin vs. budget split).

## Flows

### Turn append
1. Streamed content updates `pendingHistoryItems` (unchanged, resident).
2. Turn/tool-group finalization: `addItem` appends to pager tail. The session
   journal write is the existing recording path — the pager adds no writes.
   `cseq` stamped in memory.
3. Viewport at bottom: no eviction of sub-context items (none exist); budget
   eviction may trim the far (oldest-resident) end into placeholders.

### Compression
1. `replaceAll` swaps the array; the session journal writes the `compressed`
   record (existing); HistoryService emits `contextRangeChanged
   {firstSeq: 37, ...}`.
2. UI appends a live boundary row (summary text, replaced span) to the pager.
   It is UI state: not persisted, gone after eviction or restart.
3. Pager purges every resident item with `cseq < 37` that is not visible;
   they render as `purged` chips when paged back later.

### Scroll-back peek / scroll-forward purge
1. Viewport crosses the window start: `pageIn(older)` reads the block before
   the window from `session-*.jsonl`; placeholders hold layout.
2. Items load, render dimmed (`purged`) below the boundary; boundary row shows
   its summary expander.
3. User scrolls forward: peek pages leave the viewport; debounce elapses;
   pager drops them (sub-context first). Returning to bottom re-asserts the
   context floor.

### /chat clear, rewind, restore
- No UI markers are written anywhere. `pageIn` stops at the context floor
  (oldest in-context item — resolved OQ7), which naturally bounds scrolling
  after a clear (context is empty → floor is the first post-clear item).
  Rewind truncation comes from the session journal's `rewind` event record
  during reconstruction. Disk bytes remain for the janitor.

## Janitor integration

- None required. No new files exist; every glob that matches
  `session-*.jsonl` today is untouched. Single writer per session is already
  enforced by the session lock.

## Memory accounting (order of magnitude)

- Before: ledger ≤ 1 MiB display-capped (plus loss on trim); React elements
  materialized for every retained item each history change.
- After: resident items ≈ viewport + 2 viewports margin + live turn; one
  64 KiB chunk buffer during a page read; a few byte offsets of cursor
  state. Nothing grows with session length. Unbounded scrollback on disk.

## Phasing

- Phase 1 — Foundation (no UX change): `chronologySeq` stamping;
  `getContextWindow` / `contextRangeChanged` / `getContextSummaries` in
  core. The phase-1 journal/index writer and `ui.scrollbackJournalEnabled`
  are REMOVED by the P01b rework per rulings 1-3.
- Phase 2 — Cursor + pager: chunked reverse/forward reader over the
  session journal, alternate-buffer residency, byte-proportional scrollbar,
  budget + context-floor eviction, scroll-back paging. Behind
  `ui.scrollbackPagerEnabled`.
- Phase 3 — Markings + boundary expander (live UI state only).
- Phase 4 — Primary-buffer eviction-on-flush; resume via cursor.
- Phase 5 — Deferred: `HistoryService` windowing on the same file-driven
  pattern (context itself becomes file-driven). Seam: the range API.

## Test strategy sketch (bun, behavioral)

- Cursor: chunked reverse read equals full-parse reversal (property test
  over generated journals); torn head/tail lines ignored; group pair split
  across a chunk boundary re-joined; pageBack stops at the context floor.
- Index: torn-tail repair, page reads at UTF-8 boundaries.
- Pager: residency invariants (visible ∪ live always resident; sub-context
  floor at bottom), pageIn/pageOut correctness, budget enforcement, debounce
  behavior.
- Range API: events on compression / rewind / clear / restore; summaries
  reflect `chronologyReplaced` spans.
- Render: `purged` chip, boundary expander toggle, placeholder heights,
  Static-remount notice.

## Risks / open questions

Resolved 2026-09-18 on PR #3727 with Andrew (issuecomment-5732580084 /
5732611297); originals kept for traceability:

1. Static-remount semantics after flush eviction — **RESOLVED: resident
   only.** Memory holds viewport + margin; older content pages from disk
   just-in-time on scroll. Remount reprints the resident set, no larger
   primary-buffer tail.
2. Primary-buffer mode gets eviction only, no paging — **EXPLAINED /
   ACCEPTED.** In primary-buffer (print-through) mode the terminal
   emulator's own scrollback is the look-back viewer; we free our copy
   after printing and never re-render. Paging applies to alternate-screen
   (fullscreen) mode only. Model-context memory is unaffected either way.
3. Budget defaults — **RESOLVED: row-based sizing, not item counts.**
   Resident = viewport + 2 viewports of margin, plus a byte floor so huge
   items cannot starve the window. 100 was the old trim cap, not a target.
   Tunable via settings once introduced.
4. Sparse on-disk index — **RESOLVED, then MOOT.** Initially deferred with
   a trigger; ruling 3 eliminates indexes entirely (no index file, no
   in-memory map), so there is nothing to sparsify.
5. `updateItem` on a non-resident item — **RESOLVED, then SIMPLIFIED by
   ruling 2:** on-screen items always update in place immediately; with no
   persisted UI state there is no revision record to write — off-screen
   items need no handling, paged-in rows reconstruct to the session
   journal's final state. Eviction is continuous as items leave
   viewport+margin.
6. Scrollbar stability — **RESOLVED, then SUPERSEDED by ruling 3:** the
   scrollbar is byte-proportional (`windowStart / fileSize`), so height
   bookkeeping beyond the visible viewport is unnecessary. Measured
   heights are used in-viewport only, never persisted.
7. `pageIn` vs `clear` markers — **RESOLVED: hard stop.** Scrolling back
   stops at the oldest in-context item; no "show cleared history"
   affordance. A full activity journal regardless of compression is a
   possible later feature, out of scope.

8. Sidecar strategy — **RESOLVED in three rulings, 2026-09-18:**
   - *Ruling 1:* the duplicate file is specifically rejected — no `sb-`
     copy of conversation content, no persistent index file.
   - *Ruling 2:* NO UI state is persisted at all — nothing about what is
     being displayed, has been displayed, or was evicted. Ids and
     pointers in memory are fine; marks in files are not. There is no
     sidecar of any kind; scrollback is a view over `session-*.jsonl`,
     and UI-only rows are live-only.
   - *Ruling 3:* no giant map in memory either — the point is to scroll
     up and down the file. Goal: LOW memory usage and high eviction
     without functionality loss. The pager is a file cursor with chunked
     reads; memory is constant in session length.

Original questions:

1. Static-remount semantics after flush eviction (reprint only resident):
   acceptable, or keep a larger primary-buffer tail?
2. Primary-buffer mode gets eviction only, no paging. OK?
3. Budget defaults: 100 items may be tight as a window margin+viewport budget
   even though it was the old trim cap; propose margin = 2 viewports and a
   byte floor, want different numbers?
4. Index memory at extreme session length (sparse on-disk index as a later
   fallback).
5. `updateItem` on a non-resident item writes a journal revision only; render
   stays stale until paged. Acceptable?
6. Scrollbar stability across eviction cycles depends on placeholder height
   accuracy; persisting measured heights is the later fix.
7. Should `pageIn` cross a `clear` marker behind a "show cleared history"
   affordance, or stay hard-stopped (current proposal)?

Resolved during design (research, no longer open):

- Tool-group `seqSpan` well-definedness: verified. A standard group spans
  exactly 2 adjacent entries with interleaving structurally excluded;
  committed groups are write-once (no journal revisions needed); replay
  reconstruction by seq order + callId join is already deterministic. See
  section 5.
