/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P04
 * @requirement REQ-ASYNC-001, REQ-ASYNC-002
 */

import { describe, it, expect, vi } from 'vitest';
import { AsyncTaskManager } from './asyncTaskManager.js';

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
        abortController: new AbortController(),
      });

      expect(task.id).toBe('test-123');
      expect(task.subagentName).toBe('researcher');
      expect(task.goalPrompt).toBe('Research topic X');
      expect(task.status).toBe('running');
      expect(task.launchedAt).toBeLessThanOrEqual(Date.now());
      expect(task.completedAt).toBeUndefined();
      expect(task.notifiedAt).toBeUndefined();
    });

    it('should track registered task in getTask()', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'test-123',
        subagentName: 'researcher',
        goalPrompt: 'Research topic X',
        abortController: new AbortController(),
      });

      const retrieved = manager.getTask('test-123');
      expect(retrieved).toBeDefined();
      expect(retrieved?.status).toBe('running');
    });

    it('should track registered task in getAllTasks()', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test1',
        goalPrompt: 'goal1',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'task-2',
        subagentName: 'test2',
        goalPrompt: 'goal2',
        abortController: new AbortController(),
      });

      const allTasks = manager.getAllTasks();
      expect(allTasks.length).toBe(2);
      expect(allTasks.find((t) => t.id === 'task-1')).toBeDefined();
      expect(allTasks.find((t) => t.id === 'task-2')).toBeDefined();
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
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });

      const result = manager.completeTask('task-1', {
        emitted_vars: { key: 'value' },
        terminate_reason: 'GOAL',
      });

      expect(result).toBe(true);
      const task = manager.getTask('task-1');
      expect(task?.status).toBe('completed');
      expect(task?.output).toEqual({
        emitted_vars: { key: 'value' },
        terminate_reason: 'GOAL',
      });
      expect(task?.completedAt).toBeDefined();
      expect(task?.completedAt).toBeLessThanOrEqual(Date.now());
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
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      const result = manager.completeTask('task-1', {
        emitted_vars: { different: 'data' },
        terminate_reason: 'GOAL',
      });

      expect(result).toBe(false);
      // Original output unchanged
      expect(manager.getTask('task-1')?.output?.emitted_vars).toEqual({});
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario Fail a running task
     * @given A registered running task
     * @when failTask is called with error
     * @then Status becomes 'failed' with error and completedAt
     */
    it('should transition running task to failed', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });

      const result = manager.failTask('task-1', 'Something went wrong');

      expect(result).toBe(true);
      const task = manager.getTask('task-1');
      expect(task?.status).toBe('failed');
      expect(task?.error).toBe('Something went wrong');
      expect(task?.completedAt).toBeDefined();
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario Idempotent failure
     * @given A task already in terminal state
     * @when failTask is called again
     * @then Returns false, no state change
     */
    it('should return false when failing already-terminal task (idempotent)', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      const result = manager.failTask('task-1', 'Different error');

      expect(result).toBe(false);
      expect(manager.getTask('task-1')?.status).toBe('completed'); // Not changed
      expect(manager.getTask('task-1')?.error).toBeUndefined();
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario Cancel a running task
     * @given A registered running task
     * @when cancelTask is called
     * @then Status becomes 'cancelled' and abortController is aborted
     */
    it('should transition running task to cancelled and abort controller', () => {
      const manager = new AsyncTaskManager(5);
      const controller = new AbortController();
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: controller,
      });

      const result = manager.cancelTask('task-1');

      expect(result).toBe(true);
      const task = manager.getTask('task-1');
      expect(task?.status).toBe('cancelled');
      expect(task?.completedAt).toBeDefined();
      expect(controller.signal.aborted).toBe(true);
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario Idempotent cancellation
     * @given A task already in terminal state
     * @when cancelTask is called again
     * @then Returns false, no state change
     */
    it('should return false when cancelling already-terminal task (idempotent)', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      const result = manager.cancelTask('task-1');

      expect(result).toBe(false);
      expect(manager.getTask('task-1')?.status).toBe('completed'); // Not changed
    });

    it('should return false when cancelling non-existent task', () => {
      const manager = new AsyncTaskManager(5);
      const result = manager.cancelTask('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false when completing non-existent task', () => {
      const manager = new AsyncTaskManager(5);
      const result = manager.completeTask('nonexistent', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });
      expect(result).toBe(false);
    });

    it('should return false when failing non-existent task', () => {
      const manager = new AsyncTaskManager(5);
      const result = manager.failTask('nonexistent', 'error');
      expect(result).toBe(false);
    });
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
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'task-2',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'task-3',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });

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
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'task-2',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });

      expect(manager.canLaunchAsync()).toEqual({
        allowed: false,
        reason: 'Max async tasks (2) reached',
      });
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario Completed tasks don't count against limit
     * @given maxAsyncTasks=2, one running task, one completed task
     * @when canLaunchAsync is called
     * @then Returns { allowed: true }
     */
    it('should only count running tasks against limit', () => {
      const manager = new AsyncTaskManager(2);
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'task-2',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      expect(manager.canLaunchAsync()).toEqual({ allowed: true });
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
        manager.registerTask({
          id: `task-${i}`,
          subagentName: 'test',
          goalPrompt: 'goal',
          abortController: new AbortController(),
        });
      }
      expect(manager.canLaunchAsync()).toEqual({ allowed: true });
    });
  });

  describe('query methods', () => {
    it('should return running tasks only', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'task-2',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'task-3',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      const running = manager.getRunningTasks();
      expect(running.length).toBe(2);
      expect(running.find((t) => t.id === 'task-2')).toBeDefined();
      expect(running.find((t) => t.id === 'task-3')).toBeDefined();
    });

    it('should return pending notifications (completed/failed, not notified)', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'task-2',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'task-3',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });

      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });
      manager.failTask('task-2', 'error');
      // task-3 still running

      const pending = manager.getPendingNotifications();
      expect(pending.length).toBe(2);
      expect(pending.find((t) => t.id === 'task-1')).toBeDefined();
      expect(pending.find((t) => t.id === 'task-2')).toBeDefined();
    });

    it('should not include notified tasks in pending notifications', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });
      manager.markNotified('task-1');

      const pending = manager.getPendingNotifications();
      expect(pending.length).toBe(0);
    });

    it('should not include cancelled tasks in pending notifications', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.cancelTask('task-1');

      const pending = manager.getPendingNotifications();
      expect(pending.length).toBe(0);
    });
  });

  describe('markNotified', () => {
    it('should set notifiedAt timestamp', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      manager.markNotified('task-1');

      const task = manager.getTask('task-1');
      expect(task?.notifiedAt).toBeDefined();
      expect(task?.notifiedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should be idempotent (not change timestamp on repeat calls)', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      manager.markNotified('task-1');
      const firstTimestamp = manager.getTask('task-1')?.notifiedAt;

      manager.markNotified('task-1');
      const secondTimestamp = manager.getTask('task-1')?.notifiedAt;

      expect(secondTimestamp).toBe(firstTimestamp);
    });

    it('should handle marking non-existent task', () => {
      const manager = new AsyncTaskManager(5);
      // Should not throw
      expect(() => manager.markNotified('nonexistent')).not.toThrow();
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
        manager.registerTask({
          id: `task-${i}`,
          subagentName: 'test',
          goalPrompt: 'goal',
          abortController: new AbortController(),
        });
        manager.completeTask(`task-${i}`, {
          emitted_vars: {},
          terminate_reason: 'GOAL',
        });
        manager.markNotified(`task-${i}`);
      }

      const tasks = manager.getAllTasks();
      expect(tasks.length).toBe(4);
      expect(tasks.find((t) => t.id === 'task-0')).toBeUndefined(); // Oldest removed
      expect(tasks.find((t) => t.id === 'task-4')).toBeDefined(); // Newest kept
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
        manager.registerTask({
          id: `task-${i}`,
          subagentName: 'test',
          goalPrompt: 'goal',
          abortController: new AbortController(),
        });
        manager.completeTask(`task-${i}`, {
          emitted_vars: {},
          terminate_reason: 'GOAL',
        });
        manager.markNotified(`task-${i}`);
      }

      const tasks = manager.getAllTasks();
      expect(tasks.length).toBe(10);
      expect(tasks.find((t) => t.id === 'task-0')).toBeUndefined();
      expect(tasks.find((t) => t.id === 'task-10')).toBeDefined();
    });

    /**
     * @requirement REQ-ASYNC-002
     * @scenario Don't remove unnotified tasks
     * @given maxAsyncTasks=2 (limit=4) and 5 completed tasks, only 3 notified
     * @when enforceHistoryLimit runs
     * @then Only notified tasks are removed, unnotified remain
     */
    it('should not remove unnotified tasks even if over limit', () => {
      const manager = new AsyncTaskManager(2); // limit = 4

      // Create 5 tasks, only notify first 3
      for (let i = 0; i < 5; i++) {
        manager.registerTask({
          id: `task-${i}`,
          subagentName: 'test',
          goalPrompt: 'goal',
          abortController: new AbortController(),
        });
        manager.completeTask(`task-${i}`, {
          emitted_vars: {},
          terminate_reason: 'GOAL',
        });
        if (i < 3) {
          manager.markNotified(`task-${i}`);
        }
      }

      const tasks = manager.getAllTasks();
      // Should have 4 tasks (removed task-0, kept task-1, task-2, task-3 (unnotified), task-4 (unnotified))
      expect(tasks.length).toBe(4);
      expect(tasks.find((t) => t.id === 'task-3')).toBeDefined(); // Unnotified kept
      expect(tasks.find((t) => t.id === 'task-4')).toBeDefined(); // Unnotified kept
    });

    it('should count failed tasks in history limit', () => {
      const manager = new AsyncTaskManager(2); // limit = 4

      for (let i = 0; i < 5; i++) {
        manager.registerTask({
          id: `task-${i}`,
          subagentName: 'test',
          goalPrompt: 'goal',
          abortController: new AbortController(),
        });
        if (i % 2 === 0) {
          manager.completeTask(`task-${i}`, {
            emitted_vars: {},
            terminate_reason: 'GOAL',
          });
        } else {
          manager.failTask(`task-${i}`, 'error');
        }
        manager.markNotified(`task-${i}`);
      }

      const tasks = manager.getAllTasks();
      expect(tasks.length).toBe(4);
    });

    it('should update limit when setMaxAsyncTasks is called', () => {
      const manager = new AsyncTaskManager(5);

      // Create 6 completed notified tasks (limit = 5 * 2 = 10, all fit)
      for (let i = 0; i < 6; i++) {
        manager.registerTask({
          id: `task-${i}`,
          subagentName: 'test',
          goalPrompt: 'goal',
          abortController: new AbortController(),
        });
        manager.completeTask(`task-${i}`, {
          emitted_vars: {},
          terminate_reason: 'GOAL',
        });
        manager.markNotified(`task-${i}`);
      }

      expect(manager.getAllTasks().length).toBe(6);

      // Change max to 2 (limit = 2 * 2 = 4)
      manager.setMaxAsyncTasks(2);

      // Should now have only 4 tasks
      expect(manager.getAllTasks().length).toBe(4);
      expect(
        manager.getAllTasks().find((t) => t.id === 'task-0'),
      ).toBeUndefined();
      expect(
        manager.getAllTasks().find((t) => t.id === 'task-1'),
      ).toBeUndefined();
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
      manager.registerTask({
        id: 'abc123',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'def456',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });

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
      manager.registerTask({
        id: 'abc123',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'abc456',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });

      const result = manager.getTaskByPrefix('abc');
      expect(result.task).toBeUndefined();
      expect(result.candidates?.length).toBe(2);
      expect(result.candidates?.find((t) => t.id === 'abc123')).toBeDefined();
      expect(result.candidates?.find((t) => t.id === 'abc456')).toBeDefined();
    });

    it('should return empty object when no match', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'abc123',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });

      const result = manager.getTaskByPrefix('xyz');
      expect(result.task).toBeUndefined();
      expect(result.candidates).toBeUndefined();
    });

    it('should match exact ID', () => {
      const manager = new AsyncTaskManager(5);
      manager.registerTask({
        id: 'abc123',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });

      const result = manager.getTaskByPrefix('abc123');
      expect(result.task?.id).toBe('abc123');
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

      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'task-1',
          status: 'completed',
        }),
      );
    });

    it('should emit task-failed event', () => {
      const manager = new AsyncTaskManager(5);
      const handler = vi.fn();
      manager.onTaskFailed(handler);

      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.failTask('task-1', 'error');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'task-1',
          status: 'failed',
          error: 'error',
        }),
      );
    });

    it('should emit task-cancelled event', () => {
      const manager = new AsyncTaskManager(5);
      const handler = vi.fn();
      manager.onTaskCancelled(handler);

      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.cancelTask('task-1');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'task-1',
          status: 'cancelled',
        }),
      );
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

      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not emit event for idempotent operations', () => {
      const manager = new AsyncTaskManager(5);
      const handler = vi.fn();
      manager.onTaskCompleted(handler);

      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      expect(handler).toHaveBeenCalledTimes(1); // Only once
    });
  });

  describe('reservation race condition', () => {
    /**
     * @requirement REQ-ASYNC-001
     * @scenario Concurrent reservations must not exceed max limit
     * @given maxAsyncTasks=1 and no running tasks
     * @when two tryReserveAsyncSlot calls are made without intermediate registerTask
     * @then Only the first reservation succeeds; second returns null
     */
    it('should prevent concurrent reservations from exceeding max limit', () => {
      const manager = new AsyncTaskManager(1);

      const booking1 = manager.tryReserveAsyncSlot();
      expect(booking1).not.toBeNull();

      // Second reservation should be denied because pending reservation
      // counts against the limit
      const booking2 = manager.tryReserveAsyncSlot();
      expect(booking2).toBeNull();
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario Pending reservations plus running tasks must not exceed limit
     * @given maxAsyncTasks=2, one running task, one pending reservation
     * @when tryReserveAsyncSlot is called again
     * @then Returns null because running(1) + pending(1) = 2 = max
     */
    it('should count pending reservations in addition to running tasks', () => {
      const manager = new AsyncTaskManager(2);

      // Register one running task
      manager.registerTask({
        id: 'task-1',
        subagentName: 'test',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });

      // Reserve one slot
      const booking = manager.tryReserveAsyncSlot();
      expect(booking).not.toBeNull();

      // Third attempt should fail: 1 running + 1 pending = 2 = max
      const booking2 = manager.tryReserveAsyncSlot();
      expect(booking2).toBeNull();
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario Expired reservations should be cleaned up and not block new reservations
     * @given maxAsyncTasks=1 and one expired reservation
     * @when tryReserveAsyncSlot is called
     * @then Returns a valid booking ID because expired reservation was cleaned up
     */
    it('should clean up expired reservations before checking limit', () => {
      const manager = new AsyncTaskManager(1);

      // Create a reservation
      const booking1 = manager.tryReserveAsyncSlot();
      expect(booking1).not.toBeNull();

      // Fast-forward time past expiration (5 seconds)
      vi.useFakeTimers();
      vi.advanceTimersByTime(6000);

      // Now the expired reservation should be cleaned up and a new one allowed
      const booking2 = manager.tryReserveAsyncSlot();
      expect(booking2).not.toBeNull();

      vi.useRealTimers();
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario canLaunchAsync should account for pending reservations
     * @given maxAsyncTasks=1 and one pending reservation
     * @when canLaunchAsync is called
     * @then Returns { allowed: false } because pending reservation fills the limit
     */
    it('should include pending reservations in canLaunchAsync check', () => {
      const manager = new AsyncTaskManager(1);

      const booking = manager.tryReserveAsyncSlot();
      expect(booking).not.toBeNull();

      expect(manager.canLaunchAsync()).toEqual({
        allowed: false,
        reason: 'Max async tasks (1) reached',
      });
    });

    /**
     * @requirement REQ-ASYNC-001
     * @scenario cancelReservation frees the slot
     * @given maxAsyncTasks=1 and one pending reservation
     * @when cancelReservation is called with the booking ID
     * @then The slot is freed and a new reservation can be made
     */
    it('should free slot when cancelReservation is called', () => {
      const manager = new AsyncTaskManager(1);

      const booking = manager.tryReserveAsyncSlot();
      expect(booking).not.toBeNull();

      // Slot is occupied
      expect(manager.canLaunchAsync().allowed).toBe(false);

      // Cancel the reservation
      const cancelled = manager.cancelReservation(booking!);
      expect(cancelled).toBe(true);

      // Slot is now free
      expect(manager.canLaunchAsync().allowed).toBe(true);
    });

    it('should return false when cancelling non-existent reservation', () => {
      const manager = new AsyncTaskManager(5);
      expect(manager.cancelReservation('bogus-id')).toBe(false);
    });
  });
});
