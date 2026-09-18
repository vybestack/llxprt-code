# Issue #854 — Implementation Plan (all phases in PR #3727)

Status: ACTIVE. Directive (Andrew, 2026-09-18): "ultimately I want this all
done in your PR not in 100 followups." Every phase below lands on branch
`issue854` and ships in draft PR #3727. No follow-up PRs. No merge without
Andrew's explicit instruction.

Source of truth: `issue-854-design.md` (same dir). Section numbers below
refer to it. This plan adds: session-sized work packages, file-level
change lists, test lists, done criteria, and the compatibility protocol
with the split-out work on main.

## 0. Baseline verification (done 2026-09-18, before this plan)

- Branch rebased onto `origin/main` @ `a2d21a22a` (includes #3724 split
  work, #3723 tool-result retention, #3715, #3726, #3729). 24/24 commits
  replayed, ZERO conflicts.
- Post-rebase: core history suite 441/441; their retention suites
  (`toolResultRetention`, `toolResultTranscriptReader`) 62/62 alongside my
  `iContentToHistoryItems` extension. Both sides green on one tree.
- Overlap analysis (my files ∩ main's changed files):
  `ui/types.ts` (their +14 retention fields vs my chronology fields),
  `ui/utils/iContentToHistoryItems.ts` + test (their body bounding vs my
  seq stamping). Different regions, additive both sides.
- Lint law after #3724: `max-lines` 800 (skipBlank/skipComments), functions
  ≤ 80 lines, and the eslint-guard REJECTS per-file ceiling overrides.
  Consequences for this plan: every new file stays modular and under the
  caps; the P05 facade flip SHRINKS HistoryServiceCore (1097 raw lines
  today, passing only via skips), which is the direction #3718 wants.
- Coexistence ruling: `toolResultTranscriptReader.ts` (#3428) is a
  specialized forward full-scan for one callId; `JournalCursor` is a
  positional reverse/forward pager primitive. Different access patterns.
  This PR does NOT modify their reader, retention store, or ledger
  changes beyond what rebase already reconciled. Consolidation, if ever,
  is a separate decision after this PR merges.

## 1. Delivery order and why

P02 (read path, UI-only, flag-gated) → P03 (markings, pure rendering) →
P04 (primary buffer + resume) → P05 (facade flip + subagent journals).

Rationale: P02–P03 prove the journal can serve the UI with zero
model-path risk. P04 completes the UI modes. P05 flips the core last,
when a journal client (the pager) has already run in production CI for
three phases, so the fold, cursor, and boundary semantics are battle-
tested before the model depends on them.

## 2. Phase P02 — JournalCursor + ScrollbackPager (behind flag)

Design refs: sections 2, 3, 4; rulings 1–3.

Work packages (each one tscoder session ≤ 30 min, TDD):

- **P02a — `JournalCursor` (core `recording`, new file + tests)**
  - API: `open(filePath)`, `pageBack(n)`, `pageForward(n)`, `size()`,
    `windowStart()`; 64 KiB chunk reads; seek + bounded read; never
    writes, never repairs.
  - Tests (behavioral, real FS, mkdtemp):
    1. reverse byte order IS reverse seq order on a real session journal
       fixture;
    2. torn head-of-chunk partial line dropped, page continues across
       boundary;
    3. torn tail (crash mid-append) ignored, matches `/continue` parse
       tolerance;
    4. tool group spanning a chunk boundary reads atomically (one extra
       bounded read; group = exactly 2 adjacent records);
    5. pageForward after pageBack returns the same rows (idempotent
       window arithmetic);
    6. file grew between calls (live append) → new tail visible, cursor
       state consistent;
    7. empty file / non-journal file → deterministic empty result, no
       throw.
  - Done: suite green; no O(file) allocation in any code path (assert via
    chunk-size bound in tests).
- **P02b — `ScrollbackPager` store (cli `ui/stores/turn`, new + tests)**
  - State: byte offsets + slot list only. Policy: resident = viewport +
    2 viewports margin + live turn; byte floor so huge items cannot
    starve the window; continuous eviction as rows leave range; hard stop
    at oldest in-context item (OQ7); `contextRangeChanged` → drop
    purged-from-context rows below floor.
  - Scrollbar: byte-proportional (`windowStart / fileSize`); heights
    measured for in-viewport slots ONLY, dropped on evict; the pager does
    NOT use VirtualizedList's `heights`/`offsets` arrays (OQ6 + 5d).
  - Tests: policy table (viewport/margin math), eviction on
    `contextRangeChanged`, byte floor under one-giant-item fixture,
    scroll-back pageIn merges with resident tail without dupes
    (keyed by chronologySeq), scroll-forward evicts peeked pages.
- **P02c — UI wiring behind `ui.scrollbackPagerEnabled` (default off
  until P02 verified, then default on before P03)**
  - `TranscriptScroll`/`ScrollableList`: pager supplies `data` slots;
    viewport-range events feed eviction/paging. Flag off = current path
    byte-identical (existing behavior unchanged, as proven in P01).
  - schema-ui.ts edit → run `npm run schema:settings` +
    `npm run docs:settings` (CI meta-shard).
  - Smoke: long scripted session (> 5 viewports of content), scroll back
    in alternate buffer, old rows render from disk; heap snapshot of the
    store shows resident ≈ window, not session (acceptance test for G1).
- Done criteria: flag-off path untouched; flag-on: G1+G2 hold (bounded
  resident set, disk-backed scroll-back, evict on scroll-forward).

## 3. Phase P03 — in-context marking + boundary expander

Design ref: section 6. Live UI state only (ruling 2).

- `HistoryItemDisplay`: badge from `chronologySeq` vs `getContextRange()`
  (one integer comparison at render); dimmed "not in context" style for
  purged rows.
- Boundary row: collapsed "compressed N messages"; expands to summary
  text from `getContextSummaries()` (journal re-read on expand; nothing
  retained after collapse).
- Tests: marking flips at the floor when `contextRangeChanged` fires;
  expander reads summary by pointer; purge of a row removes its badge
  state with the row.
- Done: G3+G4.

## 4. Phase P04 — primary-buffer flush eviction + cursor resume

Design ref: section 6 (buffer modes), OQ1/OQ2.

- Primary buffer: after Ink `Static` prints an item, drop it from the
  ledger (terminal owns the bytes). Remount after clear reprints resident
  set only + one-line notice (OQ1).
- Resume: cursor-based — resident = context-range items + last viewport
  page; older rows chunk-read backward on demand; conversation-exact
  fidelity; UI-only rows absent after restart (accepted property).
- Tests: flush eviction drops printed items (ledger count flat while
  transcript grows); resume equivalence vs ReplayEngine output for
  conversation-backed rows; remount reprint = resident + notice.
- Done: G5; memory flat in BOTH buffer modes.

## 5. Phase P05 — facade flip + subagent journals

Design refs: 5b, 5c acceptance criteria 1–5, 5d. This is the phase that
deletes the in-memory context everywhere.

Work packages:

- **P05a — streaming fold in core `recording` (new + tests)**
  - Extract the event fold from ReplayEngine into a streaming form:
    `foldFrom(cursor, floorOffset)` yielding post-fold `IContent` records
    (append; `compressed` drops replaced span, continues after summary;
    rewind truncation honored; finals resolved by seq order + callId).
  - Property test: streaming fold output === ReplayEngine full-fold
    output on generated journals (incl. compression + rewind +
    duplicate callId retry cases). This is acceptance criterion 3.
- **P05b — HistoryService facade**
  - Delete `protected history: IContent[]` and the array-based mutation/
    compression paths. Content commit = journal append first, then
    observer notification (range event, subscribers).
  - Provider assembly: `foldFrom(cursor, floor)` → transformer → send;
    rows garbage after the call. Standing state: floor/tail offsets, last
    seq, token counter, summary POINTERS (text re-read on demand).
  - Migrate internal callers (queryPreparer, tool-group assembly) to
    windowed/iterator reads; no compatibility shims.
  - Tests: structural (no collection proportional to context; criterion
    1), retention property (heap after GC flat across N ≫ 1 turns with
    compression boundaries; criterion 2), equivalence (criterion 3 via
    P05a), budget/compression behavior preserved.
- **P05c — subagent journals**
  - Launch path: allocate subagent sessionId; own `SessionRecordingService`
    in the same chatsDir; open at launch, close at scope end. Header
    `sessionMetadata`: `kind: "subagent"` + `parentSessionId`.
  - Subagent runtime: facade over its own journal (same class; criterion
    4 applies to it too).
  - `/resume` + pickers: filter `kind: "subagent"`. Janitor/discovery
    globs untouched.
  - Parent surface unchanged: one `task` tool-call group per run.
  - Tests: parallel subagent runs → distinct files, unique sessionIds;
    parent journal unchanged; picker filters; subagent facade passes
    criterion 2 on its own file.
- **P05d — resume without materialization**
  - `/continue` boots straight into the facade (no full-array rebuild
    anywhere). Test: criterion 5; resume memory flat for long sessions.
- Done: G6+G7; design section 5c criteria 1–5 all green.

## 6. Process (single PR)

- Branch: `issue854` only; rebase onto `origin/main` BEFORE each phase
  starts (protocol below); push updates draft PR #3727 each phase.
- Per phase: TDD via `tscoder-flash` sessions (≤ 30 min wall each; work
  packages above are session-sized); commits in current style
    `type(#854): ... (PLAN-20260917-ISSUE854.P0x)`.
- Per-phase verification: targeted suites + `npm run lint` + smoke;
  full cycle (`test/lint/typecheck/format/build` + smoke) before review.
  Watchdog protocol: long commands nohup + poll, unique logs under
  `tmp/verify854/`.
- Review: ONE full review at the end + ONE findings-only follow-up
  (Andrew's two-cycle rule). OCR is disabled by standing instruction;
  mechanism for the full review = Andrew's call (subagent review session
  by default).
- Tracker: `execution-tracker.md` updated per work package, real outputs
  only.

## 7. Split-work compatibility protocol (do-not-bork guarantees)

1. Rebase before each phase; conflicts expected only in the 3 known
   overlap files; resolution rule: keep BOTH sides (their retention
   bounding + my chronology/scrollback) unless semantically impossible,
   in which case STOP and flag to Andrew before proceeding.
2. After each rebase: run BOTH sides' suites (history + retention
   suites listed in section 0) before any new work.
3. Never modify, in this PR: `toolResultTranscriptReader.ts`,
   `toolResultRetention.ts`, `toolResultExpansionStore`, their tests, or
   their ledger changes. The pager layers AROUND them.
4. New files respect the 800/80 ceilings by construction; if a phase
   legitimately needs more room, split the module (the #3718 direction),
   never a waiver.
5. `bun.lock`: plain `bun install` only; `git checkout -- bun.lock`
   before committing if drifted.

## 8. SpecKitty decision

Not used for #854. Reasons:
- One source of truth: the design doc + this plan + tracker already
  carry what spec-kitty's specify/plan missions would re-describe; a
  second artifact tree forks the truth and drifts.
- Review cadence: SK's gate pipeline (mission review, verdicts,
  retrospective) adds cycles Andrew's rules cap at two for the whole
  feature.
- Delivery shape: single PR, phase-sequenced; SK's multi-mission/
  multi-PR ergonomics solve a problem we were told not to have.
What we DO take from that discipline: acceptance criteria are executable
tests from day one (5c criteria 1–5, G1/G2 memory assertions), and every
work package above has explicit done criteria in the tracker.

## 9. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Main splits history/recording further mid-flight | medium | rebase protocol §7.1-2; my new code is already module-shaped |
| 80-line function cap vs pager state machine | high if naive | decompose policy functions (P02b sized for it) |
| Subagent sessionId collisions / lifecycle leaks | medium | unique-id test + close-on-scope-end test in P05c |
| fs atomicity (append vs read races) | low (local FS, line-buffered) | cursor growth test P02a#6; tolerate torn tail |
| Performance regression on model path (P05b) | medium | page-cache argument verified in design; equivalence + perf assertions in tests; flag `ui.scrollbackPagerEnabled` unrelated to model path so P02-P04 ship value regardless |
| Draft PR CI red mid-feature | certain at times | phases land green; docs-only commits keep review readable |
