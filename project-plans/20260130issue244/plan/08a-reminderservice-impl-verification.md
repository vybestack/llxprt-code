# Phase 08a: AsyncTaskReminderService Implementation Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P08a`

## Prerequisites
- Required: Phase 08 completed
- Expected: All tests pass

## Structural Verification

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P08" packages/core/src/services/asyncTaskReminderService.ts

# Check no deferred implementation
grep -n "NotYetImplemented\|TODO\|FIXME" packages/core/src/services/asyncTaskReminderService.ts
# Expected: No matches

# Run tests
npm test -- packages/core/src/services/asyncTaskReminderService.test.ts
# Expected: All pass

# TypeScript
npm run typecheck
```

## Semantic Verification Checklist

### Format Verification

1. **generateStatusSummary format correct?**
   - [ ] First line: `[ASYNC TASKS: N total]`
   - [ ] Each task: `[N] name - STATUS (id-prefix)`

2. **generateReminder matches TodoReminderService?**
   - [ ] Starts with `---`
   - [ ] Contains `System Note:`
   - [ ] Ends with `---`

3. **formatCompletionNotification matches sync task?**
   - [ ] JSON format
   - [ ] Has agent_id, terminate_reason, emitted_vars
   - [ ] Has final_message when present

### Integration Test

```bash
# Build and manually verify
npm run build

node -e "
const { AsyncTaskManager, AsyncTaskReminderService } = require('./packages/core/dist/services/index.js');
const manager = new AsyncTaskManager(5);
const service = new AsyncTaskReminderService(manager);

manager.registerTask({ id: 'test-1', subagentName: 'researcher', goalPrompt: 'test', abortController: new AbortController() });
manager.completeTask('test-1', { emitted_vars: { key: 'value' }, terminate_reason: 'GOAL' });

console.log('=== Status Summary ===');
console.log(service.generateStatusSummary());
console.log('=== Reminder ===');
console.log(service.generateReminder());
"
```

## Success Criteria

- [ ] All tests pass
- [ ] Format matches spec
- [ ] Integration test produces expected output

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P08a.md`
