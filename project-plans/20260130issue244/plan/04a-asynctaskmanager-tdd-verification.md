# Phase 04a: AsyncTaskManager TDD Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P04a`

## Prerequisites
- Required: Phase 04 completed
- Expected: Tests written in asyncTaskManager.test.ts

## Structural Verification

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P04" packages/core/src/services/asyncTaskManager.test.ts
# Expected: At least 1 match

# Count tests
grep -c "it\(" packages/core/src/services/asyncTaskManager.test.ts
# Expected: >= 15

# Check for mock theater (BAD)
grep -c "toHaveBeenCalled\b" packages/core/src/services/asyncTaskManager.test.ts
# Expected: <= 2 (only for event handlers)

# Check for behavioral assertions (GOOD)
grep -c "toBe\|toEqual\|toContain\|toBeDefined\|toBeUndefined" packages/core/src/services/asyncTaskManager.test.ts
# Expected: >= 20

# Check tests fail (stub implementation)
npm test -- packages/core/src/services/asyncTaskManager.test.ts 2>&1 | grep -E "FAIL|Error|NotYetImplemented"
# Expected: Failures (tests should fail with stub)
```

## Semantic Verification Checklist

### Test Coverage

1. **registerTask tests present?**
   - [ ] Test: Creates task with running status
   - [ ] Test: Sets correct timestamps
   - [ ] Test: Task retrievable via getTask

2. **State transition tests present?**
   - [ ] Test: completeTask transitions running -> completed
   - [ ] Test: failTask transitions running -> failed
   - [ ] Test: cancelTask transitions running -> cancelled
   - [ ] Test: Idempotent (repeat transition returns false)
   - [ ] Test: Race condition (first transition wins)

3. **canLaunchAsync tests present?**
   - [ ] Test: Allows when under limit
   - [ ] Test: Denies when at limit
   - [ ] Test: Unlimited mode (-1) always allows

4. **History limit tests present?**
   - [ ] Test: Removes oldest when over limit
   - [ ] Test: Uses limit=10 when unlimited (-1)
   - [ ] Test: Only removes notified tasks

5. **Prefix matching tests present?**
   - [ ] Test: Unique prefix returns task
   - [ ] Test: Ambiguous prefix returns candidates
   - [ ] Test: No match returns empty

6. **Event subscription tests present?**
   - [ ] Test: onTaskCompleted fires
   - [ ] Test: onTaskFailed fires
   - [ ] Test: onTaskCancelled fires
   - [ ] Test: Unsubscribe works

### Test Quality

- [ ] NO tests expecting NotYetImplemented (reverse testing)
- [ ] NO tests only checking structure exists
- [ ] ALL tests verify actual output values
- [ ] Tests would FAIL if implementation removed

## Blocking Issues

If tests are insufficient:
1. List missing test cases
2. Return to Phase 04 to add tests
3. Re-run verification

## Success Criteria

- [ ] >= 15 behavioral tests
- [ ] All requirement areas covered
- [ ] No mock theater
- [ ] Tests fail with stub implementation

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P04a.md`
