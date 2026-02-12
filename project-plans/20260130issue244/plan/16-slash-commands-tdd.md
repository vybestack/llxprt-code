# Phase 16: Slash Commands TDD

## Phase ID
`PLAN-20260130-ASYNCTASK.P16`

## Prerequisites
- Required: Phase 15a completed
- Pseudocode: `analysis/pseudocode/slash-commands.md`

## Requirements Implemented

Tests for REQ-ASYNC-008 and REQ-ASYNC-009.

## Implementation Tasks

### Files to Modify

- Existing command test file or new test file
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P16`

### Required Tests

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P16
 * @requirement REQ-ASYNC-008, REQ-ASYNC-009
 */

describe('Async task slash commands', () => {
  describe('/tasks list', () => {
    /**
     * @requirement REQ-ASYNC-008
     * @scenario List all async tasks
     * @given 2 running tasks, 1 completed
     * @when /tasks list executed
     * @then Displays all tasks with status
     */
    it('should display all async tasks', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research', abortController: new AbortController() });
      manager.registerTask({ id: 'task-2', subagentName: 'analyst', goalPrompt: 'Analyze', abortController: new AbortController() });
      manager.completeTask('task-1', { emitted_vars: {}, terminate_reason: 'GOAL' });

      const result = await executeCommand('/tasks list', { asyncTaskManager: manager });

      expect(result.output).toContain('task-1');
      expect(result.output).toContain('task-2');
      expect(result.output).toContain('completed');
      expect(result.output).toContain('running');
    });

    /**
     * @requirement REQ-ASYNC-008
     * @scenario No async tasks
     * @given No tasks
     * @when /tasks list executed
     * @then Shows "No async tasks"
     */
    it('should handle empty task list', async () => {
      const manager = new AsyncTaskManager(5);
      const result = await executeCommand('/tasks list', { asyncTaskManager: manager });

      expect(result.output).toContain('No async tasks');
    });

    /**
     * @requirement REQ-ASYNC-008
     * @scenario Shows task duration
     * @given A completed task that ran for 5 seconds
     * @when /tasks list executed
     * @then Shows duration
     */
    it('should show task duration', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research', abortController: new AbortController() });
      
      // Simulate time passing
      const task = manager.getTask('task-1')!;
      (task as any).launchedAt = Date.now() - 5000;
      manager.completeTask('task-1', { emitted_vars: {}, terminate_reason: 'GOAL' });

      const result = await executeCommand('/tasks list', { asyncTaskManager: manager });

      expect(result.output).toMatch(/\d+(\.\d+)?s/); // Duration like "5.0s"
    });
  });

  describe('/task end', () => {
    /**
     * @requirement REQ-ASYNC-009
     * @scenario Cancel task by exact ID
     * @given A running task with ID 'task-abc123'
     * @when /task end task-abc123 executed
     * @then Task is cancelled, confirmation shown
     */
    it('should cancel task by exact ID', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-abc123', subagentName: 'researcher', goalPrompt: 'Research', abortController: new AbortController() });

      const result = await executeCommand('/task end task-abc123', { asyncTaskManager: manager });

      expect(result.success).toBe(true);
      expect(manager.getTask('task-abc123')?.status).toBe('cancelled');
      expect(result.output).toContain('cancelled');
    });

    /**
     * @requirement REQ-ASYNC-009
     * @scenario Cancel task by unique prefix
     * @given Tasks 'abc123' and 'def456'
     * @when /task end abc executed
     * @then Task abc123 is cancelled
     */
    it('should cancel task by unique prefix', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'abc123', subagentName: 'researcher1', goalPrompt: 'R1', abortController: new AbortController() });
      manager.registerTask({ id: 'def456', subagentName: 'researcher2', goalPrompt: 'R2', abortController: new AbortController() });

      const result = await executeCommand('/task end abc', { asyncTaskManager: manager });

      expect(result.success).toBe(true);
      expect(manager.getTask('abc123')?.status).toBe('cancelled');
      expect(manager.getTask('def456')?.status).toBe('running');
    });

    /**
     * @requirement REQ-ASYNC-009
     * @scenario Ambiguous prefix
     * @given Tasks 'abc123' and 'abc456'
     * @when /task end abc executed
     * @then Error with list of candidates
     */
    it('should report error for ambiguous prefix', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'abc123', subagentName: 'r1', goalPrompt: 'R1', abortController: new AbortController() });
      manager.registerTask({ id: 'abc456', subagentName: 'r2', goalPrompt: 'R2', abortController: new AbortController() });

      const result = await executeCommand('/task end abc', { asyncTaskManager: manager });

      expect(result.success).toBe(false);
      expect(result.output).toContain('Multiple');
      expect(result.output).toContain('abc123');
      expect(result.output).toContain('abc456');
    });

    /**
     * @requirement REQ-ASYNC-009
     * @scenario No matching task
     * @given No task matching prefix
     * @when /task end xyz executed
     * @then Error "No task found"
     */
    it('should report error for no matching task', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'abc123', subagentName: 'researcher', goalPrompt: 'Research', abortController: new AbortController() });

      const result = await executeCommand('/task end xyz', { asyncTaskManager: manager });

      expect(result.success).toBe(false);
      expect(result.output).toContain('No task found');
    });

    /**
     * @requirement REQ-ASYNC-009
     * @scenario Cancel already-completed task
     * @given A completed task
     * @when /task end executed
     * @then Error "Task already completed"
     */
    it('should report error for already completed task', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research', abortController: new AbortController() });
      manager.completeTask('task-1', { emitted_vars: {}, terminate_reason: 'GOAL' });

      const result = await executeCommand('/task end task-1', { asyncTaskManager: manager });

      expect(result.success).toBe(false);
      expect(result.output).toContain('already');
    });
  });
});
```

## Verification Commands

```bash
# Check plan markers
grep -rn "@plan PLAN-20260130-ASYNCTASK.P16" packages/cli/src

# Count tests
grep -c "it\(" packages/cli/src/ui/commands.test.ts  # or wherever tests are
# Expected: >= 8

# Run tests (should FAIL with stub)
npm test -- packages/cli
```

## Success Criteria

- [ ] >= 8 tests for slash commands
- [ ] Tests cover both commands
- [ ] Tests cover edge cases
- [ ] Tests FAIL with stub

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P16.md`
