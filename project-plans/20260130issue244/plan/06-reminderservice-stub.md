# Phase 06: AsyncTaskReminderService Stub

## Phase ID
`PLAN-20260130-ASYNCTASK.P06`

## Prerequisites
- Required: Phase 05a completed
- Verification: `ls project-plans/20260130issue244/.completed/P05a.md`
- Pseudocode: `analysis/pseudocode/async-task-reminder-service.md`

## Requirements Implemented

### REQ-ASYNC-003: Status in System Messages
**Full Text**: The model MUST always know about background task status via system instruction updates.
**Behavior**:
- GIVEN: 2 running tasks and 1 pending notification task
- WHEN: System message is generated
- THEN: Message includes structured summary of all async task states
**Why This Matters**: Model can only respond to async completions if it knows about them.

### REQ-ASYNC-004: Next-Turn Reminders
**Full Text**: On next turn, reminders MUST include async task status and pending results.
**Behavior**:
- GIVEN: A task completed since last turn
- WHEN: Next turn starts
- THEN: Reminder includes completion details in sync-task-output format
**Why This Matters**: Ensures model processes async results like sync results.

## Implementation Tasks

### Files to Create

- `packages/core/src/services/asyncTaskReminderService.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P06`
  - MUST include: `@requirement REQ-ASYNC-003, REQ-ASYNC-004`
  - Stub implementation

- `packages/core/src/services/asyncTaskReminderService.test.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P06`
  - Empty describe block (tests in P07)

### Files to Modify

- `packages/core/src/services/index.ts`
  - ADD export for AsyncTaskReminderService

### Required Code Structure

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P06
 * @requirement REQ-ASYNC-003, REQ-ASYNC-004
 */

import type { AsyncTaskManager, AsyncTaskInfo } from './asyncTaskManager.js';

/**
 * Generates next-turn reminders that include async task status and completion results.
 * Matches the format of TodoReminderService for consistency.
 */
export class AsyncTaskReminderService {
  constructor(private readonly taskManager: AsyncTaskManager) {}

  /**
   * Generates a reminder string for the next turn.
   * Returns empty string if no async tasks exist.
   */
  generateReminder(): string {
    throw new Error('NotYetImplemented');
  }

  /**
   * Generates status summary for inclusion in system instruction.
   * Format:
   * [ASYNC TASKS: X total]
   * [1] subagentName - status (id)
   */
  generateStatusSummary(): string {
    throw new Error('NotYetImplemented');
  }

  /**
   * Formats a completion notification matching sync task output format.
   * @param task The completed task
   * @returns Formatted string like sync task.ts formatSuccessContent/formatSuccessDisplay
   */
  formatCompletionNotification(task: AsyncTaskInfo): string {
    throw new Error('NotYetImplemented');
  }

  /**
   * Checks if there are any pending notifications.
   */
  hasPendingNotifications(): boolean {
    throw new Error('NotYetImplemented');
  }

  /**
   * Marks all pending notifications as delivered.
   * Call AFTER successfully injecting into model context.
   */
  markAllNotified(): void {
    throw new Error('NotYetImplemented');
  }
}
```

## Verification Commands

```bash
# Check files created
ls -la packages/core/src/services/asyncTaskReminderService.ts
ls -la packages/core/src/services/asyncTaskReminderService.test.ts

# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P06" packages/core/src/services/asyncTaskReminderService.ts

# Check requirement markers
grep -n "@requirement REQ-ASYNC-003\|@requirement REQ-ASYNC-004" packages/core/src/services/asyncTaskReminderService.ts

# Check exports
grep "AsyncTaskReminderService" packages/core/src/services/index.ts

# TypeScript compiles
npm run typecheck
```

## Success Criteria

- [ ] asyncTaskReminderService.ts created with stub
- [ ] asyncTaskReminderService.test.ts created with empty describe
- [ ] Exported from services/index.ts
- [ ] TypeScript compiles
- [ ] Plan and requirement markers present

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P06.md`
