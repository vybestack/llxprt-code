# Phase 10a: performResume — TDD Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P10a`

## Prerequisites
- Required: Phase 10 completed
- Verification: `test -f project-plans/issue1385/.completed/P10.md`

## Verification Commands

```bash
# Test file exists
test -f packages/cli/src/services/__tests__/performResume.spec.ts || echo "FAIL"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P10" packages/cli/src/services/__tests__/performResume.spec.ts
# Expected: 1+

# Test count
TOTAL=$(grep -c "it(" packages/cli/src/services/__tests__/performResume.spec.ts)
echo "Total tests: $TOTAL"
# Expected: 24+

# Property tests
PROP=$(grep -c "fc\.\|property" packages/cli/src/services/__tests__/performResume.spec.ts)
echo "Property tests: $PROP"
# Expected: 3+

# Coverage of key behaviors
grep -c "same.*session\|already active" packages/cli/src/services/__tests__/performResume.spec.ts
# Expected: 1+
grep -c "locked\|in use" packages/cli/src/services/__tests__/performResume.spec.ts
# Expected: 1+
grep -c "latest" packages/cli/src/services/__tests__/performResume.spec.ts
# Expected: 2+
grep -c "two-phase\|Phase 1\|Phase 2\|dispose" packages/cli/src/services/__tests__/performResume.spec.ts
# Expected: 3+

# No mock theater
grep "vi.mock\|jest.mock" packages/cli/src/services/__tests__/performResume.spec.ts && echo "FAIL: mock theater" || echo "OK"

# Uses real filesystem
grep "mkdtemp\|tmpdir\|writeFile" packages/cli/src/services/__tests__/performResume.spec.ts || echo "WARN: may not use real filesystem"

# Tests fail against stub
cd packages/cli && npx vitest run src/services/__tests__/performResume.spec.ts 2>&1 | tail -10
# Expected: FAIL
```

### Semantic Verification Checklist
- [ ] Tests verify actual return values (ok, error, history)
- [ ] Tests cover all error conditions (same-session, locked, missing, ambiguous, out-of-range)
- [ ] Tests verify two-phase swap ordering
- [ ] Tests verify Phase 1 failure safety (old session untouched)
- [ ] Tests verify Phase 2 disposal sequence
- [ ] Tests verify lock release failure tolerance
- [ ] Property tests express meaningful invariants

## Failure Recovery
```bash
git checkout -- packages/cli/src/services/__tests__/performResume.spec.ts
rm -f packages/cli/src/services/__tests__/performResume.spec.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P10a.md`

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
