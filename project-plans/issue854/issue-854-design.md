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

One sentence: the ledger becomes a pager over a UI-owned append-only journal,
with residency driven by the viewport and floored by the context boundary
reported by `HistoryService`.

Principles:

- Append-only, last-wins-per-itemId on read. No in-place file rewrites; the
  journal never shrinks during a session.
- The disk journal is the source of truth for the UI timeline, including
  UI-only items and compression boundary rows.
- Residency is a policy over one contiguous window; placeholders stand in for
  unloaded items (the virtualized list already paints from estimated heights).
- Context truth stays with `HistoryService`; the UI asks for the boundary, it
  does not infer it.

## Components

### 1. ScrollbackJournal (writer) — new, CLI-owned

Location: `packages/cli/src/ui/services/scrollback/`. Written at
`commands.addItem` / `updateItem` commit points via the turn store.

Files, sibling to the session journal in the chats dir (naming verified
against `SessionDiscovery` / janitor / cleanup globs, which match exactly
`session-*.jsonl`; the `sb-` prefix never collides):

```
<chatsDir>/session-<ts>-<id>.jsonl          # model journal (existing)
<chatsDir>/sb-<ts>-<id>.jsonl               # UI scrollback journal (new)
<chatsDir>/sb-<ts>-<id>.idx.jsonl           # offset index (new)
```

Record shapes (JSONL, one object per line):

```
item:      {"v":1,"rec":"item","uiSeq":41,"itemId":7,"ts":"...ISO...",
            "kind":"gemini","cseq":37,"seqSpan":[36,38],"payload":{...HistoryItem}}
revision:  {"v":1,"rec":"rev","uiSeq":42,"itemId":7,"cseq":37,"payload":{...}}
boundary:  {"v":1,"rec":"boundary","uiSeq":43,"summaryText":"...",
            "replacedFromSeq":12,"replacedToSeq":36,"itemCount":25}
clear:     {"v":1,"rec":"clear","uiSeq":50}
rewind:    {"v":1,"rec":"rewind","uiSeq":55,"truncateAfterUiSeq":49}
```

