# Phase 23: Integration Tests

## Phase ID
`PLAN-20260130-ASYNCTASK.P23`

## Prerequisites
- Required: Phase 22a completed

## Requirements Implemented

End-to-end behavioral tests that verify the complete async task lifecycle.

## Implementation Tasks

### Files to Create

- `packages/core/src/services/__tests__/asyncTask.integration.spec.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P23`

### Required Integration Tests

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P23
 * @requirement REQ-ASYNC-001 through REQ-ASYNC-012
 * 
 * Integration tests for complete async task lifecycle.
 * These tests verify the components work together correctly.
 */

describe('Async Task Integration', () => {
  describe('complete lifecycle', () => {
    /**
     * @scenario Full async task lifecycle
     * @given Config with all async task components wired
     * @when Async task is launched, completes, and notification delivered
     * @then All components interact correctly
     */
    it('should handle complete async task lifecycle', async () => {
      // Setup
      const config = createTestConfig();
      const manager = config.getAsyncTaskManager();
      const reminderService = config.getAsyncTaskReminderService();
      
      const deliveredMessages: string[] = [];
      const triggerAgentTurn = async (message: string) => {
        deliveredMessages.push(message);
      };
      
      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => false, // Not busy
        triggerAgentTurn,
      );
      const unsubscribe = autoTrigger.subscribe();

      try {
        // 1. Register task
        const task = manager.registerTask({
          id: 'integration-test-1',
          subagentName: 'test-agent',
          goalPrompt: 'Integration test goal',
          abortController: new AbortController(),
        });
        
        expect(task.status).toBe('running');
        expect(manager.getRunningTasks().length).toBe(1);
        
        // 2. Complete task
        manager.completeTask('integration-test-1', {
          emitted_vars: { result: 'success' },
          terminate_reason: 'GOAL',
        });
        
        expect(manager.getTask('integration-test-1')?.status).toBe('completed');
        
        // 3. Wait for auto-trigger
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 4. Verify notification delivered
        expect(deliveredMessages.length).toBe(1);
        expect(deliveredMessages[0]).toContain('integration-test-1');
        expect(deliveredMessages[0]).toContain('success');
        
        // 5. Verify notifiedAt set
        expect(manager.getTask('integration-test-1')?.notifiedAt).toBeDefined();
        
      } finally {
        unsubscribe();
      }
    });

    /**
     * @scenario Multiple async tasks with limit
     * @given task-max-async = 2
     * @when 3rd task launch attempted
     * @then Launch denied
     */
    it('should enforce task limits', async () => {
      const config = createTestConfig();
      const manager = config.getAsyncTaskManager();
      manager.setMaxAsyncTasks(2);
      
      // Launch 2 tasks (OK)
      manager.registerTask({ id: 't1', subagentName: 'a1', goalPrompt: 'g1', abortController: new AbortController() });
      manager.registerTask({ id: 't2', subagentName: 'a2', goalPrompt: 'g2', abortController: new AbortController() });
      
      // 3rd should fail
      const canLaunch = manager.canLaunchAsync();
      expect(canLaunch.allowed).toBe(false);
      expect(canLaunch.reason).toContain('2');
      
      // Complete one
      manager.completeTask('t1', { emitted_vars: {}, terminate_reason: 'GOAL' });
      
      // Now should allow
      expect(manager.canLaunchAsync().allowed).toBe(true);
    });

    /**
     * @scenario History limit enforcement
     * @given task-max-async = 2 (history limit = 4)
     * @when 5 tasks complete and are notified
     * @then Oldest is removed
     */
    it('should enforce history limits', async () => {
      const config = createTestConfig();
      const manager = config.getAsyncTaskManager();
      manager.setMaxAsyncTasks(2); // limit = 4
      
      for (let i = 0; i < 5; i++) {
        manager.registerTask({ 
          id: `task-${i}`, 
          subagentName: 'test', 
          goalPrompt: 'test', 
          abortController: new AbortController() 
        });
        manager.completeTask(`task-${i}`, { emitted_vars: {}, terminate_reason: 'GOAL' });
        manager.markNotified(`task-${i}`);
      }
      
      const tasks = manager.getAllTasks();
      expect(tasks.length).toBe(4);
      expect(tasks.find(t => t.id === 'task-0')).toBeUndefined(); // Oldest removed
    });

    /**
     * @scenario Slash command integration
     * @given Running async tasks
     * @when /tasks list executed
     * @then Shows all tasks
     */
    it('should integrate with slash commands', async () => {
      const config = createTestConfig();
      const manager = config.getAsyncTaskManager();
      
      manager.registerTask({ id: 'cmd-test-1', subagentName: 'agent1', goalPrompt: 'Goal 1', abortController: new AbortController() });
      manager.registerTask({ id: 'cmd-test-2', subagentName: 'agent2', goalPrompt: 'Goal 2', abortController: new AbortController() });
      
      const result = handleTasksList(manager);
      
      expect(result.success).toBe(true);
      expect(result.output).toContain('cmd-test-1');
      expect(result.output).toContain('cmd-test-2');
      expect(result.output).toContain('agent1');
      expect(result.output).toContain('agent2');
    });

    /**
     * @scenario Check async tasks tool integration
     * @given Completed async task
     * @when check_async_tasks tool executed
     * @then Returns task details
     */
    it('should integrate with check_async_tasks tool', async () => {
      const config = createTestConfig();
      const manager = config.getAsyncTaskManager();
      
      manager.registerTask({ id: 'tool-test', subagentName: 'researcher', goalPrompt: 'Research topic', abortController: new AbortController() });
      manager.completeTask('tool-test', { 
        emitted_vars: { finding: 'important' }, 
        terminate_reason: 'GOAL' 
      });
      
      const tool = new CheckAsyncTasksTool({ getAsyncTaskManager: () => manager });
      const result = await tool.createInvocation({ task_id: 'tool-test' }).execute(new AbortController().signal);
      
      expect(result.llmContent).toContain('tool-test');
      expect(result.llmContent).toContain('completed');
      expect(result.llmContent).toContain('finding');
    });
  });

  describe('concurrency scenarios', () => {
    /**
     * @scenario Rapid completions don't cause race conditions
     * @given Multiple tasks completing near-simultaneously
     * @when All completions processed
     * @then No lost notifications, no duplicates
     */
    it('should handle rapid completions without races', async () => {
      const config = createTestConfig();
      const manager = config.getAsyncTaskManager();
      const reminderService = config.getAsyncTaskReminderService();
      
      const deliveredMessages: string[] = [];
      const triggerAgentTurn = async (message: string) => {
        await new Promise(resolve => setTimeout(resolve, 10)); // Slow delivery
        deliveredMessages.push(message);
      };
      
      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => false,
        triggerAgentTurn,
      );
      const unsubscribe = autoTrigger.subscribe();

      try {
        // Launch 5 tasks
        for (let i = 0; i < 5; i++) {
          manager.registerTask({ id: `rapid-${i}`, subagentName: 'test', goalPrompt: 'test', abortController: new AbortController() });
        }
        
        // Complete all rapidly
        for (let i = 0; i < 5; i++) {
          manager.completeTask(`rapid-${i}`, { emitted_vars: {}, terminate_reason: 'GOAL' });
        }
        
        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // All should be notified (maybe in batches)
        for (let i = 0; i < 5; i++) {
          expect(manager.getTask(`rapid-${i}`)?.notifiedAt).toBeDefined();
        }
        
      } finally {
        unsubscribe();
      }
    });
  });
});
```

## Verification Commands

```bash
# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P23" packages/core/src/services/__tests__/asyncTask.integration.spec.ts

# Run integration tests
npm test -- packages/core/src/services/__tests__/asyncTask.integration.spec.ts
# Expected: All pass

# Full test suite
npm test
```

## Success Criteria

- [ ] Integration tests pass
- [ ] Lifecycle test covers full flow
- [ ] Concurrency test verifies no races
- [ ] All components work together

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P23.md`
