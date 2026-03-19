# MessageBus DI Migration — Execution Tracker

Plan ID: PLAN-20260303-MESSAGEBUS
Created: 2026-03-03
Total Phases: 7

## Execution Status

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|---------|-----------|----------|-----------|-------|
| 00a | P00a | [ ] | - | - | - | N/A | Preflight verification |
| 01 | P01 | [ ] | - | - | - | [ ] | Optional parameters (Phase 1) |
| 01a | P01a | [ ] | - | - | - | [ ] | Verify optional parameters |
| 02 | P02 | [ ] | - | - | - | [ ] | Standardize constructors (Phase 2) |
| 02a | P02a | [ ] | - | - | - | [ ] | Verify standardized constructors |
| 03 | P03 | [ ] | - | - | - | [ ] | Mandatory injection (Phase 3) |
| 03a | P03a | [ ] | - | - | - | [ ] | Final verification |

Note: "Semantic?" column tracks whether semantic verification (feature actually works) was performed, not just structural verification (files exist).

## Completion Markers

Track completion marker files in `.completed/` directory:

- [ ] `.completed/P00a.md` - Preflight verification
- [ ] `.completed/P01.md` - Optional parameters
- [ ] `.completed/P01a.md` - Verify optional parameters
- [ ] `.completed/P02.md` - Standardize constructors
- [ ] `.completed/P02a.md` - Verify standardized constructors
- [ ] `.completed/P03.md` - Mandatory injection
- [ ] `.completed/P03a.md` - Final verification

## Critical Reminders

### Before Starting ANY Phase

1. [ ] Read the phase plan file completely
2. [ ] Verify previous phase completion marker exists
3. [ ] Check git status (clean working tree recommended)
4. [ ] Run baseline tests to ensure starting point is clean

### After Completing ANY Phase

1. [ ] Run all verification commands in phase file
2. [ ] Create completion marker with ACTUAL results (not placeholders)
3. [ ] Commit changes with phase ID in commit message
4. [ ] Update this tracker with completion date/status

### Phase Dependencies

- P01 requires P00a
- P01a requires P01
- P02 requires P01a
- P02a requires P02
- P03 requires P02a
- P03a requires P03

**DO NOT SKIP PHASES** — Each phase builds on the previous.

## Upstream Alignment

This migration reimplements three upstream commits:

| Upstream SHA | LLxprt Phases | Files Changed |
|--------------|---------------|---------------|
| eec5d5ebf839 | P01 + P01a | 16 files |
| 90be9c35876d | P02 + P02a | 23 files |
| 12c7c9cc426b | P03 + P03a | 57 files |

Total upstream: 96 files changed, 685 insertions, 402 deletions

## Scope Summary

- **Production files**: 33 files reference MessageBus
- **Test files**: 24 files reference MessageBus
- **Total references**: 717 lines (verified via grep)
- **Service locator calls**: 5 locations (to be removed)

## Success Criteria

Migration is complete when:

1. [ ] All 7 phases completed (markers exist)
2. [ ] Zero `config.getMessageBus()` references
3. [ ] Zero `setMessageBus()` methods
4. [ ] MessageBus is required parameter everywhere
5. [ ] All tests pass
6. [ ] TypeScript compiles
7. [ ] Build succeeds

## Risk Mitigation

- **Moderate implementation risk**: 96 files to modify across 3 phases
- **Low behavioral risk**: Pure structural refactoring, no API changes
- **Mitigation**: Follow upstream diffs, maintain backward compatibility through P1-P2, verify after each phase

## Notes

[Add execution notes, blockers, or discoveries here as you execute phases]
