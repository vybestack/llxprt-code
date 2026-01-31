# Phase 14a: Check Async Tasks Tool Implementation Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P14a`

## Prerequisites
- Required: Phase 14 completed

## Structural Verification

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P14" packages/core/src/tools/check-async-tasks.ts

# Check no stubs
grep -n "NotYetImplemented" packages/core/src/tools/check-async-tasks.ts
# Expected: No matches

# Run tests
npm test -- packages/core/src/tools/check-async-tasks.test.ts
# Expected: All pass

# TypeScript
npm run typecheck
```

## Semantic Verification Checklist

### List Mode

- [ ] Shows task count
- [ ] Shows each task's status, name, ID prefix, goal
- [ ] Handles empty task list

### Peek Mode

- [ ] Shows full task details for exact match
- [ ] Shows full task details for unique prefix
- [ ] Shows candidates for ambiguous prefix
- [ ] Shows error for no match
- [ ] Shows output for completed tasks
- [ ] Shows error for failed tasks

## Success Criteria

- [ ] All tests pass
- [ ] All modes work correctly
- [ ] TypeScript compiles

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P14a.md`
