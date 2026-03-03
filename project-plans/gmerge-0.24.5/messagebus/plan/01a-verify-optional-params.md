# Phase 01a: Verify Optional MessageBus Parameters

## Phase ID
`PLAN-20260303-MESSAGEBUS.P01a`

## Prerequisites
- Phase 01 completed

## Requirements Implemented
None — verification only.

## Verification Tasks

### 1. Structural Verification
```bash
# CoreToolScheduler accepts optional messageBus
grep -n "messageBus" packages/core/src/core/coreToolScheduler.ts | head -10

# ToolRegistry accepts optional messageBus
grep -n "messageBus" packages/core/src/tools/tool-registry.ts | head -10

# createMockMessageBus exists
grep -rn "createMockMessageBus" packages/core/src/test-utils/

# Tests pass explicit MessageBus
grep -rn "createMockMessageBus\|mockMessageBus" packages/ --include="*.test.ts" | wc -l
```

### 2. Backward Compatibility Check
```bash
# config.getMessageBus() still exists (removed in Phase 3)
grep -n "getMessageBus" packages/core/src/config/config.ts
```

### 3. Full Test Suite
```bash
npm run typecheck
npm run test
npm run lint
```

## Success Criteria
- All structural checks pass
- `config.getMessageBus()` still exists (Phase 1 is additive only)
- All tests pass
- No behavior changes

## Failure Recovery
If tests fail, compare with upstream `eec5d5ebf839` diff to identify missed changes.

## Structural Verification Checklist

- [ ] `CoreToolScheduler` accepts optional `messageBus` parameter
- [ ] `ToolRegistry` accepts optional `messageBus` parameter
- [ ] `createMockMessageBus()` helper exists and is used in tests
- [ ] Tests pass MessageBus explicitly (verified by grep)
- [ ] `config.getMessageBus()` still exists (Phase 3 removes it)
- [ ] All @plan:PLAN-20260303-MESSAGEBUS.P01 markers present
- [ ] TypeScript compiles without errors
- [ ] All tests pass
- [ ] Lint passes

## Semantic Verification Checklist

**Behavioral Verification Questions**:

1. **Does the code DO what Phase 1 requires?**
   - [ ] Optional parameter pattern works correctly
   - [ ] Fallback to `config.getMessageBus()` functions
   - [ ] Both code paths tested

2. **Would the tests FAIL if implementation was removed?**
   - [ ] Tests create and pass MessageBus
   - [ ] Removing fallback logic would break tests that don't pass MessageBus
   - [ ] Tests verify MessageBus propagation

3. **Is the feature REACHABLE and BACKWARD COMPATIBLE?**
   - [ ] Old code (not passing MessageBus) still works
   - [ ] New code (passing MessageBus) works correctly
   - [ ] No breaking changes introduced

4. **Integration Points Verified**:
   - [ ] ToolRegistry → Tool.createInvocation() passes MessageBus
   - [ ] Tests → mock MessageBus integration
   - [ ] Config.getMessageBus() fallback active

5. **What's MISSING before proceeding to Phase 2?**
   - [ ] N/A or [list any gaps]

## Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK in Phase 1 changes
git diff main -- packages/core/src/ | grep -E "(TODO|FIXME|HACK|STUB|XXX)"
# Expected: No matches (or only in comments explaining design decisions)

# Check for placeholder implementations
git diff main -- packages/core/src/ | grep -E "return null|return undefined|throw new Error\('not implemented'\)"
# Expected: No matches in implementation code
```

## Phase Completion Marker

**Create**: `project-plans/gmerge-0.24.5/messagebus/.completed/P01a.md`

**Contents**:
```markdown
# Phase 01a: Verify Optional Parameters — COMPLETED

**Completed**: YYYY-MM-DD HH:MM
**Phase 01 Status**: Verified and ready for Phase 2

## Verification Results

### Structural Checks
- CoreToolScheduler accepts optional messageBus: PASS
- ToolRegistry accepts optional messageBus: PASS
- createMockMessageBus exists: PASS
- Tests updated: PASS (~12 files)

### Backward Compatibility
```bash
# config.getMessageBus() still exists
grep -n "getMessageBus" packages/core/src/config/config.ts
# Result: [paste line number — should exist]
```

### Test Suite Status
```
[Paste npm run test summary]
All tests passing: YES/NO
```

### Deferred Implementation Check
```
No TODO/FIXME/HACK in Phase 1 implementation: PASS
No placeholder returns: PASS
```

## Gate Decision: PROCEED TO PHASE 2
All structural and semantic verifications passed. Phase 1 is complete and backward-compatible.
```
