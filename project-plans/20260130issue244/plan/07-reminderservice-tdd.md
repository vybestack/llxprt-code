# Phase 07: AsyncTaskReminderService TDD

## Phase ID
`PLAN-20260130-ASYNCTASK.P07`

## Prerequisites
- Required: Phase 06a completed
- Pseudocode: `analysis/pseudocode/async-task-reminder-service.md`

## Requirements Implemented

Tests for REQ-ASYNC-003 and REQ-ASYNC-004.

## Implementation Tasks

### Files to Modify

- `packages/core/src/services/asyncTaskReminderService.test.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P07`
  - Write behavioral tests

### Required Tests

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P07
 * @requirement REQ-ASYNC-003, REQ-ASYNC-004
 */

describe('AsyncTaskReminderService', () => {
  describe('generateStatusSummary', () => {
    /**
     * @requirement REQ-ASYNC-003
     * @scenario Status summary with running and completed tasks
     * @given 2 running tasks, 1 completed task
     * @when generateStatusSummary called
     * @then Returns formatted summary with all tasks
     */
    it('should include all tasks in status summary', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });
      manager.registerTask({ id: 'task-2', subagentName: 'analyst', goalPrompt: 'Analyze Y', abortController: new AbortController() });
      manager.registerTask({ id: 'task-3', subagentName: 'writer', goalPrompt: 'Write Z', abortController: new AbortController() });
      manager.completeTask('task-3', { emitted_vars: {}, terminate_reason: 'GOAL' });

      const service = new AsyncTaskReminderService(manager);
      const summary = service.generateStatusSummary();

      expect(summary).toContain('[ASYNC TASKS: 3 total]');
      expect(summary).toContain('researcher');
      expect(summary).toContain('analyst');
      expect(summary).toContain('writer');
      expect(summary).toMatch(/running.*running.*completed|running.*completed.*running|completed.*running.*running/i);
    });

    /**
     * @requirement REQ-ASYNC-003
     * @scenario No async tasks
     * @given No tasks registered
     * @when generateStatusSummary called
     * @then Returns empty string
     */
    it('should return empty string when no tasks', () => {
      const manager = new AsyncTaskManager(5);
      const service = new AsyncTaskReminderService(manager);
      
      expect(service.generateStatusSummary()).toBe('');
    });
  });

  describe('generateReminder', () => {
    /**
     * @requirement REQ-ASYNC-004
     * @scenario Reminder matches TodoReminderService format
     * @given Pending notification
     * @when generateReminder called
     * @then Format is "---\nSystem Note: ...\n---"
     */
    it('should match TodoReminderService format', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });
      manager.completeTask('task-1', { emitted_vars: { result: 'data' }, terminate_reason: 'GOAL' });

      const service = new AsyncTaskReminderService(manager);
      const reminder = service.generateReminder();

      expect(reminder).toMatch(/^---\n/);
      expect(reminder).toContain('System Note:');
      expect(reminder).toMatch(/\n---$/);
    });

    /**
     * @requirement REQ-ASYNC-004
     * @scenario Completion matches sync task output format
     * @given Completed task pending notification
     * @when generateReminder called
     * @then Includes agent_id, terminate_reason, emitted_vars
     */
    it('should include sync-task-format completion details', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });
      manager.completeTask('task-1', { 
        emitted_vars: { finding: 'important result' }, 
        terminate_reason: 'GOAL',
        final_message: 'Research completed'
      });

      const service = new AsyncTaskReminderService(manager);
      const reminder = service.generateReminder();

      expect(reminder).toContain('agent_id');
      expect(reminder).toContain('task-1');
      expect(reminder).toContain('terminate_reason');
      expect(reminder).toContain('GOAL');
      expect(reminder).toContain('emitted_vars');
      expect(reminder).toContain('finding');
    });

    /**
     * @requirement REQ-ASYNC-004
     * @scenario Multiple pending notifications
     * @given 2 completed tasks pending notification
     * @when generateReminder called
     * @then Both completions included
     */
    it('should include all pending completions', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });
      manager.registerTask({ id: 'task-2', subagentName: 'analyst', goalPrompt: 'Analyze Y', abortController: new AbortController() });
      manager.completeTask('task-1', { emitted_vars: {}, terminate_reason: 'GOAL' });
      manager.completeTask('task-2', { emitted_vars: {}, terminate_reason: 'GOAL' });

      const service = new AsyncTaskReminderService(manager);
      const reminder = service.generateReminder();

      expect(reminder).toContain('task-1');
      expect(reminder).toContain('task-2');
    });
  });

  describe('formatCompletionNotification', () => {
    /**
     * @requirement REQ-ASYNC-004
     * @scenario Completed task notification
     * @given A completed task
     * @when formatCompletionNotification called
     * @then Matches sync task output JSON format
     */
    it('should format completion like sync task output', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });
      manager.completeTask('task-1', { 
        emitted_vars: { result: 'data' }, 
        terminate_reason: 'GOAL',
        final_message: 'Done'
      });

      const service = new AsyncTaskReminderService(manager);
      const task = manager.getTask('task-1')!;
      const notification = service.formatCompletionNotification(task);

      // Should be valid JSON
      const parsed = JSON.parse(notification);
      expect(parsed.agent_id).toBe('task-1');
      expect(parsed.terminate_reason).toBe('GOAL');
      expect(parsed.emitted_vars).toEqual({ result: 'data' });
    });

    /**
     * @requirement REQ-ASYNC-004
     * @scenario Failed task notification
     * @given A failed task
     * @when formatCompletionNotification called
     * @then Includes error information
     */
    it('should format failure notification with error', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });
      manager.failTask('task-1', 'Network timeout');

      const service = new AsyncTaskReminderService(manager);
      const task = manager.getTask('task-1')!;
      const notification = service.formatCompletionNotification(task);

      expect(notification).toContain('task-1');
      expect(notification).toContain('failed');
      expect(notification).toContain('Network timeout');
    });
  });

  describe('notification lifecycle', () => {
    /**
     * @requirement REQ-ASYNC-004
     * @scenario hasPendingNotifications check
     * @given 1 completed task not yet notified
     * @when hasPendingNotifications called
     * @then Returns true
     */
    it('should detect pending notifications', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });
      manager.completeTask('task-1', { emitted_vars: {}, terminate_reason: 'GOAL' });

      const service = new AsyncTaskReminderService(manager);
      expect(service.hasPendingNotifications()).toBe(true);
    });

    /**
     * @requirement REQ-ASYNC-004
     * @scenario markAllNotified clears pending
     * @given Pending notifications
     * @when markAllNotified called
     * @then hasPendingNotifications returns false
     */
    it('should mark notifications as delivered', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });
      manager.completeTask('task-1', { emitted_vars: {}, terminate_reason: 'GOAL' });

      const service = new AsyncTaskReminderService(manager);
      service.markAllNotified();
      
      expect(service.hasPendingNotifications()).toBe(false);
    });

    /**
     * @requirement REQ-ASYNC-004
     * @scenario notifiedAt timestamp set
     * @given Notification marked as delivered
     * @when Task queried
     * @then notifiedAt is set
     */
    it('should set notifiedAt timestamp', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });
      manager.completeTask('task-1', { emitted_vars: {}, terminate_reason: 'GOAL' });

      const service = new AsyncTaskReminderService(manager);
      service.markAllNotified();
      
      expect(manager.getTask('task-1')?.notifiedAt).toBeDefined();
    });
  });
});
```

## Verification Commands

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P07" packages/core/src/services/asyncTaskReminderService.test.ts

# Count tests
grep -c "it\(" packages/core/src/services/asyncTaskReminderService.test.ts
# Expected: >= 10

# Run tests (should FAIL)
npm test -- packages/core/src/services/asyncTaskReminderService.test.ts
# Expected: Tests fail (stub implementation)
```

## Success Criteria

- [ ] >= 10 behavioral tests
- [ ] Tests cover all methods
- [ ] Tests FAIL with stub implementation
- [ ] Plan markers present

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P07.md`
