# Phase 16a: Slash Commands TDD Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P16a`

## Prerequisites
- Required: Phase 16 completed

## Structural Verification

```bash
# Check plan markers
grep -rn "@plan PLAN-20260130-ASYNCTASK.P16" packages/cli/src

# Count tests
grep -c "it\(" packages/cli/src/ui/commands.test.ts
# Expected: >= 8

# Tests fail with stub
npm test -- packages/cli 2>&1 | grep -E "FAIL|NotYetImplemented"
```

## Semantic Verification Checklist

### /tasks list tests

- [ ] List all tasks with status
- [ ] Handle empty list
- [ ] Show duration

### /task end tests

- [ ] Cancel by exact ID
- [ ] Cancel by unique prefix
- [ ] Ambiguous prefix error
- [ ] No match error
- [ ] Already completed error

## Success Criteria

- [ ] >= 8 tests
- [ ] All scenarios covered
- [ ] Tests fail with stub

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P16a.md`
