# Issue #854 — Implementation Plan (all phases in PR #3727)

Status: ACTIVE, revision 2 (post plan-review round 1). Directive
(Andrew, 2026-09-18): "ultimately I want this all done in your PR not
in 100 followups." Every phase below lands on branch `issue854` and
ships in draft PR #3727. No follow-up PRs. No merge without Andrew's
explicit instruction.

Source of truth: `issue-854-design.md` (same dir; revision 2 folds the
plan-review corrections in). This plan adds: session-sized work
packages, file-level change lists, test lists, per-package done
criteria, the acceptance-test implementations, and the compatibility
protocol with the split-out work on main.

## 0. Baseline (verified 2026-09-18)

- Branch rebased onto `origin/main` @ `a2d21a22a` (#3724 split +
  ceiling guard, #3723 tool-result retention, #3715, #3726, #3729).
  24/24 commits replayed, zero conflicts; both sides' suites green on
  one tree (my 441 history tests + their 62 retention tests).
- Lint law after #3724: `max-lines` 800 (skipBlank/skipComments),
  functions ≤ 80 lines, eslint-guard REJECTS per-file overrides. All
  new files are modular by construction; the facade flip SHRINKS
  HistoryServiceCore (1097 raw lines today).
- #3428 facts: `toolResultTranscriptReader` is a forward one-callId
  scan; `ToolResultExpansionProvider` purges expansions from
  TurnStore.history ID changes. Integration invariants in §7.5.
- Known overlap files (both sides touched): `ui/types.ts`,
  `ui/utils/iContentToHistoryItems.ts` + test. Additive both sides.

## 1. Architecture (layers, in one paragraph)

`JournalCursor` (core recording) iterates raw envelopes chunked,
offset-addressed, backward/forward, torn-tolerant. Above it, the
`JournalResolver` (core recording) computes the logical-history fold
with an interval-list algorithm: a forward prepass scans EVENTS ONLY
(content skipped by line length) maintaining survivor seq intervals +
each interval's first-record offset; `rewind` removes the suffix from
the cut (count over the dense never-reused seq space, or `cutSeq`),
`compressed` replaces the entire history with `[summary]` (+
`topPreserved` head), `semantic_media_purge` is a whole-history
replacement. Prepass memory is O(mutation events) — never O(content);
the yield pass seeks interval-to-interval, decoding one bounded window
at a time (purge payloads via streaming tokenizer, no whole-record
parse). Two clients sit on the resolver: the CLI projection
(`iContentToHistoryItems` + membership intervals for badges) and the
provider transform (curation → normalizer, request-scoped).
ReplayEngine is refactored onto the same resolver. The UI pager is a
third client of the cursor directly (physical timeline: scrollback
shows every appended record with boundary rows; it is NOT the logical
fold).

## 2. Delivery order and why

P02 (read path: cursor, identity, pager; UI-only, flag-gated) → P03
(membership marking + boundary expander) → P04 (primary-buffer print
protocol + bounded resume projection) → P05 (resolver, durable
mutations, commit protocol, provider migration, subagent journals,
facade flip, discovery migration). Read-path first proves cursor and
paging with zero model-path risk; P05 flips the core when a journal
client has run for three phases.

## 3. Phase P02 — cursor, identity, pager (behind `ui.scrollbackPagerEnabled`)

- **P02a — JournalCursor (core `recording`, new + tests)**
  - API: `open(filePath)`, `pageBack(n)`, `pageForward(n)`, `size()`,
    `windowStart()`, `close()`; 64 KiB chunk reads; MAX_RECORD_BYTES =
    16 MiB assembly bound (records span chunks; `semantic_media_purge`
    embeds a whole context); a VALID record exceeding the cap is
    skipped with a diagnostic (offset+length retained; row renders
    unavailable; paging continues); line assembly handles UTF-8 multi-byte
    splits, CRLF, BOM; a partial line at read START extends backward
    (continuation, not torn); torn TAIL (crash mid-append) ignored;
    non-content envelopes skipped with offsets retained; group
    companion read by offset across page boundaries (join by callId,
    not adjacency).
  - Tests (real FS): 1. reverse byte order = reverse seq order;
    2. record spanning 3+ chunks; 3. multi-byte char split at a chunk
    edge; 4. record exactly at a chunk boundary; 5. torn tail ignored;
    6. head continuation reassembly; 7. group straddling a page
    boundary; 8. interleaved metadata/session envelopes skipped;
    9. pageBack/pageForward idempotent window arithmetic; 10. file
    grew between calls; 11. empty/non-journal file deterministic; 12.
    instrumentation: max retained partial-record bytes ≤
    MAX_RECORD_BYTES, transient buffers freed (WeakRef probe pattern
    from `SessionRecordingService.test.ts`).
  - Done: suite green; every path allocation-bounded by test assertion.
- **P02b — Row identity + live correlation (cli `ui/utils` + turn
  store, new + tests)** [was missing; review F2]
  - Identity = (journal byte offset of the source envelope,
    projection discriminator: text|toolGroup|summaryRow). chronologySeq
    is ordering/display data, NOT identity (replay converter ids
    restart at −1 per invocation; one AI entry can project text +
    group; groups carry seqSpan without chronologySeq).
  - Live commits: RecordingIntegration's commit observer returns the
    envelope offset; turnStore rows carry it. Replay/page-in rows get
    offsets from the cursor. Merge live-tail with paged rows by
    identity; no session-sized lookup.
  - Tests: simultaneous live commit + page-in (no dupes/gaps, keyed by
    identity); multi-row projections from one entry; repeated callIds
    (retry, last-wins display); legacy recordings (identity stays
    (offset, discriminator) for them too — legacy rows only lack the
    live-correlation metadata, never the discriminator, so one legacy
    envelope projecting text + group still gets two unique keys);
    repeated paging stable.
  - Done: row-key collisions impossible by construction (test proves
    uniqueness under adversarial projections).
- **P02c — ScrollbackPager store (cli `ui/stores/turn`, new + tests)**
  - State: window byte offsets + resident slots + generation counter.
  - Residency: viewport + margin (`ui.scrollbackMarginViewports`=2) +
    live turn; byte floor (`ui.scrollbackByteFloorKiB`=256) governs
    off-screen margin only; oversized rows inside the viewport are
    always resident. Eviction continuous; visible peek rows are NOT
    evicted by compression range changes (only non-visible below-floor
    rows); hard stop of paging = visibility floor (last `clear`
    boundary or file start); compression boundaries do not stop paging.
  - Async protocol [F10]: every pageIn carries the pager generation;
    results from a stale generation are dropped; reads serialized
    (coalesced, max 2 in flight); a row is never evicted before its
    durable journal offset ≤ committed watermark; close() on unmount
    and session swap (Windows handle semantics: close before any
    rename/delete in janitor paths).
  - Scrollbar: byte-proportional (`windowStart / fileSize`); heights
    in-viewport only, dropped on evict; pager does NOT use
    VirtualizedList `heights`/`offsets` arrays.
  - Tests: policy table; eviction on `contextRangeChanged` preserves
    visible peeks; byte floor under one-giant-item fixture; sliding
    equal-length window (identity anchoring, no jump); stale
    generation dropped after clear/rewind/swap; overlapping reads
    coalesced; live append during pageBack.
  - Done: residency invariants hold under fuzzed scroll patterns.
- **P02d — Pager viewport/scrollbar component (cli `ui/components`)**
  [split from old P02c; F8]
  - The pager's list is NOT the existing VirtualizedList fed different
    data: it is a pager-aware window component implementing the same
    measurement contract — identity-anchored slots (prepend/evict does
    not shift scroll position), placeholder/clamping at floor and EOF,
    Home/End/PageUp/PageDown/wheel/drag, loading and error rows,
    resize handling, expansion height changes. Pending live rows
    render as independent slots below the window while scrolled away.
  - Tests: equal-length window slides; expand/collapse height change
    keeps anchor; resize; input during pageIn; mounted-element count ≤
    window + pending (asserted via ref census in a real-Ink lane —
    dev-docs/bun.md real-Ink runner, not redirected mocks).
  - Done: real-Ink element census bounded by window size.
- **P02e — Wiring + settings (cli `ui/hooks`, schema-ui)**
  - `ui.scrollbackPagerEnabled` default false → flips true at end of
    P02 verification; startup-read only, live toggle prompts restart;
    missing/failed journal → non-pager fallback + one-line notice;
    core facade NOT gated. On→off handoff: drop pager state, rebuild
    current ledger path. Schema: `npm run schema:settings` +
    `npm run docs:settings` then scripts/meta tests.
  - Tests: flag-off path byte-identical to today (existing suites
    unchanged); flag-on smoke: >5 viewports scripted session, scroll
    back, old rows render from disk, store resident ≈ window.
  - Done: both flag states green; schema/docs regenerated.

## 4. Phase P03 — membership marking + boundary expander

- Membership comes from the context projection (design §5 rev 2):
  seq intervals + boundary events, not a single comparison.
  Pre-P05 (in-memory era): contextRange v2 emits membership intervals
  (firstSeq/lastSeq + removed-interior spans as known); approximate for
  density-mutated interior rows, documented, exact after P05 journals
  density ops.
- `HistoryItemDisplay.contextState` badge (in-context | purged | n/a);
  dimming + chip. Boundary rows (compression, rewind) synthesized live
  from journal event records; expander reads summary text on demand
  (journal re-read; nothing retained after collapse).
- `contextRangeChanged` contract fix: fires on first-entry add too
  (code skips it today; HistoryServiceCore 845-854).
- Tests: middle-out compression (`topPreserved`), density
  replacement/removal, rewind, empty→first-add, clear, unmarked
  legacy history; badge flip at boundary events; expander
  pointer-read; purge removes badge state with the row.
- Done: G3+G4 — badges exact on generated journals for
  compression/rewind/clear cases; interim approximation
  (density-mutated interior rows) is a DOCUMENTED limitation resolved
  by P05b1.

## 5. Phase P04 — print protocol + bounded resume projection

- **P04a — Static print protocol** [F11]
  - Ink `Static` tracks a printed COUNT and slices; a same-length
    array after prefix removal SKIPS rows. Protocol (design 5d rev 3):
    batches are APPEND-ONLY, never rotated; eviction drops our refs
    only; a count RESET happens only by remounting a FRESH Static
    element (post-clear), initialized with resident rows + notice;
    acknowledgement = the appending render pass completing; Ink's
    bounded static archive (~4 Mi/1024 chunks) counted in budget.
  - Tests (real-Ink lane): append-after-evict prints exactly once;
    identical-length successive batches; batched renders; clear;
    resize; interrupted output. Assert on printed bytes, not ledger
    count.
- **P04b — Resume = bounded viewport projection** [F12]
  - Resident = last page of the physical timeline + scalars (floor/
    tail offsets, seq watermarks). Never all context-range items.
  - Tests: resume equivalence vs ReplayEngine for conversation-backed
    rows; context longer than viewport stays bounded; older rows page
    on demand after resume.
  - Done: G1 holds in both buffer modes and after restart.

## 6. Phase P05 — resolver, durable ops, commit, providers, subagents, flip

- **P05a — JournalResolver (core `recording`, new + tests)** [F4]
  - Interval-list fold (design §5c rev 3): events-only prepass
    maintaining survivor seq intervals + interval-first offsets;
    rewind = suffix removal from the cut (count via the dense seq
    space, or cutSeq) — the adversarial chain append A,B,C → rewind →
    append D,E → rewind → append F resolves to intervals [A],[D],[F,..];
    `compressed` = whole-history replacement (+topPreserved head);
    `semantic_media_purge` = whole-history replacement (payload decoded
    with a streaming tokenizer — no whole-record parse). Malformed
    records / version checks / count fallback preserved exactly.
  - ReplayEngine refactored onto the resolver.
  - Tests: property equivalence vs a test-only eager reference on
    seeded generated journals (adversarial rewind/reappend chains,
    rewind-after-compression, count-only recordings, purge, duplicate
    callIds); memory: WeakRef payload probes show no O(history)
    retention; I/O documented (two passes in-context region).
- **P05b — Durable mutations + commit protocol (core) → then facade**
  - P05b1 mutator inventory → durable ops [F5]: clear, pop/
    removeLastIfMatches, replace/transform, density (NEW event kind),
    compression (detail record; content suppression unchanged),
    synthetic tool-response insert (NEW event kind), semantic purge,
    restore/fork, metadata. Append-only format extension; ReplayEngine
    handles new kinds; legacy files replay with today's documented
    divergence. Oracle: live model projection (not ReplayEngine alone).
  - P05b2 commit protocol [F6]: awaitable commit ack (watermark
    byte/seq), bounded queue (default replaces MAX_SAFE_INTEGER),
    backpressure, loud failure (fail fast; no silent divergence);
    append = commit point; post-commit observer failure ≠ rollback;
    legacy publication-error rollback paths die with the array. Tests:
    slow disk, ENOSPC/EACCES/ENOENT, failure-after-append, concurrent
    queued commits, immediate provider read after commit.
  - P05b3 delete the array + migrate internal reads [F7]: delete
    `history: IContent[]` and compression `replaceAll` swap; standing
    state per design §5c rev 2 (capped summary pointer window, lazy
    enumeration; `recordedIdentities` set → exactly-once watermark;
    persistence snapshots write from the journal). Callers migrate:
    agents `streamRequestHelpers.getCuratedForProvider`,
    `RuntimeProviderChat`/`RuntimeProvider` `IContent[]` contracts →
    async-iterable; CLI converter; UI range queries.     `contextRangeChanged`
    first-add fix landed earlier (P03 owns it; P05b3 only preserves
    its tests). Tests: structural audit (below) +
    cardinality tests no-compression AND many-compression.
  - P05b4 provider contracts/transports [F7]: each provider's
    normalizer consumes the stream; where an SDK demands a body array,
    the transport builds it request-scoped and releases after the call
    (in-flight bound + released-after-call asserted). Response-chain
    semantics preserved (ReplayEngine's resume-time stripping is NOT
    applied to live requests). Tests: byte-level provider-body
    equivalence vs today's live assembly (seeded ops → independent
    eager reference → real normalizers → capturing local transport);
    retry bodies; in-flight backpressure/cancellation.
  - Done per sub-package: its test list green; P05b total: acceptance
    criteria 1, 2, 3 (implementations in §8).
