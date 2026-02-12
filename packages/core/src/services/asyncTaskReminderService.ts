/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P08
 * @requirement REQ-ASYNC-003, REQ-ASYNC-004
 */

import type { AsyncTaskManager, AsyncTaskInfo } from './asyncTaskManager.js';

/**
 * Generates next-turn reminders that include async task status and completion results.
 * Matches the format of TodoReminderService for consistency.
 * @pseudocode async-task-reminder-service.md
 */
export class AsyncTaskReminderService {
  private readonly taskManager: AsyncTaskManager;

  constructor(taskManager: AsyncTaskManager) {
    this.taskManager = taskManager;
  }

  /**
   * Generates status summary for inclusion in system instruction.
   * Format:
   * [ASYNC TASKS: X total]
   * [1] subagentName - [STATUS] (idPrefix...)
   * @pseudocode lines 012-038
   */
  generateStatusSummary(): string {
    const tasks = this.taskManager.getAllTasks();

    if (tasks.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push(`[ASYNC TASKS: ${tasks.length} total]`);

    tasks.forEach((task, i) => {
      const statusIcon = this.getStatusIcon(task.status);
      const idPrefix = task.id.substring(0, 8);
      lines.push(
        `[${i + 1}] ${task.subagentName} - ${statusIcon} (${idPrefix}...)`,
      );
    });

    return lines.join('\n');
  }

  /**
   * Generates a reminder string for the next turn.
   * Returns null if no async tasks need reporting.
   * The returned object includes the task IDs that were included in the
   * reminder so that only those specific tasks are marked as notified,
   * avoiding a TOCTOU race where a task completing between generation
   * and marking would be silently skipped.
   * @pseudocode lines 044-071
   */
  generateReminder(): { text: string; notifiedTaskIds: string[] } | null {
    const pending = this.taskManager.getPendingNotifications();
    const running = this.taskManager.getRunningTasks();

    if (pending.length === 0 && running.length === 0) {
      return null;
    }

    const parts: string[] = [];
    const notifiedTaskIds: string[] = [];

    // Pending completions - include full output
    if (pending.length > 0) {
      parts.push(`${pending.length} async task(s) completed:`);
      for (const task of pending) {
        parts.push(this.formatCompletionNotification(task));
        notifiedTaskIds.push(task.id);
      }
    }

    // Running tasks - just summary
    if (running.length > 0) {
      parts.push(`${running.length} async task(s) still running.`);
    }

    // Format MUST match TodoReminderService exactly
    // See: packages/core/src/services/todo-reminder-service.ts line 98-100
    const text = `---\nSystem Note: Async Task Status\n\n${parts.join('\n\n')}\n---`;
    return { text, notifiedTaskIds };
  }

  /**
   * Formats a completion notification matching sync task output format.
   * @param task The completed task
   * @returns Formatted string like sync task.ts formatSuccessContent/formatSuccessDisplay
   * @pseudocode lines 077-110
   */
  formatCompletionNotification(task: AsyncTaskInfo): string {
    if (task.status === 'completed' && task.output) {
      // Match sync task format exactly
      const payload: Record<string, unknown> = {
        agent_id: task.id,
        terminate_reason: task.output.terminate_reason,
        emitted_vars: task.output.emitted_vars ?? {},
      };

      if (task.output.final_message !== undefined) {
        payload.final_message = task.output.final_message;
      }

      return JSON.stringify(payload, null, 2);
    } else if (task.status === 'failed') {
      return JSON.stringify(
        {
          agent_id: task.id,
          status: 'failed',
          error: task.error,
        },
        null,
        2,
      );
    } else if (task.status === 'cancelled') {
      return JSON.stringify(
        {
          agent_id: task.id,
          status: 'cancelled',
        },
        null,
        2,
      );
    }

    return '';
  }

  /**
   * Checks if there are any pending notifications.
   * @pseudocode lines 116-118
   */
  hasPendingNotifications(): boolean {
    return this.taskManager.getPendingNotifications().length > 0;
  }

  /**
   * Marks specific tasks as notified.
   * Pass the IDs returned by generateReminder() so only the tasks whose
   * content was actually delivered get marked — avoids a TOCTOU race with
   * tasks that complete between generation and delivery.
   * @pseudocode lines 120-127
   */
  markNotified(taskIds: string[]): void {
    for (const id of taskIds) {
      this.taskManager.markNotified(id);
    }
  }

  /**
   * Gets status icon for display
   */
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'running':
        return '[RUNNING]';
      case 'completed':
        return '[DONE]';
      case 'failed':
        return '[FAILED]';
      case 'cancelled':
        return '[CANCELLED]';
      default:
        return '[UNKNOWN]';
    }
  }
}
