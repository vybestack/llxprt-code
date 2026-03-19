# Phase 16a: Verify A2A Client Manager TDD

## Phase ID

`PLAN-20260302-A2A.P16a`

## Prerequisites

- Required: Phase 16 (A2A Client Manager TDD) completed
- Verification: Test file created
- Expected: a2a-client-manager.test.ts with ~22 behavioral tests

## Purpose

Verify that Phase 16 TDD tests are behavioral, comprehensive, and ready to drive implementation in Phase 17.

## Verification Commands

### Automated Checks (Structural)

```bash
# Check test file created
ls packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: File exists

# Check plan markers exist
grep -c "@plan PLAN-20260302-A2A.P16" packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: 8+ occurrences (describe blocks)

# Check requirements covered
grep -E "@requirement A2A-DISC-001|@requirement A2A-DISC-002|@requirement A2A-DISC-003" packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: 3+ occurrences

grep -E "@requirement A2A-EXEC-001|@requirement A2A-EXEC-005|@requirement A2A-EXEC-012" packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: 3+ occurrences

# Check test count
grep -c "^\s*it(" packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: ~22 tests

# Check describe blocks exist
grep -c "^\s*describe(" packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: 8 (Agent Card Loading, Caching, Error Handling, Message Sending, Task Operations, Dialect Adapter, Auth Integration, Session Scoping)

# Run tests (MUST FAIL against stubs)
npm test -- packages/core/src/agents/__tests__/a2a-client-manager.test.ts 2>&1 | tee /tmp/p16a-test-output.txt
# Expected: Tests run, most fail naturally (not compilation errors)

# Check for mock theater violations (should find none)
grep -E "toHaveBeenCalled|toHaveBeenCalledWith" packages/core/src/agents/__tests__/a2a-client-manager.test.ts | grep -E "manager\.(loadAgent|sendMessage|getTask|cancelTask)" && echo "FAIL: Mock theater detected" || echo "PASS: No mock theater"
# Expected: PASS

# Check for real SDK type usage
grep -E "import.*AgentCard.*@a2a-js/sdk|import.*Message.*@a2a-js/sdk|import.*Task.*@a2a-js/sdk" packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: SDK types imported

# Check no implementation in test file
grep "export class A2AClientManager" packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: No matches (tests only, no implementation)
```

### Behavioral Test Quality Checks

```bash
# Check tests verify outputs (not just method calls)
grep -A 5 "it('should" packages/core/src/agents/__tests__/a2a-client-manager.test.ts | grep -E "expect\(.*\)\.(toBe|toEqual|toHaveLength|toContain)" | wc -l
# Expected: 20+ assertions (tests verify data, not mocks)

# Check tests use real objects
grep -E "const.*AgentCard.*=|const.*Message.*=|const.*Task.*=" packages/core/src/agents/__tests__/a2a-client-manager.test.ts | wc -l
# Expected: Multiple occurrences (real test data objects)

# Check async handling
grep -c "async.*=>\\|await " packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: 15+ (most tests are async)

# Check error handling tests exist
grep -c "should.*fail\|should.*error\|should.*throw" packages/core/src/agents/__tests__/a2a-client-manager.test.ts
# Expected: 2+ (error tests)
```

### Semantic Verification Checklist

**Are tests behavioral (not mock theater)?**
- [ ] I read the test file (not just checked it exists)
- [ ] Tests verify data outputs (e.g., `expect(result.name).toBe('Agent Name')`)
- [ ] Tests do NOT mock A2AClientManager methods
- [ ] Tests mock SDK Client methods only (external boundary)
- [ ] Tests use real AgentCard/Message/Task objects from SDK
- [ ] No `manager.method.toHaveBeenCalled` assertions

