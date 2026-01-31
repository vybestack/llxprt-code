# Phase 10a: Task Tool Async Mode TDD Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P10a`

## Prerequisites
- Required: Phase 10 completed

## Structural Verification

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P10" packages/core/src/tools/task.test.ts

# Count async tests
grep -c "it\(" packages/core/src/tools/task.test.ts | xargs -I {} echo "Total tests: {}"
grep -c "async.*true\|async mode" packages/core/src/tools/task.test.ts

# Async tests fail
npm test -- packages/core/src/tools/task.test.ts 2>&1 | grep -E "FAIL.*async"

# Sync tests pass
npm test -- packages/core/src/tools/task.test.ts --testNamePattern="^(?!.*async)" 2>&1 | tail -5
```

## Semantic Verification Checklist

### Test Coverage

- [ ] canLaunchAsync rejection test
- [ ] Immediate return test
- [ ] AsyncTaskManager registration test
- [ ] Background completion test
- [ ] Background failure test
- [ ] Scheduler integration test
- [ ] agentId in metadata test
- [ ] Sync mode unchanged test

### Test Quality

- [ ] Real timing assertions (not mocked time)
- [ ] Real AsyncTaskManager (not mocked)
- [ ] Verify actual values, not just existence

## Success Criteria

- [ ] All test areas covered
- [ ] Tests fail with stub
- [ ] Sync tests pass

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P10a.md`
