# Phase 13: Check Async Tasks Tool TDD

## Phase ID
`PLAN-20260130-ASYNCTASK.P13`

## Prerequisites
- Required: Phase 12a completed
- Pseudocode: `analysis/pseudocode/check-async-tasks-tool.md`

## Requirements Implemented

Tests for REQ-ASYNC-007.

## Implementation Tasks

### Files to Modify

- `packages/core/src/tools/check-async-tasks.test.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P13`

### Required Tests

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P13
 * @requirement REQ-ASYNC-007
 */

describe('CheckAsyncTasksTool', () => {
  describe('list mode (no task_id)', () => {
    /**
     * @requirement REQ-ASYNC-007
     * @scenario List all async tasks
     * @given 2 running tasks, 1 completed task
     * @when check_async_tasks called with no args
     * @then Returns summary of all 3 tasks
     */
    it('should list all tasks with status', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-1', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });
      manager.registerTask({ id: 'task-2', subagentName: 'analyst', goalPrompt: 'Analyze Y', abortController: new AbortController() });
      manager.registerTask({ id: 'task-3', subagentName: 'writer', goalPrompt: 'Write Z', abortController: new AbortController() });
      manager.completeTask('task-3', { emitted_vars: {}, terminate_reason: 'GOAL' });

      const tool = new CheckAsyncTasksTool({ getAsyncTaskManager: () => manager });
      const result = await tool.createInvocation({}).execute(new AbortController().signal);

      expect(result.llmContent).toContain('task-1');
      expect(result.llmContent).toContain('task-2');
      expect(result.llmContent).toContain('task-3');
      expect(result.llmContent).toContain('running');
      expect(result.llmContent).toContain('completed');
    });

    /**
     * @requirement REQ-ASYNC-007
     * @scenario No async tasks
     * @given No tasks registered
     * @when check_async_tasks called
     * @then Returns "No async tasks" message
     */
    it('should handle empty task list', async () => {
      const manager = new AsyncTaskManager(5);
      const tool = new CheckAsyncTasksTool({ getAsyncTaskManager: () => manager });
      const result = await tool.createInvocation({}).execute(new AbortController().signal);

      expect(result.llmContent).toContain('No async tasks');
    });
  });

  describe('peek mode (with task_id)', () => {
    /**
     * @requirement REQ-ASYNC-007
     * @scenario Get details of specific task
     * @given A completed task with output
     * @when check_async_tasks called with task_id
     * @then Returns full task details including output
     */
    it('should return task details when exact ID provided', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-abc123', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });
      manager.completeTask('task-abc123', { 
        emitted_vars: { result: 'important finding' }, 
        terminate_reason: 'GOAL',
        final_message: 'Research complete'
      });

      const tool = new CheckAsyncTasksTool({ getAsyncTaskManager: () => manager });
      const result = await tool.createInvocation({ task_id: 'task-abc123' }).execute(new AbortController().signal);

      expect(result.llmContent).toContain('task-abc123');
      expect(result.llmContent).toContain('completed');
      expect(result.llmContent).toContain('important finding');
      expect(result.llmContent).toContain('Research complete');
    });

    /**
     * @requirement REQ-ASYNC-007
     * @scenario Prefix matching - unique
     * @given Tasks with IDs 'abc123' and 'def456'
     * @when check_async_tasks called with task_id='abc'
     * @then Returns details of abc123 task
     */
    it('should match unique prefix', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'abc123', subagentName: 'researcher', goalPrompt: 'Research', abortController: new AbortController() });
      manager.registerTask({ id: 'def456', subagentName: 'analyst', goalPrompt: 'Analyze', abortController: new AbortController() });

      const tool = new CheckAsyncTasksTool({ getAsyncTaskManager: () => manager });
      const result = await tool.createInvocation({ task_id: 'abc' }).execute(new AbortController().signal);

      expect(result.llmContent).toContain('abc123');
      expect(result.llmContent).toContain('researcher');
      expect(result.llmContent).not.toContain('def456');
    });

    /**
     * @requirement REQ-ASYNC-007
     * @scenario Prefix matching - ambiguous
     * @given Tasks with IDs 'abc123' and 'abc456'
     * @when check_async_tasks called with task_id='abc'
     * @then Returns list of matching candidates
     */
    it('should list candidates when prefix is ambiguous', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'abc123', subagentName: 'researcher1', goalPrompt: 'Research 1', abortController: new AbortController() });
      manager.registerTask({ id: 'abc456', subagentName: 'researcher2', goalPrompt: 'Research 2', abortController: new AbortController() });

      const tool = new CheckAsyncTasksTool({ getAsyncTaskManager: () => manager });
      const result = await tool.createInvocation({ task_id: 'abc' }).execute(new AbortController().signal);

      expect(result.llmContent).toContain('Multiple tasks match');
      expect(result.llmContent).toContain('abc123');
      expect(result.llmContent).toContain('abc456');
    });

    /**
     * @requirement REQ-ASYNC-007
     * @scenario No match
     * @given Tasks exist but none match
     * @when check_async_tasks called with non-matching task_id
     * @then Returns "No task found" message
     */
    it('should handle no matching task', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'abc123', subagentName: 'researcher', goalPrompt: 'Research', abortController: new AbortController() });

      const tool = new CheckAsyncTasksTool({ getAsyncTaskManager: () => manager });
      const result = await tool.createInvocation({ task_id: 'xyz' }).execute(new AbortController().signal);

      expect(result.llmContent).toContain('No task found');
    });

    /**
     * @requirement REQ-ASYNC-007
     * @scenario Running task shows partial info
     * @given A running task
     * @when check_async_tasks called with task_id
     * @then Shows status=running, no output yet
     */
    it('should show running status for incomplete task', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-run', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });

      const tool = new CheckAsyncTasksTool({ getAsyncTaskManager: () => manager });
      const result = await tool.createInvocation({ task_id: 'task-run' }).execute(new AbortController().signal);

      expect(result.llmContent).toContain('running');
      expect(result.llmContent).not.toContain('emitted_vars'); // No output yet
    });

    /**
     * @requirement REQ-ASYNC-007
     * @scenario Failed task shows error
     * @given A failed task
     * @when check_async_tasks called with task_id
     * @then Shows status=failed with error message
     */
    it('should show error for failed task', async () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({ id: 'task-fail', subagentName: 'researcher', goalPrompt: 'Research X', abortController: new AbortController() });
      manager.failTask('task-fail', 'Network timeout');

      const tool = new CheckAsyncTasksTool({ getAsyncTaskManager: () => manager });
      const result = await tool.createInvocation({ task_id: 'task-fail' }).execute(new AbortController().signal);

      expect(result.llmContent).toContain('failed');
      expect(result.llmContent).toContain('Network timeout');
    });
  });
});
```

## Verification Commands

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P13" packages/core/src/tools/check-async-tasks.test.ts

# Count tests
grep -c "it\(" packages/core/src/tools/check-async-tasks.test.ts
# Expected: >= 8

# Run tests (should FAIL)
npm test -- packages/core/src/tools/check-async-tasks.test.ts
# Expected: Tests fail (stub implementation)
```

## Success Criteria

- [ ] >= 8 tests
- [ ] Tests cover list mode and peek mode
- [ ] Tests cover prefix matching
- [ ] Tests FAIL with stub

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P13.md`
