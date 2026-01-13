# Notes: v0.11.3 → v0.12.0 Cherry-Pick

Tracking issue: https://github.com/vybestack/llxprt-code/issues/709

## Session Log

### 2026-01-08 - Initial Setup

- Created branch `20260108gmerge`
- Fetched upstream tags (v0.11.3, v0.12.0)
- Identified 135 commits in range
- Classified: 55 PICK, 67 SKIP, 13 REIMPLEMENT
- Created CHERRIES.md, SUMMARY.md, PLAN.md, PROGRESS.md

**Key decisions per user review:**
- `30dd2f1d` (todo tool docs) → SKIP: LLxprt has completely different todo implementation
- `ee92db75` (retry/fallback) → SKIP: LLxprt has different retry architecture, FlashFallback removed
- `e750da98` (console.error migration) → SKIP: LLxprt has DebugLogger

---

## Batch Notes

### Batch 01
*Notes will be added during execution*

### Batch 02
*Notes will be added during execution*

### Batch 03
*Notes will be added during execution*

### Batch 04
*Notes will be added during execution*

### Batch 05
*Notes will be added during execution*

### Batch 06
*Notes will be added during execution*

### Batch 07
*Notes will be added during execution*

### Batch 08
*Notes will be added during execution*

### Batch 09
*Notes will be added during execution*

### Batch 10
*Notes will be added during execution*

### Batch 11
*Notes will be added during execution*

---

## Issues Encountered

*Document any issues, conflicts, or deviations from the plan here*

---

## Follow-ups

*Document any items that need follow-up after the cherry-pick is complete*

- [ ] Review REIMPLEMENT commits for future implementation
- [ ] Consider extension manager refactoring needs
- [ ] Evaluate policy engine overlap with upstream
