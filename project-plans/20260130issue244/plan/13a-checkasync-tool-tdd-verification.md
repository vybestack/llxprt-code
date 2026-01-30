# Phase 13a: Check Async Tasks Tool TDD Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P13a`

## Prerequisites
- Required: Phase 13 completed

## Structural Verification

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P13" packages/core/src/tools/check-async-tasks.test.ts

# Count tests
grep -c "it\(" packages/core/src/tools/check-async-tasks.test.ts
# Expected: >= 8

# Tests fail with stub
npm test -- packages/core/src/tools/check-async-tasks.test.ts 2>&1 | grep -E "FAIL|Error"
```

## Semantic Verification Checklist

### Test Coverage

- [ ] List mode - shows all tasks
- [ ] List mode - handles empty
- [ ] Peek mode - exact ID match
- [ ] Peek mode - unique prefix
- [ ] Peek mode - ambiguous prefix
- [ ] Peek mode - no match
- [ ] Running task shows status
- [ ] Failed task shows error

## Success Criteria

- [ ] >= 8 tests
- [ ] All modes covered
- [ ] Tests fail with stub

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P13a.md`
