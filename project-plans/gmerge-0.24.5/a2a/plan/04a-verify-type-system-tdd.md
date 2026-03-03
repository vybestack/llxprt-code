# Phase 04a: Verify Type System Evolution - TDD

## Phase ID

`PLAN-20260302-A2A.P04a`

## Prerequisites

- Required: Phase 04 completed
- Verification: Test file `packages/core/src/agents/__tests__/types.test.ts` exists with behavioral tests

## Purpose

Verify that Phase 04 correctly implemented behavioral tests for the discriminated union type system. Tests must verify actual type narrowing behavior, not just structure.

## Verification Commands

### Structural Verification

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20260302-A2A.P04" packages/core/src/agents/__tests__/types.test.ts
# Expected: 10+ occurrences (one per test)

# Check requirements covered
grep -c "@requirement:A2A-REG-001" packages/core/src/agents/__tests__/types.test.ts
# Expected: 10+ occurrences

# Check for @scenario markers
grep -c "@scenario" packages/core/src/agents/__tests__/types.test.ts
# Expected: 10+ occurrences

# Run all tests
npm test -- packages/core/src/agents/__tests__/types.test.ts
# Expected: All tests PASS

# Check for @ts-expect-error annotations
grep -c "@ts-expect-error" packages/core/src/agents/__tests__/types.test.ts
# Expected: 1+ occurrences (documenting expected compile errors)

# Check for TODO/FIXME markers
grep -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/agents/__tests__/types.test.ts
# Expected: No matches
```

### Semantic Verification

**Answer ALL questions before proceeding:**

#### 1. Does the code DO what the requirement says?

- [ ] **I READ the actual test file** (all describe blocks and tests)
- [ ] **Tests verify local narrowing**: When `definition.kind === 'local'`, tests access promptConfig/modelConfig/runConfig successfully
- [ ] **Tests verify remote narrowing**: When `definition.kind === 'remote'`, tests access agentCardUrl successfully
- [ ] **Tests verify field exclusion**: `@ts-expect-error` documents that accessing promptConfig on RemoteAgentDefinition fails at compile time
- [ ] **Tests verify common fields**: name, displayName, description, inputConfig accessible on both types without narrowing
- [ ] **Tests verify type guards**: Custom type guard functions work correctly

**How I verified:**
```
Read full types.test.ts file. Confirmed:
- describe('LocalAgentDefinition'): 3+ tests checking type narrowing to local
- describe('RemoteAgentDefinition'): 3+ tests checking type narrowing to remote
- describe('Type Guards and Discrimination'): Tests for runtime discrimination
- describe('BaseAgentDefinition Common Fields'): Tests for fields accessible on both types
- All tests use real AgentDefinition objects (not mocks)
- Tests verify actual TypeScript behavior via expect() assertions
```

#### 2. Is this REAL implementation, not placeholder?

- [ ] **No mocking**: Tests use real objects, not jest.fn() or vi.fn()
- [ ] **No structure-only tests**: Tests verify VALUES (not just `toBeDefined()` or `toHaveProperty()`)
- [ ] **Tests would FAIL if types broken**: If LocalAgentDefinition didn't have promptConfig, narrowing tests would fail
- [ ] **All tests PASS**: Ran `npm test -- types.test.ts` and all tests passed

**How I verified:**
```
grep "toHaveBeenCalled\|mock" types.test.ts returned no matches (no mocking)
All tests use expect().toBe() or expect().toBeDefined() with actual value checks
Tests verify specific field values (e.g., expect(def.promptConfig.systemPrompt).toBe('Test'))
npm test output shows all tests passing
```

#### 3. Would tests FAIL if implementation was removed?

- [ ] **Type narrowing test failure**: If narrowing didn't work, tests accessing `def.promptConfig` after `if (def.kind === 'local')` would fail
- [ ] **@ts-expect-error failure**: If RemoteAgentDefinition incorrectly had promptConfig, the `@ts-expect-error` annotation would cause compile error (test of test)
- [ ] **Common fields test failure**: If inputConfig wasn't on BaseAgentDefinition, common fields tests would fail

**How I verified:**
```
Mentally removed promptConfig from LocalAgentDefinition:
  - narrowing tests would fail with "Property 'promptConfig' does not exist"