- **P05c — Subagent journals (agents/core/launch path)** [F13/F14]
  - Allocate fs-safe random sessionId BEFORE runtime construction
    (child ids' `::`/`#` fail lock grammar; filename = first-12-chars
    at second resolution ⇒ distinct fs-safe ids required); thread
    `parentSessionId` via orchestrator/runtime loader; extend
    `session_start` payload with `kind` + `parentSessionId?` (legacy
    absent = main); discovery filters ALL resolution paths (pickers,
    `--continue` latest, checkpoint enumeration) before sort/index;
    janitor globs untouched. Cleanup at failure/success/timeout/
    cancellation/nested-child. Subagent facade = same class over own
    journal. Staged BEFORE the final flip (runtimes need provisioning
    before mandatory disk-backed history).
  - Tests: parallel launches in one timestamp bucket → distinct ids
    AND distinct file paths; locks acquired/released; injected
    init/dispose failures cleaned up; parent isolation (parent journal
    = one task group); `--continue` never selects a child; child
    facade passes criteria 1-3 harness.
- **P05d — Resume without materialization, end to end** [F12]
  - Migrate `SessionDiscovery.listContinueTargetsDetailed` (replays
    every session → header/metadata reads), `resumeSession` (returns
    history array → cursor boot), `SessionTransitionService`
    checkpoint paths (copy materialized history → journal-range copy /
    cursor seeding). Bounded-memory sequential metadata pass allowed;
    content materialization is not. Test matrix: latest/index/name/
    UUID/checkpoint continuation; legacy versions; corrupt sessions;
    empty sessions; locked sessions. Instrument peak decoded rows
    across the WHOLE command including discovery (criterion 5).

