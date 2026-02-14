# Phase 01a: Analysis Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P01a`

## Prerequisites
- Required: Phase 01 completed
- Verification: `test -f project-plans/issue1361/analysis/domain-model.md`

## Verification Commands

```bash
# File exists
test -f project-plans/issue1361/analysis/domain-model.md || echo "FAIL: domain-model.md missing"

# Core entities covered
for entity in "SessionRecordingService" "ReplayEngine" "SessionDiscovery" "SessionLockManager" "SessionRecordLine"; do
  grep -q "$entity" project-plans/issue1361/analysis/domain-model.md || echo "FAIL: Missing entity $entity"
done

# State transitions present
grep -q "State Transition\|→\|CREATED\|RECORDING\|DISABLED" project-plans/issue1361/analysis/domain-model.md || echo "FAIL: Missing state transitions"

# Edge cases present
grep -q "Edge Case\|ENOSPC\|corruption\|stale" project-plans/issue1361/analysis/domain-model.md || echo "FAIL: Missing edge cases"

# Error scenarios present
grep -q "Error Scenario\|error\|failure" project-plans/issue1361/analysis/domain-model.md || echo "FAIL: Missing error scenarios"
```

## Semantic Verification
- [ ] Domain model addresses all 8 sub-issues
- [ ] No implementation details in analysis (pure domain concepts)
- [ ] Business rules are complete and non-contradictory
- [ ] Edge cases cover the "big three": crash safety, corruption handling, concurrent access

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P01a.md`
