# Phase 32a: Verify E2E Testing

## Phase ID

`PLAN-20260302-A2A.P32a`

## Purpose

Verify that end-to-end integration tests pass and cover the full remote agent pipeline.

## Prerequisites

- Phase 32 completed
- Expected: e2e-remote-agent.test.ts created with 4 tests

## Verification Steps

### 1. E2E Tests Pass

```bash
npm test -- packages/core/src/agents/__tests__/e2e-remote-agent.test.ts
```

**Expected**: 4/4 tests PASS.

**Failure Signs**:
- Mock expectations not met → Check mock setup
- TOML parsing fails → Check TOML file creation
- Dispatch fails → Check registry.createInvocation call
- Type errors → Check Message/Task mock structure

### 2. Full Test Suite Passes

```bash
npm test -- packages/core/src/agents/__tests__/
```

**Expected**: All agent tests PASS (unit + integration + E2E).

### 3. Coverage Check

```bash
grep "Full pipeline" packages/core/src/agents/__tests__/e2e-remote-agent.test.ts
grep "Session state" packages/core/src/agents/__tests__/e2e-remote-agent.test.ts
grep "Abort" packages/core/src/agents/__tests__/e2e-remote-agent.test.ts
grep "HTTPS" packages/core/src/agents/__tests__/e2e-remote-agent.test.ts
```

**Expected**: All 4 test scenarios present.

### 4. Plan Markers

```bash
grep -c "@plan PLAN-20260302-A2A.P32" packages/core/src/agents/__tests__/e2e-remote-agent.test.ts
```

**Expected**: 4+ markers.

## Success Criteria

- [ ] E2E tests pass (4/4)
- [ ] Full agent test suite passes
- [ ] All 4 scenarios covered
- [ ] @plan markers present
- [ ] No skipped or disabled tests

## Failure Handling

If verification fails:
1. Review test output for specific failures
2. Check mock setup matches actual behavior
3. Return to Phase 32 to fix issues
4. Cannot proceed to Phase 33 until verification passes

## Completion Report

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P32a-report.md`

Contents:
```markdown
# Phase 32a Verification Report

**Phase**: P32 - E2E Testing
**Date**: [YYYY-MM-DD HH:MM]
**Status**: PASS / FAIL

## E2E Test Results
[paste npm test e2e-remote-agent.test.ts output]

## Full Test Suite Results
[paste npm test agents/__tests__/ output]

## Test Coverage
- [x] Full pipeline test
- [x] Session state persistence test
- [x] Abort handling test
- [x] HTTPS enforcement test

## Issues Found
[list any issues, or "None"]

## Next Steps
Proceed to Phase 33: Final Verification
```