## 7. Process + compatibility

1. Single PR; per-phase commits `type(#854): ... (PLAN-20260917-ISSUE854.P0x)`;
   tscoder-flash sessions ≤ 30 min, TDD, max two review cycles per
   session; rebase onto `origin/main` before each phase and rerun BOTH
   sides' suites (protocol proven §0).
2. Full verification cycle before review; logs under `tmp/verify854/`;
   watchdog: nohup + poll for anything > 2 min.
3. One full review at the end + one findings-only follow-up (Andrew's
   rule). OCR disabled by standing instruction; mechanism = Andrew's
   call.
4. Review cadence of the PLAN itself: deepthinker, two rounds max
   (round 1 done; round 2 verifies the 19 findings against this
   revision only).
5. #3428 invariants [F15]: pager eviction events drive
   `ToolResultExpansionProvider` purge (rows leaving residency purge
   their expansions; visible rows never purge); replayed tool rows
   preserve existing bounds/retention metadata; their modules are
   edited only where this wiring demands, with tests proving expanded-
   body eviction/collapse, stale async reads, cap preservation, mixed
   live/replayed rows, duplicate callIds. Blanket no-touch replaced by
   these retained-behavior invariants.
6. New files respect 800/80 ceilings; splits over waivers, always.
7. `bun install` plain; `git checkout -- bun.lock` before committing.

