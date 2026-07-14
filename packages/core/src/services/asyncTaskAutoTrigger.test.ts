/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P19
 * @requirement REQ-ASYNC-010, REQ-ASYNC-011
 */

import { describe, it, expect, vi } from 'vitest';
import { AsyncTaskManager } from './asyncTaskManager.js';
import { AsyncTaskReminderService } from './asyncTaskReminderService.js';
import { AsyncTaskAutoTrigger } from './asyncTaskAutoTrigger.js';

describe('AsyncTaskAutoTrigger', () => {
  describe('trigger conditions', () => {
    /**
     * @requirement REQ-ASYNC-010
     * @scenario Agent idle when task completes
     * @given Agent is not busy (isAgentBusy returns false)
     * @when Async task completes
     * @then triggerAgentTurn is called with completion notification
     */
    it('should auto-trigger when agent is idle', async () => {
      const triggerAgentTurn = vi.fn().mockResolvedValue(undefined);
      const manager = new AsyncTaskManager(5);
      const reminderService = new AsyncTaskReminderService(manager);

      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => false, // Agent not busy
        triggerAgentTurn,
      );
      autoTrigger.subscribe();

      manager.registerTask({
        id: 'task-1',
        subagentName: 'researcher',
        goalPrompt: 'Research',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: { key: 'value' },
        terminate_reason: 'GOAL',
      });

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(triggerAgentTurn).toHaveBeenCalled();
      expect(triggerAgentTurn.mock.calls[0][0]).toContain('task-1');
    });

    /**
     * @requirement REQ-ASYNC-010
     * @scenario Agent busy when task completes
     * @given Agent is currently responding (isAgentBusy returns true)
     * @when Async task completes
     * @then triggerAgentTurn is NOT called immediately
     */
    it('should NOT auto-trigger when agent is busy', async () => {
      const triggerAgentTurn = vi.fn().mockResolvedValue(undefined);
      const manager = new AsyncTaskManager(5);
      const reminderService = new AsyncTaskReminderService(manager);

      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => true, // Agent IS busy
        triggerAgentTurn,
      );
      autoTrigger.subscribe();

      manager.registerTask({
        id: 'task-1',
        subagentName: 'researcher',
        goalPrompt: 'Research',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(triggerAgentTurn).not.toHaveBeenCalled();
    });

    /**
     * @requirement REQ-ASYNC-010
     * @scenario Task failure triggers same as completion
     * @given Agent is idle
     * @when Async task fails
     * @then triggerAgentTurn is called with failure notification
     */
    it('should auto-trigger on task failure', async () => {
      const triggerAgentTurn = vi.fn().mockResolvedValue(undefined);
      const manager = new AsyncTaskManager(5);
      const reminderService = new AsyncTaskReminderService(manager);

      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => false,
        triggerAgentTurn,
      );
      autoTrigger.subscribe();

      manager.registerTask({
        id: 'task-1',
        subagentName: 'researcher',
        goalPrompt: 'Research',
        abortController: new AbortController(),
      });
      manager.failTask('task-1', 'Network error');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(triggerAgentTurn).toHaveBeenCalled();
      expect(triggerAgentTurn.mock.calls[0][0]).toContain('failed');
    });
  });

  describe('serialization', () => {
    /**
     * @requirement REQ-ASYNC-010
     * @scenario Multiple completions coalesced
     * @given 2 tasks complete in rapid succession while agent idle
     * @when Both emit completion events
     * @then Only one triggerAgentTurn call (coalesced)
     */
    it('should serialize triggers - only one in flight', async () => {
      const triggerAgentTurn = vi.fn().mockImplementation(async () => {
        // Simulate slow turn
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      const manager = new AsyncTaskManager(5);
      const reminderService = new AsyncTaskReminderService(manager);

      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => false,
        triggerAgentTurn,
      );
      autoTrigger.subscribe();

      manager.registerTask({
        id: 'task-1',
        subagentName: 'r1',
        goalPrompt: 'R1',
        abortController: new AbortController(),
      });
      manager.registerTask({
        id: 'task-2',
        subagentName: 'r2',
        goalPrompt: 'R2',
        abortController: new AbortController(),
      });

      // Complete both rapidly
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });
      manager.completeTask('task-2', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should only have triggered once (coalesced because isTriggering was true)
      expect(triggerAgentTurn).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifiedAt timing', () => {
    /**
     * @requirement REQ-ASYNC-011
     * @scenario notifiedAt set after delivery
     * @given Task completes and auto-trigger succeeds
     * @when triggerAgentTurn resolves
     * @then notifiedAt is set on the task
     */
    it('should mark notifiedAt AFTER successful delivery', async () => {
      const triggerAgentTurn = vi.fn().mockResolvedValue(undefined);
      const manager = new AsyncTaskManager(5);
      const reminderService = new AsyncTaskReminderService(manager);

      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => false,
        triggerAgentTurn,
      );
      autoTrigger.subscribe();

      manager.registerTask({
        id: 'task-1',
        subagentName: 'researcher',
        goalPrompt: 'Research',
        abortController: new AbortController(),
      });

      // Before completion
      expect(manager.getTask('task-1')?.notifiedAt).toBeUndefined();

      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // After delivery
      expect(manager.getTask('task-1')?.notifiedAt).toBeDefined();
    });

    /**
     * @requirement REQ-ASYNC-011
     * @scenario notifiedAt NOT set if delivery fails
     * @given triggerAgentTurn throws error
     * @when Auto-trigger attempts delivery
     * @then notifiedAt is NOT set
     */
    it('should NOT mark notifiedAt if delivery fails', async () => {
      const triggerAgentTurn = vi
        .fn()
        .mockRejectedValue(new Error('Delivery failed'));
      const manager = new AsyncTaskManager(5);
      const reminderService = new AsyncTaskReminderService(manager);

      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => false,
        triggerAgentTurn,
      );
      autoTrigger.subscribe();

      manager.registerTask({
        id: 'task-1',
        subagentName: 'researcher',
        goalPrompt: 'Research',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should NOT be marked as notified
      expect(manager.getTask('task-1')?.notifiedAt).toBeUndefined();
    });
  });

  describe('updateCallbacks', () => {
    /**
     * @requirement REQ-ASYNC-010
     * @scenario Callbacks refreshed after React re-render
     * @given AutoTrigger created with isAgentBusy returning true (busy)
     * @when updateCallbacks replaces with isAgentBusy returning false (idle)
     * @then Next task completion uses the updated callback and triggers
     */
    it('should use updated isAgentBusy after updateCallbacks', async () => {
      const triggerAgentTurn = vi.fn().mockResolvedValue(undefined);
      const manager = new AsyncTaskManager(5);
      const reminderService = new AsyncTaskReminderService(manager);

      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => true, // Initially busy — won't trigger
        triggerAgentTurn,
      );
      autoTrigger.subscribe();

      // Complete a task while busy — should NOT trigger
      manager.registerTask({
        id: 'task-1',
        subagentName: 'r1',
        goalPrompt: 'R1',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(triggerAgentTurn).not.toHaveBeenCalled();

      // Mark notified manually so it doesn't interfere
      manager.markNotified('task-1');

      // Update callback to not busy
      autoTrigger.updateCallbacks(() => false, triggerAgentTurn);

      // Complete another task — should NOW trigger
      manager.registerTask({
        id: 'task-2',
        subagentName: 'r2',
        goalPrompt: 'R2',
        abortController: new AbortController(),
      });
      manager.completeTask('task-2', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(triggerAgentTurn).toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    /**
     * @requirement REQ-ASYNC-010
     * @scenario Unsubscribe stops auto-trigger
     * @given AutoTrigger is subscribed
     * @when unsubscribe called, then task completes
     * @then No trigger
     */
    it('should stop triggering after unsubscribe', async () => {
      const triggerAgentTurn = vi.fn().mockResolvedValue(undefined);
      const manager = new AsyncTaskManager(5);
      const reminderService = new AsyncTaskReminderService(manager);

      const autoTrigger = new AsyncTaskAutoTrigger(
        manager,
        reminderService,
        () => false,
        triggerAgentTurn,
      );
      const unsubscribe = autoTrigger.subscribe();

      // Unsubscribe before task completes
      unsubscribe();

      manager.registerTask({
        id: 'task-1',
        subagentName: 'researcher',
        goalPrompt: 'Research',
        abortController: new AbortController(),
      });
      manager.completeTask('task-1', {
        emitted_vars: {},
        terminate_reason: 'GOAL',
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(triggerAgentTurn).not.toHaveBeenCalled();
    });
  });
});