Added promptConfig to RemoteAgentDefinition mentally:
  - @ts-expect-error test would fail compilation (expected error didn't happen)
Tests are coupled to actual type behavior, not just passing trivially
```

#### 4. Is the feature REACHABLE by test runner?

- [ ] **Test file in correct location**: `packages/core/src/agents/__tests__/types.test.ts`
- [ ] **Imports work**: All imports from `../types.js` resolve correctly
- [ ] **Vitest recognizes file**: `npm test -- types.test.ts` finds and runs the tests
- [ ] **All describe blocks execute**: Test output shows all 4 describe blocks ran

**How I verified:**
```
ls packages/core/src/agents/__tests__/types.test.ts confirms file exists
npm test -- types.test.ts output shows:
  - AgentDefinition Types
    - LocalAgentDefinition (3 tests)
    - RemoteAgentDefinition (3 tests)
    - Type Guards and Discrimination (2 tests)
    - BaseAgentDefinition Common Fields (4 tests)
Total: 12+ tests, all passing
```

#### 5. What's MISSING?

**Acceptable for TDD phase:**
- [ ] Runtime validation tests (scheduled for P05)
- [ ] Integration tests with registry/executor (scheduled for P18-P31)
- [ ] Actual agent execution tests (in executor.test.ts, invocation.test.ts)

**Blockers (should NOT be present):**
- [ ] None identified

**How I verified:**
```
This is TDD phase for TYPE SYSTEM only
Missing validation/integration is expected (those are later phases)
No blockers found that would prevent P05 from proceeding
```

### Anti-Patterns Check

**Tests must NOT have these anti-patterns:**

```bash
# NO mock theater
grep -E "toHaveBeenCalled|toHaveBeenCalledWith|mock" packages/core/src/agents/__tests__/types.test.ts
# Expected: No matches

# NO structure-only tests (except for existence checks)
grep "toHaveProperty" packages/core/src/agents/__tests__/types.test.ts | grep -v "specific value"
# Expected: No matches (or very few, with justification)

# NO reverse testing
grep -E "toThrow.*NotYetImplemented|not\.toThrow" packages/core/src/agents/__tests__/types.test.ts
# Expected: No matches

# NO NotYetImplemented expectations
grep "NotYetImplemented" packages/core/src/agents/__tests__/types.test.ts
# Expected: No matches
```

## Success Criteria

- [ ] All structural checks PASS
- [ ] All semantic verification questions answered YES
- [ ] 10+ tests exist (at least 3 per major scenario)
- [ ] All tests PASS
- [ ] No anti-patterns detected (no mocking, no structure-only tests)
- [ ] Tests verify actual TypeScript narrowing behavior
- [ ] `@ts-expect-error` used to document expected compile errors
- [ ] Ready to proceed to P05 (Implementation phase)

## Test Coverage Matrix

Verify coverage across all requirements:

| Scenario | Tests | Status |
|----------|-------|--------|
| Local agent type narrowing | 3+ | [ ] |
| Remote agent type narrowing | 3+ | [ ] |
| Type guards and discrimination | 2+ | [ ] |
| Common fields (BaseAgentDefinition) | 4+ | [ ] |
| **Total** | **12+** | [ ] |

All rows must have status checked before proceeding.

## Failure Recovery

If verification fails:

1. **Structural failures** (missing markers, wrong imports):
   - Return to P04
   - Fix test structure
   - Re-run verification

2. **Semantic failures** (tests don't test behavior):
   - Return to P04
   - Rewrite tests to test ACTUAL narrowing (not just structure)
   - Ensure tests would fail if types were broken
   - Re-run verification

3. **Anti-pattern failures** (mocking, structure-only tests):
   - Return to P04
   - Remove mocks, replace with real objects
   - Replace `toHaveProperty()` with value checks
   - Re-run verification

## Verification Report Template

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P04a-report.md`

```markdown
# Phase 04 Verification Report

**Verified by:** [subagent/human name]
**Date:** [YYYY-MM-DD HH:MM]

## Structural Checks
- [ ] Plan markers: [count]/10+ found
- [ ] Requirement markers: [count]/10+ found
- [ ] Scenario markers: [count]/10+ found
- [ ] @ts-expect-error annotations: [count]/1+ found
- [ ] No TODO/STUB comments

## Semantic Checks
- [ ] Local narrowing tests verify accessing promptConfig/modelConfig/runConfig
- [ ] Remote narrowing tests verify accessing agentCardUrl
- [ ] @ts-expect-error tests document expected compile errors
- [ ] Common fields tests verify name/displayName/description/inputConfig
- [ ] Type guard tests verify custom type predicate functions

## Test Execution
- [ ] All tests PASS
- [ ] Total tests: [count] (expected 12+)
- [ ] Test coverage matrix complete

## Anti-Patterns Check
- [ ] No mocking detected
- [ ] No structure-only tests
- [ ] No reverse testing
- [ ] No NotYetImplemented expectations

## Issues Found
- [List any issues, or "None"]

## Verification Result
[PASS/FAIL] - [Ready for P05 / Must remediate issues]

**Test execution output:**
```
[paste npm test output here]
```
```

## Next Phase

After successful verification:
- **Proceed to Phase 05**: Type System Evolution - Implementation
- Phase 05 will implement runtime validation and type guard utilities