## 8. Acceptance criteria — concrete test implementations [F17]

- **Criterion 1 (structural):** a scripts-lane test compiles the facade
  + core deps with the TS compiler API, enumerates fields/properties/
  returned types, and FAILS on any array/Map/Set/collection whose type
  admits context-length cardinality on HistoryService(Core), the
  resolver, cursor, and recording integration; supplemented by a
  manual closure review checklist in the PR description. A negative
  control (a deliberately-retaining stub) proves the audit catches it.
- **Criterion 2 (retained heap):** child-process pinned-Bun harness:
  warmup, settle writer/token/media work, yield a turn, `Bun.gc(true)`,
  heap snapshot validated (pattern: `shellPtyMemory.bun.test.ts`),
  unique-payload WeakRef probes (pattern:
  `SessionRecordingService.test.ts`); compare small vs large N with
  calibrated tolerance + a deliberately-leaking negative control; run
  both no-compression and many-compression workloads; no exact
  heapUsed/RSS equality assertions.
- **Criterion 3 (provider equivalence):** seeded generated operation
  logs → independent eager test-only reference implementation → real
  curation + real normalizers → capturing local transport; compare
  deterministic request BODY BYTES and retry bodies (not IContent[]
  identity — the resolver is not its own oracle).
- **Criterion 4 (subagents):** the same 1-3 harness against child
  facades + the P05c lifecycle matrix.
