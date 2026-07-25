# Issue #2666 — OCR Auto-Review Limit & Suspension Mechanism

## Scope Ledger

### In scope
- `.github/workflows/ocr-review.yml`: auto-review-limit decision, suspension message, counter increment, `/review` alias, `issue_comment.edited` trigger
- New behavioral test file under `scripts/tests/`
- Minimal updates to existing workflow-wiring tests to accommodate new job structure

### Explicit non-goals
- NOT modifying `.github/workflows/_pr-mergeability-gate.yml` (shared pure mergeability oracle used by 3 workflows; has only `pull-requests: read`, no `issues: read`)
- NOT modifying `pr-review.yml` or `e2e.yml`
- NOT adding PR labels (Approach B) — deferred; Approach A (hidden comment data) is primary
- NOT implementing incremental reviews (#2649 is complementary)
- NOT implementing a `resume` slash command beyond checkbox + existing manual commands
- NOT changing the fork-safety model or trusted-base checkout

### Hard scope budget
- Target: ≤ 4 files, ≤ 600 net changed lines (well under 25-file / 1500-line ceiling)

## Architectural decision

The shared gate stays a **pure mergeability oracle**. Auto-review-limit is an
**OCR-owned concern** implemented as a new job in `ocr-review.yml`:

```
mergeability-gate (unchanged, shared) → auto-review-gate (NEW, OCR) → code-review / post-suspension
```

State storage: **Approach A** — hidden HTML comments in the sticky summary comment:
- `<!-- ocr-auto-count:N -->`
- `<!-- ocr-suspended:true -->`

## Acceptance Matrix

| AC | Behavior | Trigger / State | Expected outcome |
|----|----------|-----------------|------------------|
| 1 | After 2 auto reviews, 3rd sync skips OCR | pull_request_target synchronize, count=2 | code-review skipped; suspended=true |
| 2 | Suspension message posted | suspended=true | sticky comment: header, count/limit, checkbox `[ ]`, `/review` instructions |
| 3 | Checkbox edit resets counter | issue_comment.edited, `[ ]`→`[x]` on bot OCR comment | counter→0, review runs |
| 4 | Post-reset push allows 2 more | count=0 | reviews 1,2 run; 3rd suspends |
| 5 | Manual commands always run | issue_comment /ocr /open-code-review /review | should-run=true regardless of suspension |
| 6 | Manual reviews don't increment counter | manual trigger | counter unchanged |
| 7 | Configurable via OCR_AUTO_REVIEW_LIMIT | var=3 | limit=3 enforced |
| 8 | Counter persists across runs | multiple runs | read from sticky comment |
| 9 | Suspension message clear & actionable | — | header + count + limit + checkbox + instructions |

## Bounded vertical slices
1. **Slice 1**: auto-review-gate decision logic (count vs limit, manual bypass) + tests
2. **Slice 2**: suspension message rendering + counter increment + tests
3. **Slice 3**: `issue_comment.edited` checkbox reset + `/review` alias + tests
