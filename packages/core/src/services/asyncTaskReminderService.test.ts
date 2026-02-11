/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P07
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AsyncTaskManager } from './asyncTaskManager.js';
import { AsyncTaskReminderService } from './asyncTaskReminderService.js';
import type { OutputObject } from '../core/subagent.js';

describe('AsyncTaskReminderService', () => {
  let taskManager: AsyncTaskManager;
  let reminderService: AsyncTaskReminderService;

  beforeEach(() => {
    taskManager = new AsyncTaskManager();
    reminderService = new AsyncTaskReminderService(taskManager);
  });

  describe('generateStatusSummary', () => {
    it('returns empty string when no tasks exist', () => {
      const summary = reminderService.generateStatusSummary();
      expect(summary).toBe('');
    });

    it('returns formatted summary with task count and list', () => {
      // Register multiple tasks with different statuses
      taskManager.registerTask({
        id: 'task-abc123-def456',
        subagentName: 'analyzer',
        goalPrompt: 'Analyze code',
        abortController: new AbortController(),
      });

      const task2 = taskManager.registerTask({
        id: 'task-xyz789-uvw012',
        subagentName: 'reviewer',
        goalPrompt: 'Review changes',
        abortController: new AbortController(),
      });

      // Complete one task
      taskManager.completeTask(task2.id, {
        terminate_reason: 'success',
        emitted_vars: {},
      });

      const summary = reminderService.generateStatusSummary();

      // Verify format matches: [ASYNC TASKS: X total]
      // [1] name - [STATUS] (idPrefix...)
      expect(summary).toContain('[ASYNC TASKS: 2 total]');
      expect(summary).toContain('[1] analyzer - [RUNNING] (task-abc');
      expect(summary).toContain('[2] reviewer - [DONE] (task-xyz');
    });

    it('shows correct status icons for all task states', () => {
      taskManager.registerTask({
        id: 'task-running-001',
        subagentName: 'runner',
        goalPrompt: 'Run task',
        abortController: new AbortController(),
      });

      const task2 = taskManager.registerTask({
        id: 'task-completed-002',
        subagentName: 'completer',
        goalPrompt: 'Complete task',
        abortController: new AbortController(),
      });

      const task3 = taskManager.registerTask({
        id: 'task-failed-003',
        subagentName: 'failer',
        goalPrompt: 'Fail task',
        abortController: new AbortController(),
      });

      const task4 = taskManager.registerTask({
        id: 'task-cancelled-004',
        subagentName: 'canceller',
        goalPrompt: 'Cancel task',
        abortController: new AbortController(),
      });

      taskManager.completeTask(task2.id, {
        terminate_reason: 'success',
        emitted_vars: {},
      });
      taskManager.failTask(task3.id, 'Error occurred');
      taskManager.cancelTask(task4.id);

      const summary = reminderService.generateStatusSummary();

      expect(summary).toContain('[RUNNING]');
      expect(summary).toContain('[DONE]');
      expect(summary).toContain('[FAILED]');
      expect(summary).toContain('[CANCELLED]');
    });
  });

  describe('generateReminder', () => {
    it('returns null when no pending notifications and no running tasks', () => {
      const result = reminderService.generateReminder();
      expect(result).toBeNull();
    });

    it('returns formatted reminder with pending completions and their IDs', () => {
      const task = taskManager.registerTask({
        id: 'task-complete-001',
        subagentName: 'worker',
        goalPrompt: 'Do work',
        abortController: new AbortController(),
      });

      const output: OutputObject = {
        terminate_reason: 'success',
        emitted_vars: { result: 'done' },
        final_message: 'Task completed successfully',
      };

      taskManager.completeTask(task.id, output);

      const result = reminderService.generateReminder();
      expect(result).not.toBeNull();

      // Verify format matches TodoReminderService
      expect(result!.text).toMatch(
        /^---\nSystem Note: Async Task Status\n\n[\s\S]*\n---$/,
      );
      expect(result!.text).toContain('1 async task(s) completed:');
      expect(result!.text).toContain('"agent_id"');
      expect(result!.text).toContain('"terminate_reason": "success"');

      // Verify the returned IDs match the tasks included
      expect(result!.notifiedTaskIds).toEqual(['task-complete-001']);
    });

    it('includes running tasks summary in reminder', () => {
      taskManager.registerTask({
        id: 'task-running-001',
        subagentName: 'worker1',
        goalPrompt: 'Work 1',
        abortController: new AbortController(),
      });

      taskManager.registerTask({
        id: 'task-running-002',
        subagentName: 'worker2',
        goalPrompt: 'Work 2',
        abortController: new AbortController(),
      });

      const result = reminderService.generateReminder();
      expect(result).not.toBeNull();
      expect(result!.text).toContain('2 async task(s) still running.');
      // No completed tasks, so no IDs to notify
      expect(result!.notifiedTaskIds).toEqual([]);
    });

    it('includes both pending completions and running tasks', () => {
      const task1 = taskManager.registerTask({
        id: 'task-complete-001',
        subagentName: 'completer',
        goalPrompt: 'Complete',
        abortController: new AbortController(),
      });

      taskManager.registerTask({
        id: 'task-running-001',
        subagentName: 'runner',
        goalPrompt: 'Run',
        abortController: new AbortController(),
      });

      taskManager.completeTask(task1.id, {
        terminate_reason: 'success',
        emitted_vars: {},
      });

      const result = reminderService.generateReminder();
      expect(result).not.toBeNull();
      expect(result!.text).toContain('1 async task(s) completed:');
      expect(result!.text).toContain('1 async task(s) still running.');
      expect(result!.notifiedTaskIds).toEqual(['task-complete-001']);
    });

    it('only includes completed/failed task IDs, not running ones', () => {
      const task1 = taskManager.registerTask({
        id: 'task-a',
        subagentName: 'a',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      const task2 = taskManager.registerTask({
        id: 'task-b',
        subagentName: 'b',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });
      taskManager.registerTask({
        id: 'task-c',
        subagentName: 'c',
        goalPrompt: 'goal',
        abortController: new AbortController(),
      });

      taskManager.completeTask(task1.id, {
        terminate_reason: 'success',
        emitted_vars: {},
      });
      taskManager.failTask(task2.id, 'oops');

      const result = reminderService.generateReminder();
      expect(result).not.toBeNull();
      expect(result!.notifiedTaskIds).toEqual(['task-a', 'task-b']);
    });
  });

  describe('formatCompletionNotification', () => {
    it('formats completed tasks matching sync task format', () => {
      const task = taskManager.registerTask({
        id: 'task-sync-format-001',
        subagentName: 'formatter',
        goalPrompt: 'Format output',
        abortController: new AbortController(),
      });

      const output: OutputObject = {
        terminate_reason: 'success',
        emitted_vars: { key1: 'value1', key2: 'value2' },
        final_message: 'All done',
      };

      taskManager.completeTask(task.id, output);

      const notification = reminderService.formatCompletionNotification(
        taskManager.getTask(task.id)!,
      );

      // Verify JSON structure matches task.ts formatSuccessContent
      const parsed = JSON.parse(notification);
      expect(parsed).toHaveProperty('agent_id', task.id);
      expect(parsed).toHaveProperty('terminate_reason', 'success');
      expect(parsed).toHaveProperty('emitted_vars');
      expect(parsed.emitted_vars).toEqual({ key1: 'value1', key2: 'value2' });
      expect(parsed).toHaveProperty('final_message', 'All done');
    });

    it('formats completed tasks without final_message', () => {
      const task = taskManager.registerTask({
        id: 'task-no-message-001',
        subagentName: 'silent',
        goalPrompt: 'Silent work',
        abortController: new AbortController(),
      });

      taskManager.completeTask(task.id, {
        terminate_reason: 'success',
        emitted_vars: {},
      });

      const notification = reminderService.formatCompletionNotification(
        taskManager.getTask(task.id)!,
      );

      const parsed = JSON.parse(notification);
      expect(parsed).toHaveProperty('agent_id');
      expect(parsed).toHaveProperty('terminate_reason', 'success');
      expect(parsed).toHaveProperty('emitted_vars');
      expect(parsed).not.toHaveProperty('final_message');
    });

    it('formats failed tasks with error', () => {
      const task = taskManager.registerTask({
        id: 'task-failed-001',
        subagentName: 'failer',
        goalPrompt: 'Fail',
        abortController: new AbortController(),
      });

      taskManager.failTask(task.id, 'Something went wrong');

      const notification = reminderService.formatCompletionNotification(
        taskManager.getTask(task.id)!,
      );

      const parsed = JSON.parse(notification);
      expect(parsed).toHaveProperty('agent_id', task.id);
      expect(parsed).toHaveProperty('status', 'failed');
      expect(parsed).toHaveProperty('error', 'Something went wrong');
    });

    it('formats cancelled tasks', () => {
      const task = taskManager.registerTask({
        id: 'task-cancelled-001',
        subagentName: 'canceller',
        goalPrompt: 'Cancel',
        abortController: new AbortController(),
      });

      taskManager.cancelTask(task.id);

      const notification = reminderService.formatCompletionNotification(
        taskManager.getTask(task.id)!,
      );

      const parsed = JSON.parse(notification);
      expect(parsed).toHaveProperty('agent_id', task.id);
      expect(parsed).toHaveProperty('status', 'cancelled');
    });

    it('returns empty string for running tasks', () => {
      const task = taskManager.registerTask({
        id: 'task-running-001',
        subagentName: 'runner',
        goalPrompt: 'Keep running',
        abortController: new AbortController(),
      });

      const notification = reminderService.formatCompletionNotification(
        taskManager.getTask(task.id)!,
      );

      expect(notification).toBe('');
    });
  });

  describe('hasPendingNotifications', () => {
    it('returns false when no pending notifications', () => {
      expect(reminderService.hasPendingNotifications()).toBe(false);
    });

    it('returns true when pending notifications exist', () => {
      const task = taskManager.registerTask({
        id: 'task-pending-001',
        subagentName: 'pender',
        goalPrompt: 'Pend',
        abortController: new AbortController(),
      });

      taskManager.completeTask(task.id, {
        terminate_reason: 'success',
        emitted_vars: {},
      });

      expect(reminderService.hasPendingNotifications()).toBe(true);
    });

    it('returns false after notifications are marked notified', () => {
      const task = taskManager.registerTask({
        id: 'task-notified-001',
        subagentName: 'notifier',
        goalPrompt: 'Notify',
        abortController: new AbortController(),
      });

      taskManager.completeTask(task.id, {
        terminate_reason: 'success',
        emitted_vars: {},
      });

      expect(reminderService.hasPendingNotifications()).toBe(true);

      reminderService.markNotified([task.id]);

      expect(reminderService.hasPendingNotifications()).toBe(false);
    });
  });

  describe('markNotified', () => {
    it('marks only the specified task IDs as notified', () => {
      const task1 = taskManager.registerTask({
        id: 'task-mark-001',
        subagentName: 'marker1',
        goalPrompt: 'Mark 1',
        abortController: new AbortController(),
      });

      const task2 = taskManager.registerTask({
        id: 'task-mark-002',
        subagentName: 'marker2',
        goalPrompt: 'Mark 2',
        abortController: new AbortController(),
      });

      taskManager.completeTask(task1.id, {
        terminate_reason: 'success',
        emitted_vars: {},
      });

      taskManager.completeTask(task2.id, {
        terminate_reason: 'success',
        emitted_vars: {},
      });

      // Verify both are pending
      expect(taskManager.getPendingNotifications()).toHaveLength(2);

      // Mark only task1
      reminderService.markNotified([task1.id]);

      // Only task1 is notified; task2 remains pending
      expect(taskManager.getPendingNotifications()).toHaveLength(1);
      expect(taskManager.getTask(task1.id)?.notifiedAt).toBeDefined();
      expect(taskManager.getTask(task2.id)?.notifiedAt).toBeUndefined();

      // Mark task2
      reminderService.markNotified([task2.id]);
      expect(taskManager.getPendingNotifications()).toHaveLength(0);
      expect(taskManager.getTask(task2.id)?.notifiedAt).toBeDefined();
    });

    it('does nothing for empty array', () => {
      // Should not throw
      reminderService.markNotified([]);
      expect(taskManager.getPendingNotifications()).toHaveLength(0);
    });

    it('ignores unknown IDs gracefully', () => {
      // Should not throw
      reminderService.markNotified(['nonexistent-id']);
      expect(taskManager.getPendingNotifications()).toHaveLength(0);
    });
  });
});
