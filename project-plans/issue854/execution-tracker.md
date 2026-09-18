# Execution Tracker — Issue 854 File-Driven Scrollback

Design: `issue-854-design.md` · Phase 1 plan: `phase-1-plan.md`

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|---------|-----------|----------|-----------|-------|
| 0.5 | P0.5 | ✅ | 2026-09-17 | 2026-09-17 | 2026-09-17 | N/A | Preflight: tables filled in phase-1-plan.md; REQ-854-003 live stamping flagged blocked (see plan) |
| 01 | P01 | ✅ | 2026-09-17 | 2026-09-18 | 2026-09-18 | ✅ | Foundation: journal + index writer, seq stamps, getContextRange + event, settings flag — marker `.completed/P01.md`; fix session: journal creation made lazy (recording path null at render → journal never created; smoke proved it) + end-to-end sidecar proof; full-suite 26,673 pass with 5 cli-args profile failures proven pre-existing on origin/main (wt-main-test.log), 4 runner-fixture flakes 34/34 isolated (wsc-retest.log); lint exit 0 |
| 02 | P02 | ⬜ | - | - | - | ⬜ | ScrollbackPager in alternate buffer (blocked on Andrew's OQ decisions 1–3) |
| 03 | P03 | ⬜ | - | - | - | ⬜ | In-context markings + summary expander |
| 04 | P04 | ⬜ | - | - | - | ⬜ | Primary-buffer flush eviction; journal-backed resume |
| 05 | P05 | ⬜ | - | - | - | ⬜ | DEFERRED by design: HistoryService itself file-driven |

Open decisions from design section 9 (PDF §9) gating P02–P04 details:
Static-remount reprint scope; primary-buffer eviction-only scope; budget
knobs/defaults; sparse index fallback; stale-until-paged updateItem;
scrollbar stability; clear-marker crossing.
