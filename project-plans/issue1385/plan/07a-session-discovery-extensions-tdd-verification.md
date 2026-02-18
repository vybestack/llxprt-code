# Phase 07a: Session Discovery Extensions — TDD Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P07a`

## Prerequisites
- Required: Phase 07 completed
- Verification: `test -f project-plans/issue1385/.completed/P07.md`

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts || echo "FAIL"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P07" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts
# Expected: 1+

# Count test cases
TOTAL=$(grep -c "it(" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts)
echo "Total tests: $TOTAL"
# Expected: 28+

# Property-based tests
PROP=$(grep -c "fc\.\|property" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts)
echo "Property tests: $PROP"
# Expected: 3+

# Coverage of all three methods
grep -c "hasContentEvents" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts
# Expected: 5+
grep -c "listSessionsDetailed" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts
# Expected: 4+
grep -c "readFirstUserMessage" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts
# Expected: 10+

# No mock theater
grep "vi.mock\|jest.mock\|toHaveBeenCalled\|vi.fn\|jest.fn" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts && echo "FAIL: mock theater" || echo "OK"

# No reverse testing
grep "NotYetImplemented\|not.toThrow" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts && echo "FAIL: reverse testing" || echo "OK"

# Tests use real filesystem
grep "mkdtemp\|tmpdir\|writeFile" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts || echo "WARN: may not use real filesystem"

# Tests fail against stubs (expected)
cd packages/core && npx vitest run src/recording/__tests__/SessionDiscovery.extensions.spec.ts 2>&1 | tail -10
# Expected: FAIL
```

### Semantic Verification Checklist
- [ ] Tests create real JSONL files in temp directories
- [ ] Tests verify actual return values, not just "no throw"
- [ ] hasContentEvents tests cover: empty, non-empty, missing file, empty file
- [ ] listSessionsDetailed tests cover: all valid, mix, all corrupted, empty dir
- [ ] readFirstUserMessage tests cover: single msg, multiple, no user msg, mixed parts, truncation, bad schema, missing file
- [ ] Property tests express meaningful invariants
- [ ] Tests clean up temp directories

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P07a.md`

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
