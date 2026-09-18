# Execution Tracker — Issue 854 File-Driven Scrollback

Design: `issue-854-design.md` · Phase 1 plan: `phase-1-plan.md`

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|---------|-----------|----------|-----------|-------|
| 0.5 | P0.5 | ✅ | 2026-09-17 | 2026-09-17 | 2026-09-17 | N/A | Preflight: tables filled in phase-1-plan.md; REQ-854-003 live stamping flagged blocked (see plan) |
| 01 | P01 | [OK] | 2026-09-17 | 2026-09-18 | 2026-09-18 | [OK] | Foundation: journal + index writer, seq stamps, getContextRange + event, settings flag — marker `.completed/P01.md`; fix session: journal creation made lazy (recording path null at render → journal never created; smoke proved it) + end-to-end sidecar proof; full-suite 26,673 pass with 5 cli-args profile failures proven pre-existing on origin/main (wt-main-test.log), 4 runner-fixture flakes 34/34 isolated (wsc-retest.log); lint exit 0; PR #3727 CI fully green 2026-09-18 (41 pass/0 fail) after two CI-only catches: prettier rewrap of late fix files, and `schema:settings`+`docs:settings` regeneration for the new setting (the scripts meta-shard checks these; local `npm run test` does not cover `scripts/tests/` — regenerate after any schema-ui.ts edit) |
| 01b | P01b | ⬜ | 2026-09-18 | - | - | ⬜ | REWORK per Andrew's three rulings (2026-09-18): (1) no duplicate file, (2) NO UI state persisted at all — no sidecar of any kind, no rev records, no markers, ids/pointers in memory only, (3) no giant in-memory map — scroll the file itself; LOW memory, high eviction, no functionality loss. Scope: DELETE ScrollbackJournal + scrollbackIndex + journalWiring + scrollbackRecords + ui.scrollbackJournalEnabled + useAppBootstrap wiring and their tests; KEEP chronology stamps + contextRange API + contextRangeChanged (untouched); smoke must prove NO sb-* files exist next to a fresh session-*.jsonl. The phase-2 cursor (chunked reverse/forward reader, byte-proportional scrollbar) is P02. Historical: phase-1-plan.md/P01.md document the superseded A design as executed |
| 02 | P02 | ⬜ | - | - | - | ⬜ | File cursor + pager in alternate buffer — chunked reverse/forward reads over session-*.jsonl, byte-proportional scrollbar, resident window viewport+2 margins + byte floor, continuous eviction, context-floor hard stop (OQ7); OQ 1/2/3/5/6/8 all resolved |
| 03 | P03 | ⬜ | - | - | - | ⬜ | In-context markings + live boundary expander — OQ7 resolved: hard stop at oldest in-context item; UI-only markings are live-only per ruling 2 |
| 04 | P04 | ⬜ | - | - | - | ⬜ | Primary-buffer flush eviction; cursor-based resume — OQ2 resolved (terminal owns look-back in print-through mode; we evict after print) |
| 05 | P05 | ⬜ | - | - | - | ⬜ | DEFERRED by design: HistoryService itself file-driven |

Open decisions from design section 9 (PDF §9): NONE. OQ1-7 resolved
2026-09-18 on PR #3727; OQ8 resolved by Andrew's three rulings
(no duplicate file; no persisted UI state of any kind; no giant
in-memory map — scroll the file, LOW memory, high eviction).
Design sections 1-3 carry the final layout. P02 unblocked after P01b.
