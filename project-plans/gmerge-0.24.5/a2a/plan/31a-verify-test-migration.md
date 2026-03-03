# Phase 31a: Verify Test Migration

## Phase ID

`PLAN-20260302-A2A.P31a`

## Purpose

Verify that all test files have been successfully migrated to use discriminated union types and async registerAgent.

## Prerequisites

- Phase 31 completed
- Expected: Test files updated with `kind` field and await calls

## Verification Steps

### 1. Test Suite Passes

```bash
npm test -- packages/core/src/agents/__tests__/
```

**Expected**: All tests PASS. No test failures from migration.

**Failure Signs**:
- "Cannot read property 'promptConfig' of undefined" → Missing kind field
- "Type 'Promise<void>' is not assignable to type 'void'" → Missing await
- "Expected 1 agent, got 0" → registerAgent not awaited (timing issue)

### 2. Fixtures Have Kind Field

```bash
grep -r "AgentDefinition\|LocalAgentDefinition" packages/core/src/agents/__tests__/ --include="*.ts" -A 5 | grep -E "kind: '(local|remote)'"
```

**Expected**: All agent definition fixtures have `kind` field.

### 3. RegisterAgent Calls Awaited

```bash
grep -r "registerAgent" packages/core/src/agents/__tests__/ --include="*.ts" | grep -v "await" | grep -v "async registerAgent" | grep -v "//"
```

**Expected**: No matches (all registerAgent calls should have await or be the method definition itself).

### 4. Type Check

```bash
npm run typecheck
```

**Expected**: 0 errors.

## Success Criteria

- [ ] All tests pass
- [ ] All agent fixtures have `kind` field
- [ ] All registerAgent calls are awaited
- [ ] TypeScript compiles successfully
- [ ] No test behavior changed (same assertions)

## Failure Handling

If verification fails:
1. Check which tests are failing
2. Review grep results for missing kind fields
3. Return to Phase 31 to fix issues
4. Cannot proceed to Phase 32 until verification passes

## Completion Report

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P31a-report.md`

Contents:
```markdown
# Phase 31a Verification Report

**Phase**: P31 - Test Migration
**Date**: [YYYY-MM-DD HH:MM]
**Status**: PASS / FAIL

## Test Results
[paste npm test output]

## Kind Field Check
[paste grep results showing fixtures have kind field]

## Await Check
[paste grep results showing all registerAgent calls awaited]

## TypeCheck Results
[paste npm run typecheck output]

## Files Updated
[list test files that were modified]

## Issues Found
[list any issues, or "None"]

## Next Steps
Proceed to Phase 32: E2E Testing
```
