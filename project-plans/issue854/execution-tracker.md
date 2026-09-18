# Execution Tracker — Issue 854 File-Driven Scrollback

Design: `issue-854-design.md` · Phase 1 plan: `phase-1-plan.md`

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|---------|-----------|----------|-----------|-------|
| 0.5 | P0.5 | ✅ | 2026-09-17 | 2026-09-17 | 2026-09-17 | N/A | Preflight: tables filled in phase-1-plan.md; REQ-854-003 live stamping flagged blocked (see plan) |
| 01 | P01 | [OK] | 2026-09-17 | 2026-09-18 | 2026-09-18 | [OK] | Foundation: journal + index writer, seq stamps, getContextRange + event, settings flag — marker `.completed/P01.md`; fix session: journal creation made lazy (recording path null at render → journal never created; smoke proved it) + end-to-end sidecar proof; full-suite 26,673 pass with 5 cli-args profile failures proven pre-existing on origin/main (wt-main-test.log), 4 runner-fixture flakes 34/34 isolated (wsc-retest.log); lint exit 0; PR #3727 CI fully green 2026-09-18 (41 pass/0 fail) after two CI-only catches: prettier rewrap of late fix files, and `schema:settings`+`docs:settings` regeneration for the new setting (the scripts meta-shard checks these; local `npm run test` does not cover `scripts/tests/` — regenerate after any schema-ui.ts edit) |
| 02 | P02 | ⬜ | - | - | - | ⬜ | ScrollbackPager in alternate buffer — OQ 1/3/5/6 resolved 2026-09-18 (PR #3727): resident-only remount, row-based viewport+2 margin + byte floor, continuous eviction, in-memory heights; blocked only on OQ8 sidecar fork (A self-contained vs B page-from-session-journal) |
| 03 | P03 | ⬜ | - | - | - | ⬜ | In-context markings + summary expander — OQ7 resolved: hard stop at oldest in-context item, no cleared-history affordance; blocked only on OQ8 |
| 04 | P04 | ⬜ | - | - | - | ⬜ | Primary-buffer flush eviction; journal-backed resume — OQ2 resolved (terminal owns look-back in print-through mode; we evict after print); blocked only on OQ8 |
| 05 | P05 | ⬜ | - | - | - | ⬜ | DEFERRED by design: HistoryService itself file-driven |

Open decisions from design section 9 (PDF §9) gating P02–P04 details:
OQ8 only — sidecar fork A (self-contained sb journal, recommended) vs B
(page conversation payloads from session-*.jsonl). OQ1-7 resolved
2026-09-18 on PR #3727; see design §9 resolutions.
