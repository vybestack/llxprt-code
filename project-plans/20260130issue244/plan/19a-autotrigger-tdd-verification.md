# Phase 19a: Auto-Trigger Mechanism TDD Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P19a`

## Prerequisites
- Required: Phase 19 completed

## Structural Verification

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P19" packages/core/src/services/asyncTaskAutoTrigger.test.ts

# Count tests
grep -c "it\(" packages/core/src/services/asyncTaskAutoTrigger.test.ts
# Expected: >= 8

# Tests fail with stub
npm test -- packages/core/src/services/asyncTaskAutoTrigger.test.ts 2>&1 | grep -E "FAIL|Error"
```

## Semantic Verification Checklist

### Trigger Conditions

- [ ] Auto-trigger when idle
- [ ] No trigger when busy
- [ ] Trigger on failure

### Serialization

- [ ] Only one trigger in flight

### Notification Timing

- [ ] notifiedAt set after success
- [ ] notifiedAt NOT set on failure

### Cleanup

- [ ] Unsubscribe stops triggers

## Success Criteria

- [ ] >= 8 tests
- [ ] All scenarios covered
- [ ] Tests fail with stub

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P19a.md`
