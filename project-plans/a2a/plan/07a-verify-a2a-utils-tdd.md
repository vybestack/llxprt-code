# Phase 07a: Verify A2A Utilities - TDD

## Phase ID

`PLAN-20260302-A2A.P07a`

## Prerequisites

- Required: Phase 07 completed
- Verification: File `packages/core/src/agents/__tests__/a2a-utils.test.ts` exists with behavioral tests

## Purpose

Verify that Phase 07 correctly implemented behavioral tests for A2A utility functions. This verification phase checks that tests are truly behavioral (testing data transformation, not mocks) and that they fail against stubs (proving they test real behavior).

## Verification Commands

### Structural Verification

```bash
# Check file exists
ls packages/core/src/agents/__tests__/a2a-utils.test.ts
# Expected: File exists

# Check plan markers
grep -c "@plan PLAN-20260302-A2A.P07" packages/core/src/agents/__tests__/a2a-utils.test.ts
# Expected: 21+ (one per test)

# Check requirement markers
grep -c "@requirement A2A-EXEC" packages/core/src/agents/__tests__/a2a-utils.test.ts
# Expected: 21+ (each test has requirement marker)

# Check for mocks (should be NONE)
grep -E "(vi\.mock|jest\.mock|createMock|spy)" packages/core/src/agents/__tests__/a2a-utils.test.ts
# Expected: No matches (no mocking)

# Run tests (SHOULD FAIL against stubs)
npm test -- packages/core/src/agents/__tests__/a2a-utils.test.ts 2>&1 | tee /tmp/test-output.txt
grep -E "(FAIL|failing)" /tmp/test-output.txt
# Expected: Tests fail (stubs return empty/wrong values)

# Count tests
grep -c "it('should" packages/core/src/agents/__tests__/a2a-utils.test.ts
# Expected: 21+ tests
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME markers
grep -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/agents/__tests__/a2a-utils.test.ts
# Expected: No matches
```

### Semantic Verification

**Answer ALL questions before proceeding:**

#### 1. Does the code DO what the requirement says?

- [ ] **I READ the test file** (all describe blocks and tests)
- [ ] **extractMessageText tests**: Verify actual text extraction from TextPart, DataPart, FilePart
- [ ] **extractTaskText tests**: Verify task state and status message extraction
- [ ] **extractIdsFromResponse tests**: Verify taskId clearing for terminal states (completed, failed, canceled)
- [ ] **extractIdsFromResponse tests**: Verify taskId preservation for non-terminal states (working, submitted, input-required)
- [ ] **All tests have markers**: @plan PLAN-20260302-A2A.P07, @requirement, @scenario

**How I verified:**
```
Read a2a-utils.test.ts describe blocks:
- extractMessageText: 6 tests covering TextPart, DataPart, FilePart, empty, mixed
- extractTaskText: 6 tests covering status message, state, artifacts, failed, canceled
- extractIdsFromResponse: 9 tests covering Message, Task working/terminal states
All tests have @plan, @requirement, @scenario markers in JSDoc
```

#### 2. Is this REAL behavioral testing, not mock theater?

- [ ] **No mocking**: Tests use real A2A SDK type objects (Message, Task)
- [ ] **Actual data transformation**: Tests verify input → output data transformation
- [ ] **Real assertions**: Tests check actual extracted text, not mock call counts
- [ ] **Tests FAIL against stubs**: Ran npm test, tests fail (stub returns empty string/object)

**How I verified:**
```
Checked test structure:
- All tests create real Message/Task objects with parts, status, etc.
- No vi.mock, jest.mock, or spy usage
- Assertions check actual content: expect(result).toBe('Hello world'), expect(result).toContain('completed')
- Ran npm test: FAIL output shows tests failing against stubs (expected)
```

#### 3. Would tests FAIL if implementation was broken?

- [ ] **If extractMessageText returned empty string**: Test "should extract text from single TextPart" would fail (expects 'Hello world', gets '')
- [ ] **If extractIdsFromResponse didn't clear taskId**: Test "should clear taskId for completed Task" would fail (expects undefined, gets task ID)
- [ ] **If extractTaskText didn't include state**: Test "should include task state in output" would fail (expects 'working' in text, gets empty)

**How I verified:**
```
Analyzed test assertions:
- extractMessageText tests: expect(result).toBe('Hello world') — fails if stub returns ''
- extractTaskText tests: expect(result).toContain('completed') — fails if stub returns ''
- extractIdsFromResponse tests: expect(result.taskId).toBeUndefined() — fails if stub returns {}
Tests verify actual values, not just that function ran
```

#### 4. Coverage: Do tests cover all scenarios from requirements?

