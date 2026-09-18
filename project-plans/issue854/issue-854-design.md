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

The model-side context stays in memory until P05, which then deletes that
copy entirely: `HistoryService` becomes a facade over the same journal —
per model call, rows stream from the file through a transformer with
nothing held in memory (section 5c, acceptance criteria).

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
6. G6 — Do not block the "context itself on disk" work. P05 delivers it:
   `HistoryService` holds NO in-memory copy of the context; the journal is
   the system of record for the UI and the model alike (5c).
7. G7 — Subagents use the same disk-based path: own journal file per run,
   same facade, no in-memory collection anywhere (5b).

## Non-goals

- Changing what the model sees in phases P01–P04 (the facade flip is P05's
  entire content; its acceptance criteria are in 5c).
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

### 0. The journal and its clients (architecture map)

One journal per session, one writer per journal, three kinds of reader
per journal (main sessions and subagent sessions alike). The session journal
`session-*.jsonl` is the single durable artifact; everything else is a
client of it:

```
              writes (existing path, becomes THE write path)
 agent loop ──content commit──▶ session-*.jsonl   (main session)
    │                                ▲   ▲
    │ every provider call:           │   │
    │ stream + fold + transform      │   │
    ▼                                │   │
 HistoryService (FACADE, P05) ───────┘   │
    │  — no IContent[] collection       │
    ▼                                    │
 provider call                    JournalCursor (UI scrollback)
                                         │
 subagent run ──content commit──▶ session-*.jsonl (own file, same path)
```

- **Writer (the write path)**: a content commit appends to the journal
  through `SessionRecordingService`. The UI never writes.
- **Client 1 — UI scrollback (new)**: `ScrollbackPager` in the CLI reads
  the journal backward/forward through `JournalCursor` to render history
  the viewport no longer holds.
- **Client 2 — model context (P05, acceptance-criteried)**: HistoryService
  becomes a **facade over the file** — no in-memory copy of the context
  (see 5c). Every provider call streams rows from the journal through a
  transformer; nothing is held in memory afterward.
- **Client 3 — resume/replay (existing)**: `ReplayEngine` already
  reconstructs state from the journal on `/continue`; the facade uses the
  same event fold, made streaming.
- **Subagents use the same disk-based path** (ruling 2026-09-18): each
  subagent run gets its OWN journal file in the same chatsDir and its own
  facade over it — no in-memory collection there either (see 5b).

Package / class / API responsibilities:

| Package | Class / module | Responsibility | Status |
|---|---|---|---|
| core `recording` | `SessionRecordingService` | sole journal writer; lock, flush, header | existing, unchanged |
| core `recording` | `ReplayEngine` | event fold at resume; P05 extracts a streaming fold | existing |
| core `recording` | `JournalCursor` (new) | chunked reverse/forward reader: `pageBack(n)`, `pageForward(n)`, `size()`; torn-line tolerant; group-pair atomic; read-only | P02 |
| core `services/history` | `HistoryService` | **facade over the journal (P05)**: no `IContent[]` collection; `getContextRange()`, `getContextSummaries()`, `contextRangeChanged` (kept from P01); provider assembly = stream + fold + transform | P01 done; facade = P05 |
| core `tools-adapters` | `CoreSubagentServiceAdapter` + launch path | allocate subagent sessionId + own journal at launch; close at scope end (5b) | P05 |
| cli `ui/stores/turn` | `ScrollbackPager` (new) | resident window policy, eviction, byte-offset state, byte-proportional scrollbar | P02 |
| cli `ui/hooks` | `useAgentStream` → `pendingHistoryItems` | realtime streaming of the live turn (in-memory working state, journaled only at commit) | existing, unchanged |
| cli `ui/utils` | `iContentToHistoryItems` | journal `IContent` records → `HistoryItem`s (chronology-stamped); used by pager page-ins, resume, and the provider transformer | extended in P01 |

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

### 5a. Realtime streaming — the live turn never touches disk

Scrollback is a *history* feature; it must not degrade streaming. The
design keeps the two paths separate by construction:

- **Pending region is live memory.** Stream deltas flow through the
  existing hot path: `useAgentStream` accumulates partial items and calls
  `setPendingHistoryItems` per delta; `DefaultAppLayout` renders the
  pending array below the pager's committed rows. No disk read, no disk
  write, no cursor involvement — the pager does not own these rows.
- **The journal sees only commits.** Interim states (partial text,
  in-flight tool groups) are never serialized. When the turn's content
  finalizes, `contentEventProcessor`/`recordHistoryWithUsage` commit
  `IContent` entries to HistoryService, `RecordingIntegration` appends
  them to the journal, and the rows cross from "pending" to "resident
  tail" in one step. The pager's tail grows by exactly those committed
  items.
- **Subagent streaming rides the same path.** A running subagent streams
  `<subagent>`-wrapped text as the live `task` tool call's output through
  `pendingHistoryItems` — realtime, same as any tool output. The pager
  never renders subagent internals because none reach the parent history
  as content.