**Do tests cover all requirements?**
- [ ] A2A-DISC-001: Agent card loading returns AgentCard with name/skills/capabilities
- [ ] A2A-DISC-002: Error thrown when card fetch fails
- [ ] A2A-DISC-003: Second getAgentCard call returns cached object
- [ ] A2A-EXEC-001: sendMessage returns Message/Task response
- [ ] A2A-EXEC-005: cancelTask returns Task with state='canceled'
- [ ] A2A-EXEC-012: mapTaskState normalizes proto-JSON states

**Would tests fail if implementation was removed?**
- [ ] If loadAgent stub returned empty card, tests would fail (verify name, skills)
- [ ] If sendMessage stub ignored contextId, tests would fail (verify contextId passed)
- [ ] If getAgentCard returned undefined after load, caching test would fail
- [ ] If cancelTask threw error, best-effort test would fail

**Test structure quality:**
- [ ] 8 describe blocks organize tests by feature area
- [ ] ~22 tests total
- [ ] beforeEach creates fresh A2AClientManager instance
- [ ] Tests isolated (no shared state between tests)
- [ ] Async tests use async/await (not .then chains)
- [ ] Error tests use expect().rejects or try/catch

**Requirements traceability:**
- [ ] Each describe block has @requirement marker for covered requirements
- [ ] All 6 requirements (DISC-001/002/003, EXEC-001/005/012) appear in markers

## Test Failure Analysis

After running tests, verify failures are natural (stub limitations) not errors:

```bash
# Check test output for expected failure patterns
cat /tmp/p16a-test-output.txt | grep -E "FAIL|PASS|Error"
# Expected: Multiple FAIL (natural failures), no compilation errors

# Count passing vs failing tests
cat /tmp/p16a-test-output.txt | grep "Tests:" 
# Expected: ~0 passing, ~22 failing (stubs don't implement behavior)

# Check for unexpected errors
cat /tmp/p16a-test-output.txt | grep -i "TypeError\|ReferenceError\|SyntaxError"
# Expected: No matches (no code errors, just assertion failures)
```

## Success Criteria

- All verification commands return expected results
- Test file created with ~22 tests in 8 describe blocks
- All tests tagged with @plan and @requirement markers
- Tests FAIL naturally against stubs (not compilation errors)
- No mock theater (no mocking manager methods)
- Tests verify data flows using real SDK types
- Error handling tests exist
- Tests would fail if implementation was removed/broken
- Ready for P17 (Implementation)

## Failure Recovery

If verification fails:

1. **Mock theater detected**: Remove manager method mocks, use SDK mocks only
2. **Tests pass against stubs**: Tests are too weak, add data assertions
3. **Compilation errors**: Fix imports, SDK type usage
4. **Missing requirement coverage**: Add tests for uncovered requirements
5. **No error tests**: Add tests for network failures, invalid responses

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P16a-report.md`

Contents:
```markdown
Phase: P16a
Verified: [YYYY-MM-DD HH:MM timestamp]
Verification Result: PASS/FAIL

Test File Created:
  - packages/core/src/agents/__tests__/a2a-client-manager.test.ts (~400 lines)

Test Structure:
  - Describe blocks: 8
  - Total tests: ~22
  - Behavioral tests: Yes (verified data flows, not mocks)
  - Mock theater violations: None
  - Real SDK types used: Yes

Requirements Coverage:
  - A2A-DISC-001: Agent card loading (3 tests)
  - A2A-DISC-002: Error handling (2 tests)
  - A2A-DISC-003: Caching (2 tests)
  - A2A-EXEC-001: Message sending (4 tests)
  - A2A-EXEC-005: Task cancellation (3 tests)
  - A2A-EXEC-012: Dialect adapter (3 tests)

Test Results (vs Stubs):
  - Passing: ~0
  - Failing: ~22 (natural failures, expected)
  - Errors: 0 (no compilation/runtime errors)

Verification Output:
[paste test run output showing failures]

Issues Found: [list any issues that need fixing]

Next Phase: P17 (A2A Client Manager Implementation)
```
