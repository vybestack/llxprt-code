# Phase 18: Auto-Trigger Mechanism Stub

## Phase ID
`PLAN-20260130-ASYNCTASK.P18`

## Prerequisites
- Required: Phase 17a completed
- Pseudocode: `analysis/pseudocode/auto-trigger.md`

## Requirements Implemented

### REQ-ASYNC-010: Auto-Trigger on Completion
**Full Text**: When an async task completes and the agent is idle, the system MUST auto-trigger a new agent turn with the completion notification.
**Behavior**:
- GIVEN: Async task completes
- WHEN: Agent is not currently responding and not waiting for confirmation
- THEN: System injects completion notification and triggers agent turn
**Why This Matters**: Model receives async results promptly without user action.

### REQ-ASYNC-011: Notification Timing
**Full Text**: notifiedAt MUST be marked AFTER successful delivery to the model.
**Behavior**:
- GIVEN: Completion notification generated
- WHEN: Notification successfully injected into model context
- THEN: notifiedAt is set; notification won't be repeated
**Why This Matters**: Prevents lost notifications and duplicate deliveries.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/client.ts` or wherever agent turn is triggered
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P18`
  - MUST include: `@requirement REQ-ASYNC-010, REQ-ASYNC-011`
  - Add auto-trigger stub

OR create new file:
- `packages/core/src/services/asyncTaskAutoTrigger.ts`

### Required Code Structure

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P18
 * @requirement REQ-ASYNC-010, REQ-ASYNC-011
 */

export class AsyncTaskAutoTrigger {
  private isTriggering = false;
  
  constructor(
    private readonly taskManager: AsyncTaskManager,
    private readonly reminderService: AsyncTaskReminderService,
    private readonly isAgentBusy: () => boolean,
    private readonly triggerAgentTurn: (message: string) => Promise<void>,
  ) {}

  /**
   * Called when an async task completes.
   * Checks if agent is idle and triggers turn if so.
   */
  onTaskCompleted(task: AsyncTaskInfo): void {
    throw new Error('NotYetImplemented');
  }

  /**
   * Called when an async task fails.
   * Same logic as onTaskCompleted.
   */
  onTaskFailed(task: AsyncTaskInfo): void {
    throw new Error('NotYetImplemented');
  }

  /**
   * Set up subscriptions to AsyncTaskManager events.
   */
  subscribe(): () => void {
    throw new Error('NotYetImplemented');
  }

  /**
   * Check if auto-trigger should run and execute if so.
   * Serialized: only one trigger in flight at a time.
   */
  private async maybeAutoTrigger(): Promise<void> {
    throw new Error('NotYetImplemented');
  }
}
```

### Integration Points

Research where to integrate:

```bash
# Find where agent turns are triggered
grep -rn "sendMessage\|triggerTurn\|startChat" packages/core/src/core/client.ts
grep -rn "isResponding\|isBusy" packages/core/src
```

## Verification Commands

```bash
# Check file created
ls -la packages/core/src/services/asyncTaskAutoTrigger.ts

# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P18" packages/core/src/services/asyncTaskAutoTrigger.ts

# Check requirement markers
grep -n "@requirement REQ-ASYNC-010\|@requirement REQ-ASYNC-011" packages/core/src/services/asyncTaskAutoTrigger.ts

# TypeScript compiles
npm run typecheck
```

## Success Criteria

- [ ] AsyncTaskAutoTrigger class created with stubs
- [ ] TypeScript compiles
- [ ] Plan/requirement markers present

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P18.md`
