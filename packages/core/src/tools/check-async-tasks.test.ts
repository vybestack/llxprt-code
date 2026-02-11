/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P13
 */

import { describe, expect, it } from 'vitest';
import { CheckAsyncTasksTool } from './check-async-tasks.js';
import { AsyncTaskManager } from '../services/asyncTaskManager.js';

describe('CheckAsyncTasksTool', () => {
  const createMockManager = (): AsyncTaskManager => {
    const manager = new AsyncTaskManager(5);
    return manager;
  };

  const buildDependencies = (manager?: AsyncTaskManager) => ({
    getAsyncTaskManager: () => manager,
  });

  describe('List Mode', () => {
    it('returns summary of all tasks', async () => {
      const manager = createMockManager();

      // Add some test tasks
      manager.registerTask({
        id: 'task-abc123',
        subagentName: 'deepthinker',
        goalPrompt: 'Analyze codebase',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'task-def456',
        subagentName: 'typescriptexpert',
        goalPrompt: 'Refactor module',
        abortController: new AbortController(),
      });
      manager.completeTask('task-abc123', { emitted_vars: {} });

      const tool = new CheckAsyncTasksTool(buildDependencies(manager));
      const invocation = tool.build({});
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.metadata).toMatchObject({
        count: 2,
        running: 1,
        completed: 1,
        failed: 0,
        cancelled: 0,
      });
      expect(result.llmContent).toContain('Async Tasks Summary');
      expect(result.llmContent).toContain('Running: 1');
      expect(result.llmContent).toContain('Completed: 1');
      // Full task IDs are shown, not subagent names (those are in peek mode)
      expect(result.llmContent).toContain('task-abc123');
      expect(result.llmContent).toContain('task-def456');
    });

    it('uses [FAILED] status label (not [ERROR]) for failed tasks', async () => {
      const manager = createMockManager();

      manager.registerTask({
        id: 'task-failed-123',
        subagentName: 'typescriptexpert',
        goalPrompt: 'Fix boundary issue',
        abortController: new AbortController(),
      });
      manager.failTask('task-failed-123', 'Subagent execution failed');

      const tool = new CheckAsyncTasksTool(buildDependencies(manager));
      const invocation = tool.build({});
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.returnDisplay).toContain(
        '[FAILED] **task-failed-123** - failed',
      );
      expect(result.returnDisplay).not.toContain('[ERROR]');
    });
    it('returns "no tasks" when empty', async () => {
      const manager = createMockManager();

      const tool = new CheckAsyncTasksTool(buildDependencies(manager));
      const invocation = tool.build({});
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.metadata).toEqual({ count: 0 });
      expect(result.llmContent).toBe('No async tasks.');
      expect(result.returnDisplay).toContain(
        'No async tasks are currently running or completed',
      );
    });
  });

  describe('Peek Mode', () => {
    it('returns detailed task info by exact ID', async () => {
      const manager = createMockManager();

      manager.registerTask({
        id: 'task-exact-match',
        subagentName: 'deepthinker',
        goalPrompt: 'Review PR',
        abortController: new AbortController(),
      });
      manager.completeTask('task-exact-match', {
        emitted_vars: { result: 'approved' },
      });

      const tool = new CheckAsyncTasksTool(buildDependencies(manager));
      const invocation = tool.build({ task_id: 'task-exact-match' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('"id": "task-exact-match"');
      expect(result.llmContent).toContain('"subagentName": "deepthinker"');
      expect(result.llmContent).toContain('"goalPrompt": "Review PR"');
      expect(result.llmContent).toContain('"status": "completed"');
      expect(result.llmContent).toContain('"result": "approved"');
    });

    it('returns detailed task info by prefix', async () => {
      const manager = createMockManager();

      manager.registerTask({
        id: 'task-prefix-test-12345',
        subagentName: 'typescriptexpert',
        goalPrompt: 'Implement feature',
        abortController: new AbortController(),
      });

      const tool = new CheckAsyncTasksTool(buildDependencies(manager));
      const invocation = tool.build({ task_id: 'task-prefix' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('"id": "task-prefix-test-12345"');
      expect(result.llmContent).toContain('"subagentName": "typescriptexpert"');
    });

    it('returns error for ambiguous prefix with candidates', async () => {
      const manager = createMockManager();

      manager.registerTask({
        id: 'task-abc-111',
        subagentName: 'deepthinker',
        goalPrompt: 'Task 1',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'task-abc-222',
        subagentName: 'typescriptexpert',
        goalPrompt: 'Task 2',
        abortController: new AbortController(),
      });

      const tool = new CheckAsyncTasksTool(buildDependencies(manager));
      const invocation = tool.build({ task_id: 'task-abc' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Ambiguous task ID');
      expect(result.llmContent).toContain(
        "Ambiguous task ID prefix 'task-abc'",
      );
      // Full task IDs now shown for ambiguous matches
      expect(result.llmContent).toContain('task-abc-111');
      expect(result.llmContent).toContain('task-abc-222');
    });

    it('uses [FAILED] status label in detailed display for failed tasks', async () => {
      const manager = createMockManager();

      manager.registerTask({
        id: 'task-failed-detail-123',
        subagentName: 'typescriptexpert',
        goalPrompt: 'Refactor module',
        abortController: new AbortController(),
      });
      manager.failTask('task-failed-detail-123', 'Compilation failed');

      const tool = new CheckAsyncTasksTool(buildDependencies(manager));
      const invocation = tool.build({ task_id: 'task-failed-detail-123' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.returnDisplay).toContain('[FAILED] **typescriptexpert**');
      expect(result.returnDisplay).not.toContain('[ERROR]');
    });

    it('returns error for not found', async () => {
      const manager = createMockManager();

      const tool = new CheckAsyncTasksTool(buildDependencies(manager));
      const invocation = tool.build({ task_id: 'nonexistent' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Task not found');
      expect(result.llmContent).toContain(
        "No async task found with ID or prefix 'nonexistent'",
      );
    });
  });

  describe('Duration Formatting', () => {
    it('formats seconds correctly', async () => {
      const manager = createMockManager();

      const launchedAt = Date.now();
      manager.registerTask({
        id: 'task-seconds',
        subagentName: 'deepthinker',
        goalPrompt: 'Quick task',
        abortController: new AbortController(),
      });

      // Simulate 15 seconds passing
      const task = manager.getTask('task-seconds');
      if (task) {
        task.launchedAt = launchedAt - 15000;
        task.completedAt = launchedAt;
        task.status = 'completed';
      }

      const tool = new CheckAsyncTasksTool(buildDependencies(manager));
      const invocation = tool.build({ task_id: 'task-seconds' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toContain('"duration": "15s"');
    });

    it('formats minutes correctly', async () => {
      const manager = createMockManager();

      const launchedAt = Date.now();
      manager.registerTask({
        id: 'task-minutes',
        subagentName: 'deepthinker',
        goalPrompt: 'Medium task',
        abortController: new AbortController(),
      });

      // Simulate 2 minutes 30 seconds
      const task = manager.getTask('task-minutes');
      if (task) {
        task.launchedAt = launchedAt - 150000; // 2m 30s
        task.completedAt = launchedAt;
        task.status = 'completed';
      }

      const tool = new CheckAsyncTasksTool(buildDependencies(manager));
      const invocation = tool.build({ task_id: 'task-minutes' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toContain('"duration": "2m 30s"');
    });

    it('formats hours correctly', async () => {
      const manager = createMockManager();

      const launchedAt = Date.now();
      manager.registerTask({
        id: 'task-hours',
        subagentName: 'deepthinker',
        goalPrompt: 'Long task',
        abortController: new AbortController(),
      });

      // Simulate 1 hour 15 minutes
      const task = manager.getTask('task-hours');
      if (task) {
        task.launchedAt = launchedAt - 4500000; // 1h 15m
        task.completedAt = launchedAt;
        task.status = 'completed';
      }

      const tool = new CheckAsyncTasksTool(buildDependencies(manager));
      const invocation = tool.build({ task_id: 'task-hours' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toContain('"duration": "1h 15m"');
    });
  });

  it('throws when AsyncTaskManager is unavailable', () => {
    const tool = new CheckAsyncTasksTool(buildDependencies(undefined));
    expect(() => tool.build({})).toThrow(
      'AsyncTaskManager service is unavailable. Please configure async tasks before invoking this tool.',
    );
  });
});