- **Criterion 5 (no-materialization resume):** instrument decoded/live
  row peaks across full continuation commands (including discovery and
  checkpoints); assert bounded regardless of session length; include
  input WITHOUT compression to expose whole-context buffering; in-flight
  backpressure/cancellation tests catch request-scope materialization.

## 9. SpecKitty decision

Not used for #854. Reasons: it forks the source of truth (design doc +
this plan + tracker already carry what its missions would re-describe;
two planning systems drift); its gate pipeline adds review cycles
Andrew's rules cap; its multi-mission ergonomics solve a delivery
shape ruled out ("all in your PR"). What we DO adopt: acceptance
criteria as executable tests (§8) and per-package done criteria.

## 10. Requirement → package → test matrix

| Requirement | Package(s) | Key tests |
|---|---|---|
| G1 bounded UI memory | P02c/P02d/P04b | residency fuzz, element census, resume bound |
| G2 disk-backed scroll-back | P02a/P02c/P02e | reverse-order property, smoke, stale-gen |
| G3 in-context marking | P03 (+P05b3 exactness) | membership matrix incl. topPreserved/density |
| G4 summary expander | P03 | pointer-read, collapse frees |
| G5 conversation fidelity | P02b/P04b | identity merge, replay equivalence |
| G6 no in-memory copy | P05a/b, §8 | criteria 1-3 harness |
| G7 subagent journals | P05c | lifecycle matrix + criteria 1-3 on child |
| OQ1 remount | P04a | exactly-once print bytes |
| OQ2 primary eviction | P04a | print-ack protocol |
| OQ3 budgets | P02c/P02e | floor/margin policy + settings |
| OQ6 scrollbar | P02c/P02d | byte-proportional + anchor |
| OQ7 paging floor | P02c | clear-stop, compression-scrolls |
| Rulings 1-3 | all | no new files; no persisted UI state; no map |
| 5c criteria 1-5 | §8 | as specified |

## 11. Risks

| Risk | L | Mitigation |
|---|---|---|
| Main moves further mid-flight | m | rebase protocol §7.1 (proven zero-conflict) |
| 80-line cap vs pager/ resolver | m | decomposed functions by package design |
| Retrospective-fold I/O cost | m | two-pass bound documented; perf assertion in P05a tests |
| Provider contract migration breadth | h | P05b4 isolated; byte-equivalence oracle; capturing transport |
| Subagent id/lifecycle edges | m | P05c matrix incl. same-bucket collisions |
| Static exactly-once | m | real-Ink print-byte lane |
| Bun heap-test flake | m | negative controls + tolerances, patterns from existing suites |
| Draft CI red mid-feature | c | phases land green; docs commits keep review readable |
