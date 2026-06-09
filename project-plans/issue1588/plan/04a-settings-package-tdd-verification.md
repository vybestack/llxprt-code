# Phase 04a: Settings Package TDD Verification

## Phase ID

`PLAN-20260608-ISSUE1588.P04a`

## Prerequisites

- Required: Phase 04 completed.

## Requirements Implemented (Expanded)

### REQ-TEST-001: Behavioral Refactoring Verification

**Full Text**: Tests must be behavioral and fail if implementation is removed.

**Behavior**:

- GIVEN P04 tests
- WHEN reviewer reads tests
- THEN tests prove behavior and package boundaries rather than mocks or structure

**Why This Matters**: Bad tests can allow a fake extraction to pass.

## Implementation Tasks

No production implementation. Review tests for behavioral value.

## Verification Commands

```bash
rg -n "@requirement REQ-|@plan PLAN-20260608-ISSUE1588.P04" packages/settings --glob '*.test.ts'
rg -n "toHaveProperty|toBeDefined|toHaveBeenCalled|not\.toThrow|NotYetImplemented" packages/settings --glob '*.test.ts'
# Verify test command discovers nested directories
npm run test --workspace @vybestack/llxprt-code-settings -- --run 2>&1 | tee /tmp/p04a-output.txt
# Expected-failure verification: tests should fail naturally against incomplete stubs
# Capture output and assert no module resolution errors (would indicate config/setup problems)
grep -E "Cannot find module|Module not found|ERR_MODULE_NOT_FOUND" /tmp/p04a-output.txt && echo "FAIL: module resolution errors indicate setup problems" || echo "OK: no module resolution errors"
# Verify behavioral failures ARE present (expected TDD red phase)
grep -E "Expected.*Received|AssertionError|fail|throw|TypeError" /tmp/p04a-output.txt && echo "OK: behavioral failures present (expected TDD red)" || echo "WARN: no expected behavioral failure patterns found"
```

Expected: markers present; suspect assertions absent or justified.

## Semantic Verification Checklist

- [ ] Each test has input/action/expected output.
- [ ] Tests fail if implementation is removed.
- [ ] Mocks do not replace the behavior under test.

## Success Criteria

P05 can implement against trustworthy tests.

## Failure Recovery

Return to P04.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P04a.md`.
