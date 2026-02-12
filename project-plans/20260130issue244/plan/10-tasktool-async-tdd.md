# Phase 10: Task Tool Async Mode TDD

## Phase ID
`PLAN-20260130-ASYNCTASK.P10`

## Prerequisites
- Required: Phase 09a completed
- Pseudocode: `analysis/pseudocode/task-tool-async.md`

## Requirements Implemented

Tests for REQ-ASYNC-005 and REQ-ASYNC-006.

## Implementation Tasks

### Files to Modify

- `packages/core/src/tools/task.test.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P10`
  - Add new describe block for async mode tests

### Required Tests

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P10
 * @requirement REQ-ASYNC-005, REQ-ASYNC-006
 */

describe('TaskTool async mode', () => {
  let mockAsyncTaskManager: AsyncTaskManager;
  
  beforeEach(() => {
    mockAsyncTaskManager = new AsyncTaskManager(5);
  });

  /**
   * @requirement REQ-ASYNC-005
   * @scenario Check canLaunchAsync before launching
   * @given async=true and max async tasks reached
   * @when Task tool execute called
   * @then Returns error without launching
   */
  it('should check canLaunchAsync and reject if limit reached', async () => {
    const manager = new AsyncTaskManager(1);
    manager.registerTask({ id: 'existing', subagentName: 'test', goalPrompt: 'test', abortController: new AbortController() });
    
    // Setup task tool with manager that has 1 task already (limit = 1)
    const tool = createTaskToolWithAsyncManager(manager);
    const result = await tool.execute({ 
      subagent_name: 'test', 
      goal_prompt: 'test',
      async: true 
    });
    
    expect(result.error).toBeDefined();
    expect(result.llmContent).toContain('Max async tasks');
  });

  /**
   * @requirement REQ-ASYNC-005
   * @scenario Async task returns immediately
   * @given async=true
   * @when Task tool execute called
   * @then Returns launch status before subagent completes
   */
  it('should return immediately with launch status', async () => {
    const tool = createTaskToolWithSlowSubagent(5000); // Would take 5s if waited
    
    const startTime = Date.now();
    const result = await tool.execute({
      subagent_name: 'researcher',
      goal_prompt: 'Research topic X',
      async: true
    });
    const elapsed = Date.now() - startTime;
    
    expect(elapsed).toBeLessThan(1000); // Should return in < 1s
    expect(result.llmContent).toContain('launched');
    expect(result.llmContent).toContain('researcher');
    expect(result.metadata?.async).toBe(true);
    expect(result.metadata?.status).toBe('running');
  });

  /**
   * @requirement REQ-ASYNC-005
   * @scenario Task registered with AsyncTaskManager
   * @given async=true and task launched
   * @when Task returns
   * @then Task is registered in AsyncTaskManager
   */
  it('should register task with AsyncTaskManager', async () => {
    const manager = new AsyncTaskManager(5);
    const tool = createTaskToolWithAsyncManager(manager);
    
    await tool.execute({
      subagent_name: 'researcher',
      goal_prompt: 'Research topic X',
      async: true
    });
    
    const tasks = manager.getAllTasks();
    expect(tasks.length).toBe(1);
    expect(tasks[0].subagentName).toBe('researcher');
    expect(tasks[0].goalPrompt).toBe('Research topic X');
    expect(tasks[0].status).toBe('running');
  });

  /**
   * @requirement REQ-ASYNC-005
   * @scenario Background task completes successfully
   * @given async task running
   * @when Subagent completes
   * @then AsyncTaskManager task status becomes completed with output
   */
  it('should update AsyncTaskManager when background task completes', async () => {
    const manager = new AsyncTaskManager(5);
    const tool = createTaskToolWithAsyncManager(manager, { completionDelay: 100 });
    
    await tool.execute({
      subagent_name: 'researcher',
      goal_prompt: 'Research topic X',
      async: true
    });
    
    // Wait for background completion
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const task = manager.getAllTasks()[0];
    expect(task.status).toBe('completed');
    expect(task.output).toBeDefined();
  });

  /**
   * @requirement REQ-ASYNC-005
   * @scenario Background task fails
   * @given async task running
   * @when Subagent throws error
   * @then AsyncTaskManager task status becomes failed with error
   */
  it('should update AsyncTaskManager when background task fails', async () => {
    const manager = new AsyncTaskManager(5);
    const tool = createTaskToolWithAsyncManager(manager, { shouldFail: true });
    
    await tool.execute({
      subagent_name: 'researcher',
      goal_prompt: 'Research topic X',
      async: true
    });
    
    // Wait for background failure
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const task = manager.getAllTasks()[0];
    expect(task.status).toBe('failed');
    expect(task.error).toBeDefined();
  });

  /**
   * @requirement REQ-ASYNC-006
   * @scenario Async task goes through scheduler
   * @given async=true
   * @when Task launched
   * @then Task uses same scheduler as sync tasks
   */
  it('should use tool scheduler for async tasks', async () => {
    const schedulerCalls: string[] = [];
    const mockScheduler = createMockScheduler(schedulerCalls);
    const tool = createTaskToolWithScheduler(mockScheduler);
    
    await tool.execute({
      subagent_name: 'researcher',
      goal_prompt: 'Research topic X',
      async: true
    });
    
    expect(schedulerCalls).toContain('schedule');
  });

  /**
   * @requirement REQ-ASYNC-005
   * @scenario Return contains agent ID
   * @given async=true
   * @when Task returns
   * @then Metadata includes agentId for later reference
   */
  it('should return agentId in metadata', async () => {
    const tool = createTaskTool();
    
    const result = await tool.execute({
      subagent_name: 'researcher',
      goal_prompt: 'Research topic X',
      async: true
    });
    
    expect(result.metadata?.agentId).toBeDefined();
    expect(typeof result.metadata?.agentId).toBe('string');
  });

  /**
   * @requirement REQ-ASYNC-005
   * @scenario Sync mode unchanged
   * @given async=false (or not set)
   * @when Task tool execute called
   * @then Behavior is same as before (blocking)
   */
  it('should maintain sync behavior when async=false', async () => {
    const tool = createTaskTool();
    
    const result = await tool.execute({
      subagent_name: 'researcher',
      goal_prompt: 'Research topic X',
      async: false
    });
    
    // Sync mode waits for completion
    expect(result.metadata?.terminateReason).toBeDefined();
  });
});
```

## Verification Commands

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P10" packages/core/src/tools/task.test.ts

# Count async tests
grep -c "async mode\|async.*true\|async=true" packages/core/src/tools/task.test.ts
# Expected: >= 8

# Run tests (should FAIL for async, PASS for sync)
npm test -- packages/core/src/tools/task.test.ts 2>&1 | grep -E "async mode"
# Expected: Test failures for async mode
```

## Success Criteria

- [ ] >= 8 async mode tests
- [ ] Tests cover launch, completion, failure, scheduler
- [ ] Tests FAIL with stub implementation
- [ ] Sync tests still pass

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P10.md`
