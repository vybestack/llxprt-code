# Phase 08: AsyncTaskReminderService Implementation

## Phase ID
`PLAN-20260130-ASYNCTASK.P08`

## Prerequisites
- Required: Phase 07a completed
- Pseudocode: `analysis/pseudocode/async-task-reminder-service.md`

## Requirements Implemented

Implements REQ-ASYNC-003 and REQ-ASYNC-004 to make all tests pass.

## Implementation Tasks

### Files to Modify

- `packages/core/src/services/asyncTaskReminderService.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P08`
  - Implement all methods following pseudocode

### Implementation Details

Must match TodoReminderService format exactly for consistency. Completion notification must match sync task.ts formatSuccessContent format.

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P08
 * @requirement REQ-ASYNC-003, REQ-ASYNC-004
 */

generateStatusSummary(): string {
  const tasks = this.taskManager.getAllTasks();
  if (tasks.length === 0) return '';
  
  const lines = [`[ASYNC TASKS: ${tasks.length} total]`];
  tasks.forEach((task, index) => {
    const statusEmoji = {
      running: '',
      completed: '[OK]',
      failed: '[ERROR]',
      cancelled: ''
    }[task.status];
    lines.push(`[${index + 1}] ${task.subagentName} - ${statusEmoji} ${task.status} (${task.id.slice(0, 8)})`);
  });
  return lines.join('\n');
}

generateReminder(): string {
  const pending = this.taskManager.getPendingNotifications();
  const running = this.taskManager.getRunningTasks();
  
  if (pending.length === 0 && running.length === 0) {
    return '';
  }
  
  const parts: string[] = [];
  
  if (pending.length > 0) {
    parts.push(`${pending.length} async task(s) completed:`);
    for (const task of pending) {
      parts.push(this.formatCompletionNotification(task));
    }
  }
  
  if (running.length > 0) {
    parts.push(`${running.length} async task(s) still running.`);
  }
  
  return `---\nSystem Note: Async Task Status\n\n${parts.join('\n\n')}\n---`;
}

formatCompletionNotification(task: AsyncTaskInfo): string {
  if (task.status === 'completed' && task.output) {
    // Match sync task.ts formatSuccessContent exactly
    const payload: Record<string, unknown> = {
      agent_id: task.id,
      terminate_reason: task.output.terminate_reason,
      emitted_vars: task.output.emitted_vars ?? {},
    };
    if (task.output.final_message !== undefined) {
      payload.final_message = task.output.final_message;
    }
    return JSON.stringify(payload, null, 2);
  } else if (task.status === 'failed') {
    return JSON.stringify({
      agent_id: task.id,
      status: 'failed',
      error: task.error
    }, null, 2);
  } else if (task.status === 'cancelled') {
    return JSON.stringify({
      agent_id: task.id,
      status: 'cancelled'
    }, null, 2);
  }
  return '';
}

hasPendingNotifications(): boolean {
  return this.taskManager.getPendingNotifications().length > 0;
}

markAllNotified(): void {
  const pending = this.taskManager.getPendingNotifications();
  for (const task of pending) {
    this.taskManager.markNotified(task.id);
  }
}
```

## Verification Commands

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P08" packages/core/src/services/asyncTaskReminderService.ts

# Check no NotYetImplemented
grep -n "NotYetImplemented" packages/core/src/services/asyncTaskReminderService.ts
# Expected: No matches

# Run tests - ALL should PASS
npm test -- packages/core/src/services/asyncTaskReminderService.test.ts
# Expected: All pass

# TypeScript compiles
npm run typecheck
```

## Success Criteria

- [ ] All tests pass
- [ ] TypeScript compiles
- [ ] No deferred markers
- [ ] Format matches spec

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P08.md`
