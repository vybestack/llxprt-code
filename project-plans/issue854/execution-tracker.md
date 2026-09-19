# Execution Tracker — Issue 854 File-Driven Scrollback

Design: `issue-854-design.md` · Phase 1 plan: `phase-1-plan.md`

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|---------|-----------|----------|-----------|-------|
| 0.5 | P0.5 | ✅ | 2026-09-17 | 2026-09-17 | 2026-09-17 | N/A | Preflight: tables filled in phase-1-plan.md; REQ-854-003 live stamping flagged blocked (see plan) |
| 01 | P01 | [OK] | 2026-09-17 | 2026-09-18 | 2026-09-18 | [OK] | Foundation: journal + index writer, seq stamps, getContextRange + event, settings flag — marker `.completed/P01.md`; fix session: journal creation made lazy (recording path null at render → journal never created; smoke proved it) + end-to-end sidecar proof; full-suite 26,673 pass with 5 cli-args profile failures proven pre-existing on origin/main (wt-main-test.log), 4 runner-fixture flakes 34/34 isolated (wsc-retest.log); lint exit 0; PR #3727 CI fully green 2026-09-18 (41 pass/0 fail) after two CI-only catches: prettier rewrap of late fix files, and `schema:settings`+`docs:settings` regeneration for the new setting (the scripts meta-shard checks these; local `npm run test` does not cover `scripts/tests/` — regenerate after any schema-ui.ts edit) |
| 01b | P01b | [OK] | 2026-09-18 | e4c053c42 | - | [OK] | Rework per Andrew's three rulings (2026-09-18): (1) no duplicate file, (2) NO UI state persisted at all, (3) no giant in-memory map. DELETED ScrollbackJournal + scrollbackIndex + journalWiring + scrollbackRecords + scrollbackTestHelpers + ui.scrollbackJournalEnabled + useAppBootstrap wiring (schema/docs regenerated, 0 hits); KEPT chronology stamps + contextRange API + contextRangeChanged. Verified: src grep 0 dangling refs (p01b-grep-proof.log), core history 441 pass / 39 files, iContentToHistoryItems 40 pass, lint 18/18 clean, smoke haiku emitted (p01b-smoke5.log), INVERSE PROOF: 6 fresh smoke chats dirs, ZERO sb-* files (p01b-inverse-sidecar-proof.log) |
| 02 | P02a | ⬜ | - | - | - | ⬜ | JournalCursor (core recording): chunked reverse/forward, MAX_RECORD_BYTES line assembly, torn-tail, group-by-offset; 12-case suite + allocation probes. Done = every path allocation-bounded |
| 02 | P02b | ⬜ | - | - | - | ⬜ | Row identity + live correlation: identity = (envelope offset, projection discriminator); merge live/paged without session-sized lookup. Done = adversarial uniqueness test |
| 02 | P02c | ⬜ | - | - | - | ⬜ | ScrollbackPager store: residency policy, generation/async invalidation, visibility floor (clear stop; compression scrolls), byte scrollbar values. Done = residency fuzz green |
| 02 | P02d | ⬜ | - | - | - | ⬜ | Pager viewport/scrollbar component (own measurement contract, identity anchoring, keys, placeholders). Done = real-Ink element census bounded |
| 02 | P02e | ⬜ | - | - | - | ⬜ | Wiring + `ui.scrollbackPagerEnabled` lifecycle + schema/docs regen + smoke. Done = both flag states green |
| 03 | P03 | ⬜ | - | - | - | ⬜ | Membership-interval marking + boundary expander (approximate pre-P05, exact after); contextRangeChanged first-add fix. Done = membership matrix incl. topPreserved/density/rewind |
| 04 | P04a | ⬜ | - | - | - | ⬜ | Static print protocol: append-only batches, ack-boundary eviction, Ink archive budget. Done = real-Ink print-byte exactly-once |
| 04 | P04b | ⬜ | - | - | - | ⬜ | Resume = bounded viewport projection + scalars. Done = G1 after restart, context > viewport stays bounded |
| 05 | P05a | ⬜ | - | - | - | ⬜ | JournalResolver (watermark prepass + bounded yield); ReplayEngine refactored onto it. Done = property equivalence + no O(history) retention |
| 05 | P05b | ⬜ | - | - | - | ⬜ | b1 durable mutator ops; b2 awaitable commit protocol; b3 array deletion + caller migration; b4 provider contracts/transports. Done = criteria 1-3 (harness in plan §8) |
| 05 | P05c | ⬜ | - | - | - | ⬜ | Subagent journals: fs-safe id pre-runtime, session_start kind/parentSessionId, all-path discovery filters, lifecycle cleanup; staged BEFORE final flip. Done = lifecycle matrix + child criteria |
| 05 | P05d | ⬜ | - | - | - | ⬜ | No-materialization resume end-to-end (discovery, resumeSession, checkpoints). Done = criterion 5, peak-row instrumentation incl. discovery |

Open decisions from design section 9 (PDF §9): NONE. OQ1-10 resolved;
OQ7 refined after plan review (stop = clear boundary/file start; purged
rows scroll). P05 UN-deferred 2026-09-18 per Andrew: "all done in your
PR" + facade/subagent rulings. Plan review: deepthinker round 1
(19 findings) folded into implementation-plan.md rev 2 + design rev 2;
round 2 = findings-verification only.
