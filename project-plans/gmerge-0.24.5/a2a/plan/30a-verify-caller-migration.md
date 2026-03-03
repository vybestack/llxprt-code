# Phase 30a: Verify Caller Migration

## Phase ID

`PLAN-20260302-A2A.P30a`

## Purpose

Verify that all callers affected by breaking changes have been successfully migrated.

## Prerequisites

- Phase 30 completed
- Expected: 3 files modified (executor.ts, invocation.ts, codebase-investigator.ts)

## Verification Steps

### 1. Type Check

```bash
npm run typecheck
```

**Expected**: 0 errors. All LocalAgentDefinition type narrowing compiles successfully.

**Failure Signs**:
- "Property 'promptConfig' does not exist on type 'RemoteAgentDefinition'" → Need more narrowing
- "Type 'AgentDefinition' is not assignable to 'LocalAgentDefinition'" → Missing signature change

### 2. Test Suite

```bash
npm test -- packages/core/src/agents/__tests__/
```

**Expected**: All existing tests PASS. No behavior changes, only type safety improvements.

**Acceptable**: Tests may need updates in P31 if they create AgentDefinition fixtures.

### 3. File Inspection

```bash
# Check executor.ts signatures
grep -A 2 "static async create" packages/core/src/agents/executor.ts | grep "LocalAgentDefinition"

# Check invocation.ts constructor
grep -A 5 "constructor" packages/core/src/agents/invocation.ts | grep "LocalAgentDefinition"

# Check codebase-investigator has kind field
grep "kind: 'local'" packages/core/src/agents/codebase-investigator.ts
```

**Expected**: All patterns found.

### 4. Plan Markers

```bash
grep "@plan PLAN-20260302-A2A.P30" packages/core/src/agents/executor.ts packages/core/src/agents/invocation.ts packages/core/src/agents/codebase-investigator.ts | wc -l
```

**Expected**: 3+ markers (one per file).

## Success Criteria

- [ ] TypeScript compiles successfully (0 errors)
- [ ] All tests pass
- [ ] LocalAgentDefinition type used in executor.ts (3 places)
- [ ] LocalAgentDefinition type used in invocation.ts (constructor)
- [ ] codebase-investigator.ts has `kind: 'local'` field
- [ ] @plan markers present

## Failure Handling

If verification fails:
1. Review error messages from typecheck
2. Check git diff for unexpected changes
3. Return to Phase 30 to fix issues
4. Cannot proceed to Phase 31 until verification passes

## Completion Report

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P30a-report.md`

Contents:
```markdown
# Phase 30a Verification Report

**Phase**: P30 - Caller Migration
**Date**: [YYYY-MM-DD HH:MM]
**Status**: PASS / FAIL

## TypeCheck Results
[paste npm run typecheck output]

## Test Results
[paste npm test output]

## File Changes Verified
- [x] executor.ts: LocalAgentDefinition in create(), field, constructor
- [x] invocation.ts: LocalAgentDefinition in constructor
- [x] codebase-investigator.ts: kind field added, type changed

## Issues Found
[list any issues, or "None"]

## Next Steps
Proceed to Phase 31: Test Migration
```
