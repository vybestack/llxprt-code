# Phase 01: Domain Analysis

## Phase ID
`PLAN-20250212-LSP.P01`

## Prerequisites
- Required: Phase 00a preflight verification completed
- Verification: Preflight verification gate all checkboxes checked
- Expected files from previous phase: `plan/00a-preflight-verification.md` with results filled in

## Requirements Implemented (Expanded)

This phase does not implement requirements directly. It produces the domain model that informs all subsequent implementation phases. The domain model MUST cover ALL REQ-* tags from `requirements.md`.

## Implementation Tasks

### Files to Create

- `analysis/domain-model.md` — Entity relationships, state transitions, business rules, edge cases, error scenarios
  - MUST cover all REQ-* tags
  - MUST include state transition diagrams for LspServiceClient, LspClient, and Orchestrator
  - MUST include edge case table with requirement references
  - MUST include error scenario matrix
  - MUST include data flow invariants

### Files to Modify

None.

### Required Code Markers

N/A — analysis phase, no code.

## Verification Commands

### Automated Checks

```bash
# Verify domain model exists
test -f project-plans/issue438/analysis/domain-model.md && echo "PASS" || echo "FAIL"

# Verify all requirement areas covered
for area in DIAG FMT TIME SCOPE KNOWN NAV LIFE ARCH GRACE CFG LANG BOUNDARY STATUS OBS PKG; do
  grep -c "REQ-${area}" project-plans/issue438/analysis/domain-model.md || echo "MISSING: REQ-${area}"
done
```

### Structural Verification Checklist
- [ ] Domain model file exists
- [ ] Entity relationships section present
- [ ] State transitions section present
- [ ] Business rules section present
- [ ] Edge cases section present
- [ ] Error scenarios section present
- [ ] All REQ-* areas referenced

### Deferred Implementation Detection (MANDATORY)

N/A — Analysis phase produces documentation only, not implementation code. No deferred-implementation risk.

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Does the domain model cover all behaviors from the specification?** — Check against overview.md B1-B8
2. **Are state transitions complete?** — Every state has defined entry and exit conditions
3. **Are edge cases grounded in requirements?** — Each edge case references a REQ-* ID
4. **Are error scenarios actionable?** — Each error has detection, recovery, and impact

#### Feature Actually Works

```bash
# Analysis phase — verify artifact is substantive:
wc -l project-plans/issue438/analysis/domain-model.md
# Expected: 200+ lines (comprehensive domain model, not a stub)

# Verify all 15 requirement areas referenced
AREAS=0; for area in DIAG FMT TIME SCOPE KNOWN NAV LIFE ARCH GRACE CFG LANG BOUNDARY STATUS OBS PKG; do
  grep -q "REQ-${area}" project-plans/issue438/analysis/domain-model.md && AREAS=$((AREAS+1))
done
echo "Covered $AREAS / 15 areas"
# Expected: 15 / 15
```

#### Integration Points Verified
- [ ] Domain model references specific files from technical-overview.md (e.g., orchestrator.ts, lsp-client.ts)
- [ ] State transitions align with pseudocode component boundaries
- [ ] Business rules traceable to requirements.md REQ-* IDs

#### Lifecycle Verified
- [ ] Server lifecycle states documented (starting → active → broken)
- [ ] Session lifecycle documented (init → running → shutdown)
- [ ] Diagnostic collection lifecycle documented (touch → wait → debounce → return)

#### Edge Cases Verified
- [ ] Binary file handling covered
- [ ] Workspace boundary enforcement covered
- [ ] Multiple servers per file extension covered
- [ ] Cold-start / first-touch timeout covered
- [ ] Service crash vs server crash distinction covered

## Success Criteria
- Domain model document is comprehensive and references all REQ-* areas
- No implementation details in the analysis (pure domain modeling)
- All B1-B8 behaviors from overview.md are addressed

## Failure Recovery
If this phase fails:
1. Delete: `analysis/domain-model.md`
2. Re-run analysis with corrected approach

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P01.md`
