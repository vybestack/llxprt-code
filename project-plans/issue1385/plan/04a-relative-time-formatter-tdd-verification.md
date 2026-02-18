# Phase 04a: Relative Time Formatter — TDD Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P04a`

## Prerequisites
- Required: Phase 04 completed
- Verification: `test -f project-plans/issue1385/.completed/P04.md`

## Verification Commands

```bash
# Test file exists
test -f packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts || echo "FAIL"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P04" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts
# Expected: 1+

# Count behavioral test cases (not property tests)
grep -c "it(" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts
# Expected: 25+

# Property-based tests present
grep -c "fc\.\|fast-check\|property" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts
# Expected: 3+

# Property test percentage
TOTAL=$(grep -c "it(" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts)
PROP=$(grep -c "fc\.\|property" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts)
echo "Property tests: $PROP / $TOTAL"
# Expected: >= 30%

# No mock theater
grep "toHaveBeenCalled\|vi.spyOn\|jest.spyOn\|vi.fn\|jest.fn\|\.mock\b" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts && echo "FAIL: mock theater" || echo "OK"

# No reverse testing
grep "NotYetImplemented\|not.toThrow" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts && echo "FAIL: reverse testing" || echo "OK"

# Tests fail against stub (expected at this phase)
cd packages/cli && npx vitest run src/utils/__tests__/formatRelativeTime.spec.ts 2>&1 | tail -10
# Expected: Tests FAIL because stub returns ''
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do tests verify REAL behavior?**
   - [ ] Tests expect actual time strings ("just now", "5 minutes ago", etc.)
   - [ ] Tests use deterministic `now` parameter
   - [ ] Tests cover all threshold boundaries
2. **Would tests FAIL if implementation was wrong?**
   - [ ] Each test checks a specific output string
   - [ ] Boundary tests would catch off-by-one errors
3. **Are property tests meaningful?**
   - [ ] Properties express actual invariants (non-empty, monotonic, future clamping)
   - [ ] Not just "runs without error"

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P04a.md`

## Requirements Implemented (Expanded)

- This phase advances PLAN-20260214-SESSIONBROWSER with requirement-traceable outputs for the stated phase scope.

## Implementation Tasks

- Execute the scoped file updates for this phase only.
- Preserve @plan, @requirement, and @pseudocode traceability markers where applicable.

## Deferred Implementation Detection

```bash
rg -n "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented" [modified-files]
```

## Feature Actually Works

- Manual verification is required for this phase before completion is marked.

## Integration Points Verified

- Verify caller/callee boundaries for every touched integration point.

## Success Criteria

- All phase verification checks pass.
- Scope-complete deliverables are present.

### Semantic Verification Questions (YES required)

1. YES/NO — Does the implementation satisfy the phase requirements behaviorally, not just structurally?
2. YES/NO — Would phase tests fail if the implementation were removed or broken?
3. YES/NO — Are integration boundaries validated with real caller/callee data flow checks?
4. YES/NO — Are error and edge-case paths verified for this phase scope?
5. YES/NO — Is this phase complete without deferred placeholders or hidden TODO work?
