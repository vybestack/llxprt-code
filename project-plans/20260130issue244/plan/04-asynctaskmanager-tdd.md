# Phase 04: AsyncTaskManager TDD

## Phase ID
`PLAN-20260130-ASYNCTASK.P04`

## Prerequisites
- Required: Phase 03a completed
- Verification: `ls project-plans/20260130issue244/.completed/P03a.md`
- Pseudocode: `analysis/pseudocode/async-task-manager.md`

## Requirements Implemented

This phase writes tests for REQ-ASYNC-001 and REQ-ASYNC-002.

## Implementation Tasks

### Files to Modify

- `packages/core/src/services/asyncTaskManager.test.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P04`
  - Write BEHAVIORAL tests that will FAIL until P05 implementation

### Required Tests

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P04
 * @requirement REQ-ASYNC-001, REQ-ASYNC-002
 */

describe('AsyncTaskManager', () => {
  describe('registerTask', () => {
    /**
     * @requirement REQ-ASYNC-001
     * @scenario Register a new async task
     * @given A valid task registration input
     * @when registerTask is called
     * @then Task is tracked with status 'running' and correct timestamps
     */
    it('should register task with running status and timestamps', () => {
      const manager = new AsyncTaskManager(5);
      const task = manager.registerTask({
        id: 'test-123',
        subagentName: 'researcher',
        goalPrompt: 'Research topic X',
        abortController: new AbortController()
      });
      
      expect(task.id).toBe('test-123');
      expect(task.subagentName).toBe('researcher');
      expect(task.status).toBe('running');
      expect(task.launchedAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('state transitions', () => {
    /**
     * @requirement REQ-ASYNC-001
     * @scenario Complete a running task
     * @given A registered running task
     * @when completeTask is called with output
     * @then Status becomes 'completed' with output and completedAt
     */
    it('should transition running task to completed', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      
      const result = manager.completeTask('task-1', { emitted_vars: { key: 'value' }, terminate_reason: 'GOAL' });
      
      expect(result).toBe(true);
      const task = manager.getTask('task-1');
      expect(task?.status).toBe('completed');
      expect(task?.output).toEqual({ emitted_vars: { key: 'value' }, terminate_reason: 'GOAL' });
      expect(task?.completedAt).toBeDefined();
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario Idempotent completion
     * @given A task already in terminal state
     * @when completeTask is called again
     * @then Returns false, no state change
     */
    it('should return false when completing already-terminal task (idempotent)', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      manager.completeTask('task-1', { emitted_vars: {}, terminate_reason: 'GOAL' });
      
      const result = manager.completeTask('task-1', { emitted_vars: { different: 'data' }, terminate_reason: 'GOAL' });
      
      expect(result).toBe(false);
      // Original output unchanged
      expect(manager.getTask('task-1')?.output?.emitted_vars).toEqual({});
    });

    // Similar tests for failTask, cancelTask...
  });

  describe('canLaunchAsync', () => {
    /**
     * @requirement REQ-ASYNC-001
     * @scenario Check launch allowed when under limit
     * @given maxAsyncTasks=5 and 3 running tasks
     * @when canLaunchAsync is called
     * @then Returns { allowed: true }
     */
    it('should allow launch when under limit', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      manager.registerTask({ id: 'task-2', subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      
      expect(manager.canLaunchAsync()).toEqual({ allowed: true });
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario Check launch denied when at limit
     * @given maxAsyncTasks=2 and 2 running tasks
     * @when canLaunchAsync is called
     * @then Returns { allowed: false, reason: 'Max async tasks (2) reached' }
     */
    it('should deny launch when at limit', () => {
      const manager = new AsyncTaskManager(2);
      manager.registerTask({ id: 'task-1', subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      manager.registerTask({ id: 'task-2', subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      
      expect(manager.canLaunchAsync()).toEqual({ allowed: false, reason: 'Max async tasks (2) reached' });
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario Unlimited mode
     * @given maxAsyncTasks=-1 (unlimited)
     * @when canLaunchAsync is called
     * @then Always returns { allowed: true }
     */
    it('should always allow when maxAsyncTasks is -1 (unlimited)', () => {
      const manager = new AsyncTaskManager(-1);
      for (let i = 0; i < 100; i++) {
        manager.registerTask({ id: `task-${i}`, subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      }
      expect(manager.canLaunchAsync()).toEqual({ allowed: true });
    });
  });

  describe('enforceHistoryLimit', () => {
    /**
     * @requirement REQ-ASYNC-002
     * @scenario History limit enforcement
     * @given maxAsyncTasks=2 (limit=4) and 5 completed notified tasks
     * @when enforceHistoryLimit runs
     * @then Oldest completed task is removed, 4 remain
     */
    it('should remove oldest completed task when over limit', () => {
      const manager = new AsyncTaskManager(2); // limit = 2 * 2 = 4
      
      // Create and complete 5 tasks
      for (let i = 0; i < 5; i++) {
        manager.registerTask({ id: `task-${i}`, subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
        manager.completeTask(`task-${i}`, { emitted_vars: {}, terminate_reason: 'GOAL' });
        manager.markNotified(`task-${i}`);
      }
      
      const tasks = manager.getAllTasks();
      expect(tasks.length).toBe(4);
      expect(tasks.find(t => t.id === 'task-0')).toBeUndefined(); // Oldest removed
      expect(tasks.find(t => t.id === 'task-4')).toBeDefined(); // Newest kept
    });

    /**
     * @requirement REQ-ASYNC-002
     * @scenario Unlimited mode history limit
     * @given maxAsyncTasks=-1 (unlimited, limit=10)
     * @when 11 tasks complete and are notified
     * @then Oldest is removed, 10 remain
     */
    it('should use limit of 10 when maxAsyncTasks is -1', () => {
      const manager = new AsyncTaskManager(-1); // limit = 10
      
      for (let i = 0; i < 11; i++) {
        manager.registerTask({ id: `task-${i}`, subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
        manager.completeTask(`task-${i}`, { emitted_vars: {}, terminate_reason: 'GOAL' });
        manager.markNotified(`task-${i}`);
      }
      
      const tasks = manager.getAllTasks();
      expect(tasks.length).toBe(10);
    });
  });

  describe('prefix matching', () => {
    /**
     * @requirement REQ-ASYNC-001
     * @scenario Unique prefix match
     * @given Tasks with IDs 'abc123' and 'def456'
     * @when getTaskByPrefix('abc') is called
     * @then Returns { task: abc123 task }
     */
    it('should return task when prefix is unique', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'abc123', subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      manager.registerTask({ id: 'def456', subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      
      const result = manager.getTaskByPrefix('abc');
      expect(result.task?.id).toBe('abc123');
      expect(result.candidates).toBeUndefined();
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario Ambiguous prefix
     * @given Tasks with IDs 'abc123' and 'abc456'
     * @when getTaskByPrefix('abc') is called
     * @then Returns { candidates: [both tasks] }
     */
    it('should return candidates when prefix is ambiguous', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'abc123', subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      manager.registerTask({ id: 'abc456', subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      
      const result = manager.getTaskByPrefix('abc');
      expect(result.task).toBeUndefined();
      expect(result.candidates?.length).toBe(2);
    });
  });

  describe('event subscriptions', () => {
    /**
     * @requirement REQ-ASYNC-001
     * @scenario Task completion event
     * @given Subscription to onTaskCompleted
     * @when Task completes
     * @then Handler is called with task info
     */
    it('should emit task-completed event', () => {
      const manager = new AsyncTaskManager(5);
      const handler = vi.fn();
      manager.onTaskCompleted(handler);
      
      manager.registerTask({ id: 'task-1', subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      manager.completeTask('task-1', { emitted_vars: {}, terminate_reason: 'GOAL' });
      
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        id: 'task-1',
        status: 'completed'
      }));
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario Unsubscribe from events
     * @given Subscription that is then unsubscribed
     * @when Task completes after unsubscribe
     * @then Handler is NOT called
     */
    it('should support unsubscription', () => {
      const manager = new AsyncTaskManager(5);
      const handler = vi.fn();
      const unsubscribe = manager.onTaskCompleted(handler);
      
      unsubscribe();
      
      manager.registerTask({ id: 'task-1', subagentName: 'test', goalPrompt: 'goal', abortController: new AbortController() });
      manager.completeTask('task-1', { emitted_vars: {}, terminate_reason: 'GOAL' });
      
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
```

## Verification Commands

```bash
# Check test file updated
grep -n "@plan PLAN-20260130-ASYNCTASK.P04" packages/core/src/services/asyncTaskManager.test.ts

# Count tests
grep -c "it\(" packages/core/src/services/asyncTaskManager.test.ts
# Expected: >= 15 tests

# Check behavioral tests (not mock theater)
grep -c "toHaveBeenCalled\|toHaveBeenCalledWith" packages/core/src/services/asyncTaskManager.test.ts
# Expected: 0 or very few (only for event handlers)

# Run tests (should FAIL - implementation is stub)
npm test -- packages/core/src/services/asyncTaskManager.test.ts
# Expected: Tests fail with NotYetImplemented or wrong values
```

## Success Criteria

- [ ] >= 15 behavioral tests written
- [ ] Tests cover all methods from pseudocode
- [ ] Tests use real data, not mocks
- [ ] Tests FAIL when run (implementation is stub)
- [ ] Plan markers present

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P04.md`
