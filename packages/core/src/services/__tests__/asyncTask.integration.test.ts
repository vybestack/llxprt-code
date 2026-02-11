/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P23
 * @requirement REQ-ASYNC-001 through REQ-ASYNC-012
 *
 * Integration tests for complete async task lifecycle.
 * These tests verify the components work together correctly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AsyncTaskManager } from '../asyncTaskManager.js';
import { AsyncTaskReminderService } from '../asyncTaskReminderService.js';
import { AsyncTaskAutoTrigger } from '../asyncTaskAutoTrigger.js';

describe('Async Task Integration', () => {
  let manager: AsyncTaskManager;
  let reminderService: AsyncTaskReminderService;
  let unsubscribeFns: Array<() => void> = [];

  beforeEach(() => {
    manager = new AsyncTaskManager(5);
    reminderService = new AsyncTaskReminderService(manager);
    unsubscribeFns = [];
  });

  afterEach(() => {
    // Clean up all subscriptions
    unsubscribeFns.forEach((fn) => {
      fn();
    });
    unsubscribeFns = [];
  });

  describe('complete lifecycle', () => {
    /**
     * @scenario Full async task lifecycle
     * @given Config with all async task components wired
     * @when Async task is launched, completes, and notification delivered
     * @then All components interact correctly
     */
    it('should handle complete async task lifecycle', async () => {
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
      unsubscribeFns.push(unsubscribe);

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
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 4. Verify notification delivered
      expect(deliveredMessages.length).toBe(1);
      expect(deliveredMessages[0]).toContain('integration-test-1');
      expect(deliveredMessages[0]).toContain('success');

      // 5. Verify notifiedAt set
      expect(manager.getTask('integration-test-1')?.notifiedAt).toBeDefined();
    });

    /**
     * @scenario Multiple async tasks with limit
     * @given task-max-async = 2
     * @when 3rd task launch attempted
     * @then Launch denied
     */
    it('should enforce task limits', () => {
      manager.setMaxAsyncTasks(2);

      // Launch 2 tasks (OK)
      manager.registerTask({
        id: 't1',
        subagentName: 'a1',
        goalPrompt: 'g1',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 't2',
        subagentName: 'a2',
        goalPrompt: 'g2',
        abortController: new AbortController(),
      });

      // 3rd should fail
      const canLaunch = manager.canLaunchAsync();
      expect(canLaunch.allowed).toBe(false);
      expect(canLaunch.reason).toContain('2');

      // Complete one
      manager.completeTask('t1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      // Now should allow
      expect(manager.canLaunchAsync().allowed).toBe(true);
    });

    /**
     * @scenario History limit enforcement
     * @given task-max-async = 2 (history limit = 4)
     * @when 5 tasks complete and are notified
     * @then Oldest is removed
     */
    it('should enforce history limits', () => {
      manager.setMaxAsyncTasks(2); // limit = 4

      for (let i = 0; i < 5; i++) {
        manager.registerTask({
          id: `task-${i}`,
          subagentName: 'test',
          goalPrompt: 'test',
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
    });

    /**
     * @scenario Setting change propagation
     * @given Manager with max 5 tasks
     * @when task-max-async changed to 2
     * @then Limit updated
     */
    it('should update limits when setting changes', () => {
      expect(manager.getMaxAsyncTasks()).toBe(5);

      manager.setMaxAsyncTasks(2);

      expect(manager.getMaxAsyncTasks()).toBe(2);

      // Should enforce new limit
      manager.registerTask({
        id: 't1',
        subagentName: 'a1',
        goalPrompt: 'g1',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 't2',
        subagentName: 'a2',
        goalPrompt: 'g2',
        abortController: new AbortController(),
      });

      expect(manager.canLaunchAsync().allowed).toBe(false);
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
      const deliveredMessages: string[] = [];
      const triggerAgentTurn = async (message: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10)); // Slow delivery
        deliveredMessages.push(message);
      };

      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => false,
        triggerAgentTurn,
      );
      const unsubscribe = autoTrigger.subscribe();
      unsubscribeFns.push(unsubscribe);

      // Launch 5 tasks
      for (let i = 0; i < 5; i++) {
        manager.registerTask({
          id: `rapid-${i}`,
          subagentName: 'test',
          goalPrompt: 'test',
          abortController: new AbortController(),
        });
      }

      // Complete all rapidly
      for (let i = 0; i < 5; i++) {
        manager.completeTask(`rapid-${i}`, {
          emitted_vars: {},
          terminate_reason: 'GOAL',
        });
      }

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // All should be notified (maybe in batches)
      for (let i = 0; i < 5; i++) {
        expect(manager.getTask(`rapid-${i}`)?.notifiedAt).toBeDefined();
      }
    });

    /**
     * @scenario Agent busy blocks auto-trigger
     * @given Agent is busy
     * @when Task completes
     * @then No notification while busy, but reminder is available for next turn
     */
    it('should not auto-trigger while agent is busy', async () => {
      const deliveredMessages: string[] = [];
      let isAgentBusyFlag = true;

      const triggerAgentTurn = async (message: string) => {
        deliveredMessages.push(message);
      };

      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => isAgentBusyFlag,
        triggerAgentTurn,
      );
      const unsubscribe = autoTrigger.subscribe();
      unsubscribeFns.push(unsubscribe);

      // Register and complete task while agent busy
      manager.registerTask({
        id: 'busy-test',
        subagentName: 'test',
        goalPrompt: 'test',
        abortController: new AbortController(),
      });
      manager.completeTask('busy-test', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      // Wait - should NOT deliver while busy
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(deliveredMessages.length).toBe(0);

      // Verify reminder is available (for next-turn inclusion)
      const result = reminderService.generateReminder();
      expect(result).not.toBeNull();
      expect(result!.text).toContain('busy-test');

      // When agent becomes idle and another task completes, it triggers
      isAgentBusyFlag = false;

      // Complete another task to trigger the check
      manager.registerTask({
        id: 'trigger-test',
        subagentName: 'test',
        goalPrompt: 'test',
        abortController: new AbortController(),
      });
      manager.completeTask('trigger-test', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      // Now should deliver
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(deliveredMessages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('reminder service integration', () => {
    /**
     * @scenario Reminder includes task details
     * @given Completed task with emitted vars
     * @when Reminder generated
     * @then Contains all details
     */
    it('should generate detailed reminders', () => {
      manager.registerTask({
        id: 'reminder-test',
        subagentName: 'researcher',
        goalPrompt: 'Research async patterns',
        abortController: new AbortController(),
      });

      manager.completeTask('reminder-test', {
        emitted_vars: { finding: 'important data', count: 42 },
        terminate_reason: 'GOAL',
      });

      const result = reminderService.generateReminder();

      expect(result).not.toBeNull();
      expect(result!.text).toContain('reminder-test');
      // Note: subagentName is NOT included in reminder (only agent_id, emitted_vars, etc.)
      expect(result!.text).toContain('important data');
      expect(result!.text).toContain('42');
      expect(result!.notifiedTaskIds).toEqual(['reminder-test']);
    });

    /**
     * @scenario Multiple unnotified tasks
     * @given 3 completed tasks, none notified
     * @when Reminder generated
     * @then Includes all 3
     */
    it('should include all unnotified tasks in reminder', () => {
      for (let i = 0; i < 3; i++) {
        manager.registerTask({
          id: `multi-${i}`,
          subagentName: `agent-${i}`,
          goalPrompt: `goal-${i}`,
          abortController: new AbortController(),
        });
        manager.completeTask(`multi-${i}`, {
          emitted_vars: { index: i },
          terminate_reason: 'GOAL',
        });
      }

      const result = reminderService.generateReminder();

      expect(result).not.toBeNull();
      expect(result!.text).toContain('multi-0');
      expect(result!.text).toContain('multi-1');
      expect(result!.text).toContain('multi-2');
      expect(result!.notifiedTaskIds).toEqual([
        'multi-0',
        'multi-1',
        'multi-2',
      ]);
    });

    /**
     * @scenario No unnotified tasks
     * @given All tasks notified
     * @when Reminder requested
     * @then Returns empty string
     */
    it('should return null when no unnotified tasks', () => {
      manager.registerTask({
        id: 'notified-test',
        subagentName: 'test',
        goalPrompt: 'test',
        abortController: new AbortController(),
      });
      manager.completeTask('notified-test', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });
      manager.markNotified('notified-test');

      const result = reminderService.generateReminder();

      expect(result).toBeNull();
    });
  });

  describe('auto-trigger service integration', () => {
    /**
     * @scenario Auto-trigger batches multiple completions
     * @given Multiple tasks complete quickly
     * @when Auto-trigger fires
     * @then Single notification for all
     */
    it('should batch rapid completions', async () => {
      const deliveredMessages: string[] = [];
      const triggerAgentTurn = vi.fn(async (message: string) => {
        deliveredMessages.push(message);
      });

      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => false,
        triggerAgentTurn,
      );
      const unsubscribe = autoTrigger.subscribe();
      unsubscribeFns.push(unsubscribe);

      // Complete 3 tasks rapidly
      for (let i = 0; i < 3; i++) {
        manager.registerTask({
          id: `batch-${i}`,
          subagentName: 'test',
          goalPrompt: 'test',
          abortController: new AbortController(),
        });
        manager.completeTask(`batch-${i}`, {
          emitted_vars: {},
          terminate_reason: 'GOAL',
        });
      }

      // Wait for auto-trigger
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should trigger once with all tasks
      expect(triggerAgentTurn).toHaveBeenCalled();
      expect(deliveredMessages.length).toBeGreaterThan(0);

      const lastMessage = deliveredMessages[deliveredMessages.length - 1];
      expect(lastMessage).toContain('batch-0');
      expect(lastMessage).toContain('batch-1');
      expect(lastMessage).toContain('batch-2');
    });
  });

  describe('error scenarios', () => {
    /**
     * @scenario Task completion with error
     * @given Task fails
     * @when Error recorded
     * @then Status is failed, error included in reminder
     */
    it('should handle failed tasks', async () => {
      manager.registerTask({
        id: 'error-test',
        subagentName: 'test',
        goalPrompt: 'test',
        abortController: new AbortController(),
      });

      manager.failTask('error-test', 'Something went wrong');

      const task = manager.getTask('error-test');
      expect(task?.status).toBe('failed');
      expect(task?.error).toBe('Something went wrong');

      const result = reminderService.generateReminder();
      expect(result).not.toBeNull();
      expect(result!.text).toContain('error-test');
      expect(result!.text).toContain('failed');
      expect(result!.text).toContain('Something went wrong');
      expect(result!.notifiedTaskIds).toEqual(['error-test']);
    });

    /**
     * @scenario Task cancellation
     * @given Task is running
     * @when Cancelled
     * @then Status is cancelled, can launch new task
     */
    it('should handle cancelled tasks', () => {
      const abortController = new AbortController();
      manager.registerTask({
        id: 'cancel-test',
        subagentName: 'test',
        goalPrompt: 'test',
        abortController,
      });

      // Simulate cancellation
      abortController.abort();
      manager.cancelTask('cancel-test', 'Cancelled by user');

      const task = manager.getTask('cancel-test');
      expect(task?.status).toBe('cancelled');

      // Should not count towards running limit
      expect(manager.getRunningTasks().length).toBe(0);
      expect(manager.canLaunchAsync().allowed).toBe(true);
    });
  });

  describe('cleanup and disposal', () => {
    /**
     * @scenario Unsubscribe stops auto-trigger
     * @given Auto-trigger subscribed
     * @when Unsubscribed
     * @then No more notifications
     */
    it('should stop triggering after unsubscribe', async () => {
      const deliveredMessages: string[] = [];
      const triggerAgentTurn = async (message: string) => {
        deliveredMessages.push(message);
      };

      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => false,
        triggerAgentTurn,
      );
      const unsubscribe = autoTrigger.subscribe();

      // Complete a task
      manager.registerTask({
        id: 'before-unsub',
        subagentName: 'test',
        goalPrompt: 'test',
        abortController: new AbortController(),
      });
      manager.completeTask('before-unsub', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      const beforeCount = deliveredMessages.length;

      // Unsubscribe
      unsubscribe();

      // Complete another task
      manager.registerTask({
        id: 'after-unsub',
        subagentName: 'test',
        goalPrompt: 'test',
        abortController: new AbortController(),
      });
      manager.completeTask('after-unsub', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not have new messages
      expect(deliveredMessages.length).toBe(beforeCount);
    });
  });
});
