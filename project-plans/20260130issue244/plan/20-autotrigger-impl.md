# Phase 20: Auto-Trigger Mechanism Implementation

## Phase ID
`PLAN-20260130-ASYNCTASK.P20`

## Prerequisites
- Required: Phase 19a completed
- Pseudocode: `analysis/pseudocode/auto-trigger.md`

## Requirements Implemented

Implements REQ-ASYNC-010 and REQ-ASYNC-011 to make all tests pass.

## Implementation Tasks

### Files to Modify

- `packages/core/src/services/asyncTaskAutoTrigger.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P20`
  - Replace stubs with full implementation

### Implementation Details

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P20
 * @requirement REQ-ASYNC-010, REQ-ASYNC-011
 */

export class AsyncTaskAutoTrigger {
  private isTriggering = false;
  private unsubscribeFunctions: Array<() => void> = [];

  constructor(
    private readonly taskManager: AsyncTaskManager,
    private readonly reminderService: AsyncTaskReminderService,
    private readonly isAgentBusy: () => boolean,
    private readonly triggerAgentTurn: (message: string) => Promise<void>,
  ) {}

  onTaskCompleted(task: AsyncTaskInfo): void {
    // Schedule check (don't block the event handler)
    setImmediate(() => this.maybeAutoTrigger());
  }

  onTaskFailed(task: AsyncTaskInfo): void {
    // Same logic as completion
    setImmediate(() => this.maybeAutoTrigger());
  }

  subscribe(): () => void {
    const unsubComplete = this.taskManager.onTaskCompleted((task) => this.onTaskCompleted(task));
    const unsubFailed = this.taskManager.onTaskFailed((task) => this.onTaskFailed(task));
    
    this.unsubscribeFunctions.push(unsubComplete, unsubFailed);
    
    return () => {
      for (const unsub of this.unsubscribeFunctions) {
        unsub();
      }
      this.unsubscribeFunctions = [];
    };
  }

  private async maybeAutoTrigger(): Promise<void> {
    // Serialize: only one trigger in flight
    if (this.isTriggering) {
      return;
    }

    // Check if agent is busy
    if (this.isAgentBusy()) {
      // Will be picked up by next-turn reminder instead
      return;
    }

    // Check if there are pending notifications
    if (!this.reminderService.hasPendingNotifications()) {
      return;
    }

    this.isTriggering = true;
    
    try {
      // Generate the notification message
      const reminder = this.reminderService.generateReminder();
      
      if (!reminder) {
        // Nothing to notify (race condition - already delivered)
        return;
      }

      // Attempt delivery
      await this.triggerAgentTurn(reminder);
      
      // SUCCESS: Mark as notified AFTER delivery
      // @requirement REQ-ASYNC-011
      this.reminderService.markAllNotified();
      
    } catch (error) {
      // FAILURE: Do NOT mark as notified
      // @requirement REQ-ASYNC-011
      // The notification will be included in the next turn's reminder
      console.error('[AsyncTaskAutoTrigger] Failed to auto-trigger:', error);
    } finally {
      this.isTriggering = false;
    }
  }
}
```

### Integration with Client

Research existing patterns:

```bash
# Find where we can inject auto-trigger
grep -rn "isResponding\|isWaitingForConfirmation" packages/core/src/core/client.ts
```

Add integration code to wire up the auto-trigger with the client's busy state and turn triggering.

## Verification Commands

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P20" packages/core/src/services/asyncTaskAutoTrigger.ts

# Check no NotYetImplemented
grep -n "NotYetImplemented" packages/core/src/services/asyncTaskAutoTrigger.ts
# Expected: No matches

# Run tests - ALL should PASS
npm test -- packages/core/src/services/asyncTaskAutoTrigger.test.ts
# Expected: All pass

# TypeScript compiles
npm run typecheck
```

## Success Criteria

- [ ] All tests pass
- [ ] TypeScript compiles
- [ ] No stubs remaining
- [ ] Serialization working
- [ ] notifiedAt timing correct

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P20.md`