- `uiSeq` is monotonic per session and continues across resume (mirrors the
  model journal's `seq`).
- `cseq` / `seqSpan` carry the `chronology.seq` correlation (see 5).
- Write cadence: UI-only items write immediately at `addItem`; model-content
  items write when finalized (turn end, tool-group completion); streaming
  interim states never hit disk. `updateItem` appends a `rev` record at the
  same commit points (debounced within a turn).
- Crash parity matches the model journal: losing the un-flushed tail of a
  partial turn is acceptable; the model journal loses the same turn.

### 2. ScrollbackIndex — new

Appended after each journal append:

```
{"uiSeq":41,"off":84213,"len":611,"kind":"gemini","cseq":37}
```

- In memory: array + `Map<uiSeq, entry>`. Gives timeline length, page reads
  (seek + bounded read), and metadata without parsing payloads.
- On open: validate the last index offset against the journal size; if the
  index is short, scan only the un-indexed journal suffix; if long (torn),
  truncate to the journal size. No full-file reindex in the normal case.
- Optional later: persist measured row heights so the scrollbar stays stable
  across eviction cycles.

### 3. ScrollbackPager (resident store) — replaces ledger residency

Data model:

- Logical timeline: `uiSeq 1..N`, contiguous, known from the index.
- Each slot is either materialized (a `HistoryItem` in memory) or a
  placeholder `{uiSeq, estimatedHeight}` (estimatedHeight defaults to the same
  flat 100 the virtualized list uses today).

Residency rules:

- Always resident: pending/live items of the current turn.
- Resident window: viewport ± margin (margin proposal: 2 viewport heights),
  subject to a byte/item budget (proposal: keep `ui.historyMaxBytes` /
  `ui.historyMaxItems` as the budget knobs, retargeted from "display trim" to
  "resident window"; docs update required).
- At bottom (steady state): anything with `cseq < contextWindow.firstSeq` is
  evicted immediately when not visible. This is the issue's "trim anything not
  in HistoryService" rule.
- Scroll-back beyond the window start: async `pageIn(older)` reads the block
  before the window from the journal; placeholders render meanwhile. Loaded
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

- If `sb-*.jsonl` exists for the session: open + index, resident = context
  range items + last viewport page, paged from the journal. Exact fidelity,
  including info boxes and boundary rows.
- Legacy session (no sidecar): current behavior via `iContentToHistoryItems`
  of the replayed context, now with `chronologySeq` stamped. Older-than-context
  UI items simply do not exist (same as today).

### 8. Settings / flags

- `ui.scrollbackJournalEnabled` (default true, phase 1): journal + index
  always-on; no behavior change otherwise.
- `ui.scrollbackPagerEnabled` (phase 2, default false until baked): pager +
  eviction + paging in alternate-buffer mode.
- `ui.historyMaxBytes` / `ui.historyMaxItems`: retargeted to the pager budget
  (same defaults: 1 MiB / 100; revisit margin vs. budget split).

## Flows

### Turn append
1. Streamed content updates `pendingHistoryItems` (unchanged, resident).
2. Turn/tool-group finalization: `addItem` appends to pager tail + journal
   `item` record + index line. `cseq` stamped.
3. Viewport at bottom: no eviction of sub-context items (none exist); budget
   eviction may trim the far (oldest-resident) end into placeholders.

### Compression
1. `replaceAll` swaps the array; journal writes the `compressed` record
   (existing); HistoryService emits `contextRangeChanged {firstSeq: 37, ...}`.
2. UI appends a `boundary` row (summary text, replaced span) to pager +
   journal.
3. Pager purges every resident item with `cseq < 37` that is not visible;
   they render as `purged` chips when paged back later.

### Scroll-back peek / scroll-forward purge
1. Viewport crosses the window start: `pageIn(older)` reads the block before
   the window; placeholders hold layout.
2. Items load, render dimmed (`purged`) below the boundary; boundary row shows
   its summary expander.
3. User scrolls forward: peek pages leave the viewport; debounce elapses;
   pager drops them (sub-context first). Returning to bottom re-asserts the
   context floor.

### /chat clear, rewind, restore
- `clear` / `rewind` control records append to the journal. `pageIn` never
  crosses a `clear` marker or a `rewind` truncate point; resident items beyond
  a rewind point are dropped when the marker applies. Disk bytes remain for
  the janitor.

## Janitor integration

- `sessionGrouping.ts` groups by base name; extend to move `sb-<base>*` with
  its `session-<base>.jsonl` on archive so sidecars are never orphaned.
- Media reclamation already keeps `.jsonl`; the `sb-` prefix keeps sidecars
  out of every session glob (`startsWith('session-') && endsWith('.jsonl')`).
- Single writer per session is already enforced by the session lock.

## Memory accounting (order of magnitude)

- Before: ledger ≤ 1 MiB display-capped (plus loss on trim); React elements
  materialized for every retained item each history change.
- After: resident items ≈ viewport + 2 viewports margin + live turn (well
  under the 1 MiB budget in items terms); element materialization only for
  resident slots; index ≈ 40–60 B per item in memory (100k items ≈ 5 MB);
  unbounded scrollback on disk.

## Phasing

- Phase 1 — Foundation (no UX change): journal + index writer always-on;
  `chronologySeq` stamping; `getContextWindow` / `contextRangeChanged` /
  `getContextSummaries` in core.
- Phase 2 — Pager: alternate-buffer residency, placeholders, viewport
  feedback, budget + context-floor eviction, scroll-back paging. Behind
  `ui.scrollbackPagerEnabled`.
- Phase 3 — Markings + boundary expander; `clear`/`rewind` markers.
- Phase 4 — Resume via journal (exact fidelity); primary-buffer
  eviction-on-flush; janitor sidecar grouping.
- Phase 5 — Deferred: `HistoryService` windowing on the same journal pattern
  (context itself becomes file-driven). Seam: the range API added in Phase 1.

## Test strategy sketch (bun, behavioral)

- Journal: round-trip (item/rev/boundary/clear), crash parity (kill between
  journal and index append; reopen repairs), last-wins revisions, uiSeq
  monotonicity across resume.
- Index: torn-tail repair, page reads at UTF-8 boundaries.
- Pager: residency invariants (visible ∪ live always resident; sub-context
  floor at bottom), pageIn/pageOut correctness, budget enforcement, debounce
  behavior.
- Range API: events on compression / rewind / clear / restore; summaries
  reflect `chronologyReplaced` spans.
- Render: `purged` chip, boundary expander toggle, placeholder heights,
  Static-remount notice.

## Risks / open questions

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
