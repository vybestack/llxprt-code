# Execution Tracker — Issue 854 File-Driven Scrollback

Design: `issue-854-design.md` · Phase 1 plan: `phase-1-plan.md`

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|---------|-----------|----------|-----------|-------|
| 0.5 | P0.5 | ⬜ | - | - | - | N/A | Preflight: fill tables in phase-1-plan.md |
| 01 | P01 | ⬜ | - | - | - | ⬜ | Foundation: journal + index writer, seq stamps, getContextRange + event, settings flag |
| 02 | P02 | ⬜ | - | - | - | ⬜ | ScrollbackPager in alternate buffer (blocked on Andrew's OQ decisions 1–3) |
| 03 | P03 | ⬜ | - | - | - | ⬜ | In-context markings + summary expander |
| 04 | P04 | ⬜ | - | - | - | ⬜ | Primary-buffer flush eviction; journal-backed resume |
| 05 | P05 | ⬜ | - | - | - | ⬜ | DEFERRED by design: HistoryService itself file-driven |

Open decisions from design section 9 (PDF §9) gating P02–P04 details:
Static-remount reprint scope; primary-buffer eviction-only scope; budget
knobs/defaults; sparse index fallback; stale-until-paged updateItem;
scrollbar stability; clear-marker crossing.
