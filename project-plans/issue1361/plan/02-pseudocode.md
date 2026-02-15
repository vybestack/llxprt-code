# Phase 02: Pseudocode Development

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P02`

## Prerequisites
- Required: Phase 01a completed
- Verification: `test -f project-plans/issue1361/.completed/P01a.md`

## Requirements Implemented (Expanded)

This phase produces numbered pseudocode for all 8 components. No code is written — only algorithmic design.

### Pseudocode Scope
**Full Text**: Create detailed, numbered pseudocode for each component in the Session Recording Service, covering types, algorithms, error handling, and integration points.
**Behavior**:
- GIVEN: The specification and domain model
- WHEN: Pseudocode is developed for each component
- THEN: Every algorithm is documented with numbered lines, integration points are explicit, and anti-patterns are warned against
**Why This Matters**: Implementation phases MUST reference pseudocode line numbers. Without numbered pseudocode, there's no traceability from design to code.

## Implementation Tasks

### Files to Create
- `project-plans/issue1361/analysis/pseudocode/session-recording-service.md` — Core writer (#1362)
- `project-plans/issue1361/analysis/pseudocode/replay-engine.md` — Replay (#1363)
- `project-plans/issue1361/analysis/pseudocode/recording-integration.md` — HistoryService wiring (#1364)
- `project-plans/issue1361/analysis/pseudocode/resume-flow.md` — --continue (#1365)
- `project-plans/issue1361/analysis/pseudocode/session-management.md` — list/delete (#1366)
- `project-plans/issue1361/analysis/pseudocode/concurrency-lifecycle.md` — Locks + shutdown (#1367)
- `project-plans/issue1361/analysis/pseudocode/old-system-removal.md` — Cleanup of old code (#1368)
- `project-plans/issue1361/analysis/pseudocode/session-cleanup.md` — Cleanup adaptation (#1369)

### Required Pseudocode Sections (per file)
1. Interface Contracts (inputs, outputs, dependencies)
2. Integration Points (with line references)
3. Anti-Pattern Warnings
4. Numbered algorithmic steps (10, 11, 12, ...)

## Verification Commands

```bash
# All 8 pseudocode files exist
for f in session-recording-service replay-engine recording-integration resume-flow session-management concurrency-lifecycle old-system-removal session-cleanup; do
  test -f "project-plans/issue1361/analysis/pseudocode/$f.md" || echo "FAIL: Missing $f.md"
done

# Each file has numbered lines
for f in project-plans/issue1361/analysis/pseudocode/*.md; do
  COUNT=$(grep -cE "^\d+:" "$f" 2>/dev/null || echo 0)
  echo "$f: $COUNT numbered lines"
  [ "$COUNT" -lt 10 ] && echo "FAIL: $f has insufficient numbered lines"
done

# Each file has interface contracts
for f in project-plans/issue1361/analysis/pseudocode/*.md; do
  grep -q "Interface Contract" "$f" || echo "FAIL: $f missing Interface Contracts"
done

# Each file has integration points
for f in project-plans/issue1361/analysis/pseudocode/*.md; do
  grep -q "Integration Point" "$f" || echo "FAIL: $f missing Integration Points"
done
```

## Success Criteria
- All 8 pseudocode files created with numbered lines
- Each file has 10+ numbered algorithmic steps
- Interface contracts defined for each component
- Integration points explicitly documented
- Anti-pattern warnings included

## Failure Recovery
Re-read specification and domain model, regenerate missing pseudocode files.

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P02.md`