- **Consequence for eviction:** the always-resident set is the pending
  region plus the viewport/margin window (section 3). Streaming cost
  stays O(current turn), independent of session length; scrolling far
  back mid-stream keeps streaming because the pending rows are separate
  slots, not part of the paged window.

### 5b. Subagents — same disk-based path, own journal files

Ruling 2026-09-18 (Andrew): "subagents need to use the same disk-based
path. the point is to NOT hold shit in memory... this means subagents
will need their own files (and that's fine, they should)."

- **Every subagent run gets its own journal.** At launch, the subagent
  path allocates its own sessionId and a `SessionRecordingService`
  writing `session-*.jsonl` into the same chatsDir. Content commits
  append to that file exactly like the main session. At scope end the
  journal is flushed and closed.
- **Every subagent gets the same facade.** The subagent's HistoryService
  is the same facade over its own journal (5c) — no in-memory
  `IContent[]` collection in subagents either. The old behavior (each
  runtime constructing `new HistoryService()` holding the full
  conversation, verified at `createAgentRuntimeContext`) is what this
  design removes.
- **Human-facing session lists must not drown in subagent journals.**
  The journal header's existing `sessionMetadata` record gains
  `kind: 'subagent'` + `parentSessionId`. Discovery globs and the
  janitor are untouched (they match `session-*.jsonl` uniformly, so
  cleanup works unchanged); `/resume` and the session picker filter on
  the metadata kind. This is descriptive metadata about the session,
  not UI state — allowed under ruling 2.
- **Parent surface unchanged:** the parent journal still records exactly
  one `task` tool-call group per run, with the `<subagent>` stream as
  its text. Parent scrollback shows that row; the subagent journal is
  inspectable later with the same cursor client (a debugging/inspection
  affordance that falls out for free).
- **Concurrency:** subagent journals are separate files with separate
  session locks; parallel subagents do not share write paths.

### 5c. HistoryService becomes a facade over the journal

Andrew's acceptance criterion (2026-09-18), verbatim in spirit: "there
must be no in-memory copy of the context in the HistoryService; it will
instead be a facade over the file. when it's time to send to the model
the rows from the file are sent through a transformer to the model with
nothing being held in memory."

**What dies:** `protected history: IContent[]` in HistoryServiceCore —
the array that today grows unbounded between compressions and is handed
to every provider call. Compression's `replaceAll` array swap also dies
(there is no array to swap).

**What replaces it:**

- **The journal is the system of record.** A content commit appends to
  the journal (the write path); the facade then notifies observers
  (range events, subscribers). The journal is no longer a downstream
  mirror of memory — it is the memory.
- **Provider assembly is a streaming pass.** On each model call: open
  the cursor at the context floor (the byte offset of the last
  compression boundary, or 0), stream records forward, apply the event
  fold (append content; at a `compressed` record, drop the replaced
  span and continue after the summary; at `rewind`, honor truncation),
  transform survivors to provider messages, send. When the call
  returns, the streamed rows are garbage. Nothing is cached across
  calls.
- **The only standing state** (all O(1), none of it content):
  context-floor byte offset, tail byte offset, last `chronology.seq`,
  a token-estimate counter for budget decisions, and the set of
  compression summary *pointers* (seq + byte offsets; summary text is
  re-read on demand). The pending/in-flight turn lives in the agent
  loop and the UI pending store as today — transient working state
  that is serialized at commit and then dropped, never a copy of
  committed context.
- **Speed honesty:** every provider call re-reads the in-context region
  from disk. That is local sequential reads of an append-only file the
  kernel page cache already holds (the writer just wrote it). The cost
  is microseconds-to-low-milliseconds per call and does not grow our
  heap; the page cache is kernel memory, evictable under pressure, and
  is not a copy WE own. If profiling ever shows this matters, the fix
  is a bounded LRU window over records (a cache, evictable, capped) —
  explicitly not a return to an unbounded collection.
- **API surface:** mutation methods (`add`, `commitHistoryMutation`,
  compression entry points) keep their names but their postcondition
  becomes "journal appended + observers notified." Read APIs that today
  return the whole array either disappear or return iterators/windows;
  callers (queryPreparer, tool-group assembly, UI range queries) migrate
  to cursor reads. No compatibility shims for internal callers.

**Acceptance criteria (P05 is done when all pass):**

1. No field, property, or closure in HistoryService( Core) retains an
   array/collection proportional to context length (structural test +
   review).
2. Retention property test: drive a real facade through N >> 1 turns
   with compression boundaries; after GC, retained heap attributable to
   the service does not grow with N.
3. Provider-call equivalence: streaming assembly byte-for-byte matches
   what `ReplayEngine`-style full fold produces for the same journal
   (property test over generated journals, including compression and
   rewind).
4. Subagent runs write their own journals (5b) and their facades pass
   the same criteria.
5. `/continue` resumes through the facade with no full-materialization
   step anywhere.

### 5d. UI memory — what React actually holds in the scroll buffer

The question (Andrew, 2026-09-18): "how does react work? is this a
giant ass tree that never leaves memory?" Answer, from the code:

- **React mounts only the visible window.** The committed transcript in
  alternate-buffer mode renders through `ScrollableList` →
  `VirtualizedList`, whose `useViewportRange` computes
  `startIndex..endIndex`; `useRenderedItems` creates elements for that
  slice only, between two spacer boxes. Rows outside the viewport
  UNMOUNT: their elements, fibers, and Ink/Yoga layout nodes become
  garbage. React trees are not retained history — an unmounted
  component leaves nothing behind but its DOM-invisible ghost, and Ink
  keeps no element archive. React re-renders the window on state
  change, but that recreates O(viewport) elements, not O(session).
- **What IS O(n) today, and what the pager does about it:**
  1. `data` — the item array fed to the list. Today: the ledger (capped
     100 items / 1 MiB, then discarded). Pager mode: `data` is the
     resident window's slots only (viewport + margin + pending), so
     bounded by the window, not the session.
  2. `heights: number[]` and `offsets: number[]` inside
     VirtualizedList — measured heights accumulate per ever-mounted
     item and offsets are recomputed over the whole array. Bounded
     today only by the ledger cap; they would grow without it. Pager
     mode does NOT reuse this mechanism: the scrollbar is
     byte-proportional (`windowStart / fileSize`), heights are measured
     for in-viewport slots only and dropped when the slot evicts. No
     O(session) arrays.
  3. `itemRefs.current` — a sparse array indexed by slot; React nulls
     entries on unmount, leaving null holes. Pager slots are window-
     relative, so the array is window-sized.
- **Primary buffer (print-through) mode:** committed rows render once
  through Ink `Static` — written to the terminal and not re-rendered or
  retained by React; the terminal emulator owns those bytes afterward.
  Our side keeps nothing per printed row (flush eviction, P04).
- **Pending rows:** the live turn's partial items — O(current turn),
  transient, serialized at commit.
- **Net:** the process's transcript-related working set is viewport +
  margin + current turn + a few byte offsets + one 64 KiB read chunk.
  Nothing in the UI or the model path scales with session length.

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
  materialized for every retained item each history change; and the
  HistoryService `IContent[]` — a full, uncompressed copy of the context
  held for the whole process lifetime (per runtime: main session AND each
  subagent).
- After: resident items ≈ viewport + 2 viewports margin + live turn; one
  64 KiB chunk buffer during a page read; a few byte offsets of cursor
  state; and, after P05, the facade's standing state is the same shape —
  O(1) offsets and counters, zero context rows (5c). Nothing grows with
  session length, in the UI or the model path. Unbounded scrollback and
  unbounded context on disk.

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
- Phase 5 — Facade flip (5b/5c; acceptance criteria in 5c): delete the
  in-memory `IContent[]` from HistoryService; provider calls stream
  from the journal (cursor at the context floor → event fold →
  transformer → send, nothing retained); subagent runs get their own
  journals with `kind: 'subagent'` metadata and the same facade;
  `/resume` filtering on that metadata. The model and the UI are two
  clients of one disk-backed truth. Seam: the range API + JournalCursor.

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

9. Design-review gaps raised by Andrew 2026-09-18 (after PDF review) —
   **RESOLVED in this revision (then SUPERSEDED on two points by OQ10):**
   - *Subagents were not covered; diagrams looked like core-to-UI with
     the agent missing.* Answered in section 5b + section 0 map: the
     agent loop is the writer; subagent internals were described as
     out of scope. **Superseded by OQ10:** subagents now use the same
     disk-based path with their own journal files.
   - *Realtime streaming not clearly preserved.* Answered in 5a
     (unchanged by OQ10): the pending region is live memory on the
     existing hot path; the journal sees only commits.
   - *Context should be direct-from-disk to the model, and
     API/package/class responsibilities were not captured.* Answered in
     5c + section 0 table — **superseded by OQ10** on the memory
     question: the projection-with-in-process-feed idea is rejected;
     the facade holds NO copy at all.

10. Facade ruling — **RESOLVED by Andrew's ruling 2026-09-18:**
    - *No in-memory copy of the context in HistoryService. It is a
      facade over the file.* When it is time to send to the model, rows
      from the file stream through a transformer with nothing held in
      memory. Acceptance criteria in 5c.
    - *Subagents use the same disk-based path and need their own files
      — "that's fine, they should."* Each run gets its own journal +
      facade (5b); the in-memory-per-runtime HistoryService model is
      what this issue removes.
    - *Scroll-buffer state:* "is this a giant ass tree that never
      leaves memory?" Answered in 5d from the code: React mounts only
      the visible window and unmounted rows are collectible; the O(n)
      offenders are the data array (becomes the resident window) and
      VirtualizedList's heights/offsets arrays (not used by pager
      mode; byte-proportional scrollbar instead).

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