- [ ] **TextPart extraction**: Test single and multiple TextParts
- [ ] **DataPart extraction**: Test JSON data representation
- [ ] **FilePart extraction**: Test file reference description
- [ ] **Task state extraction**: Test all states (working, completed, failed, canceled, submitted, input-required)
- [ ] **Terminal state detection**: Test taskId cleared for completed/failed/canceled
- [ ] **Non-terminal state preservation**: Test taskId preserved for working/submitted/input-required
- [ ] **Edge cases**: Empty parts, missing fields, Message without taskId

**How I verified:**
```
Coverage checklist:
- extractMessageText: 6 tests (TextPart, DataPart, FilePart, empty, mixed) [OK]
- extractTaskText: 6 tests (all states + artifacts) [OK]
- extractIdsFromResponse: 9 tests (Message, all Task states, terminal/non-terminal) [OK]
Edge cases: Empty parts array, Message without taskId, Task without status message [OK]
```

#### 5. What's MISSING?

**Acceptable for TDD phase:**
- [ ] Implementation logic (scheduled for P08)
- [ ] SDK dependency (scheduled for P15)
- [ ] Tests passing (they should fail until P08 implements logic)

**Blockers (should NOT be present):**
- [ ] None identified

**How I verified:**
```
This is a TDD phase, so:
- Tests failing is expected (stubs return wrong values)
- No implementation logic is expected yet
- SDK import errors are expected until P15
No blockers found that would prevent P08 from proceeding
```

### Expected Behavior After P07

**What WORKS:**
- [ ] Tests compile (TypeScript recognizes A2A SDK types, even if module not found)
- [ ] Tests run (Vitest executes them)
- [ ] Tests have correct structure (describe blocks, it statements, assertions)

**What FAILS (expected):**
- [ ] Tests FAIL because stubs return empty string/object instead of extracted text
- [ ] Example failure: `expect(result).toBe('Hello world')` → got '' (empty string from stub)
- [ ] Example failure: `expect(result.taskId).toBeUndefined()` → got undefined (stub returns {}, no taskId field)

**Verification:**
```bash
# Run tests and check failures
npm test -- packages/core/src/agents/__tests__/a2a-utils.test.ts 2>&1 | grep -A 3 "FAIL"
# Expected: Multiple test failures with diff showing expected vs actual values
```

## Success Criteria

- [ ] All structural checks PASS
- [ ] All semantic verification questions answered YES
- [ ] 21+ tests exist covering all scenarios
- [ ] Tests FAIL against stubs (proving behavioral testing)
- [ ] No mocking or stubs in tests
- [ ] All tests have @plan, @requirement, @scenario markers
- [ ] Ready to proceed to P08 (implementation phase)

## Failure Recovery

If verification fails:

1. **Structural failures** (missing markers, mocking found):
   - Return to P07
   - Fix test structure and remove mocks
   - Re-run verification

2. **Semantic failures** (tests don't verify behavior, tests pass against stubs):
   - Return to P07
   - Rewrite tests to verify actual data transformation
   - Ensure tests fail against stubs
   - Re-run verification

3. **Coverage gaps** (missing scenarios):
   - Return to P07
   - Add missing test cases based on requirements.md
   - Re-run verification

## Verification Report Template

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P07a-report.md`

```markdown
# Phase 07 Verification Report

**Verified by:** [subagent/human name]
**Date:** [YYYY-MM-DD HH:MM]

## Structural Checks
- [x] File exists: packages/core/src/agents/__tests__/a2a-utils.test.ts
- [x] Plan markers: 21+/21+ found
- [x] Requirement markers: 21+/21+ found
- [x] No mocking: 0 mock/spy usages
- [x] Tests fail against stubs: FAIL output confirmed

## Semantic Checks
- [x] extractMessageText tests: 6 tests covering all part types
- [x] extractTaskText tests: 6 tests covering all task states
- [x] extractIdsFromResponse tests: 9 tests covering terminal/non-terminal states
- [x] Tests verify data transformation (not just function calls)
- [x] Tests use real A2A SDK type objects

## Test Failures (Expected)
```
Example failures:
- "should extract text from single TextPart": Expected 'Hello world', got ''
- "should clear taskId for completed Task": Expected undefined, got undefined (but stub doesn't clear, just returns empty {})
```
(Paste actual npm test output here)

## Coverage Verification
- [x] TextPart extraction: Covered
- [x] DataPart extraction: Covered
- [x] FilePart extraction: Covered
- [x] Terminal state detection (completed, failed, canceled): Covered
- [x] Non-terminal state preservation (working, submitted, input-required): Covered
- [x] Edge cases (empty, missing fields): Covered

## Issues Found
- None (or list any issues)

## Verification Result
[OK] PASS - Tests are behavioral, fail against stubs, ready for P08

**Verification commands executed:**
```
[paste actual command outputs here]
```
```

## Next Phase

After successful verification:
- **Proceed to Phase 08**: A2A Utilities - Implementation
- Phase 08 will implement the utility functions to make all tests pass
