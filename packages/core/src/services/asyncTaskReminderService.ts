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
import type { ShellNotificationSource } from './shellNotificationSource.js';
import type { ShellJob } from './shellJobTypes.js';
import { formatShellJobCompletionNotification } from './shellJobNotification.js';

export interface ReminderResult {
  text: string;
  /** IDs of all terminal work items whose content was included (subagent + shell). */
  notifiedTaskIds: string[];
}

/**
 * Generates next-turn reminders that include async task status and completion results.
 * Matches the format of TodoReminderService for consistency.
 * @pseudocode async-task-reminder-service.md
 */
export class AsyncTaskReminderService {
  private readonly taskManager: AsyncTaskManager;
  private shellSource: ShellNotificationSource | undefined;

  constructor(taskManager: AsyncTaskManager) {
    this.taskManager = taskManager;
  }

  /**
   * Attach (or replace) the shell job notification source. When set, shell job
   * completions are surfaced alongside subagent completions (#1995 slice 7).
   */
  setShellNotificationSource(
    source: ShellNotificationSource | undefined,
  ): void {
    this.shellSource = source;
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
    const shellJobs = this.collectRunningShellJobs();

    if (tasks.length === 0 && shellJobs.length === 0) {
      return '';
    }

    const lines: string[] = [];
    const total = tasks.length + shellJobs.length;
    lines.push(`[ASYNC TASKS: ${total} total]`);

    tasks.forEach((task, i) => {
      const statusIcon = this.getStatusIcon(task.status);
      const idPrefix = task.id.substring(0, 8);
      lines.push(
        `[${i + 1}] ${task.subagentName} - ${statusIcon} (${idPrefix}...)`,
      );
    });

    shellJobs.forEach((job, i) => {
      const statusIcon = this.getStatusIcon(job.state);
      const idPrefix = job.id.substring(0, 8);
      const cmdPreview =
        job.command.length > 30
          ? job.command.substring(0, 30) + '...'
          : job.command;
      lines.push(
        `[${tasks.length + i + 1}] shell: ${cmdPreview} - ${statusIcon} (${idPrefix}...)`,
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
  generateReminder(): ReminderResult | null {
    const pending = this.taskManager.getPendingNotifications();
    const running = this.taskManager.getRunningTasks();
    const shellPending = this.collectPendingShellJobs();
    const shellRunning = this.collectRunningShellJobs();

    const totalPending = pending.length + shellPending.length;
    const totalRunning = running.length + shellRunning.length;

    if (totalPending === 0 && totalRunning === 0) {
      return null;
    }

    const parts: string[] = [];
    const notifiedTaskIds: string[] = [];

    if (totalPending > 0) {
      const labels: string[] = [];
      if (pending.length > 0) {
        labels.push(`${pending.length} async task(s)`);
      }
      if (shellPending.length > 0) {
        labels.push(`${shellPending.length} shell job(s)`);
      }
      parts.push(`${labels.join(' + ')} completed:`);

      for (const task of pending) {
        parts.push(this.formatCompletionNotification(task));
        notifiedTaskIds.push(task.id);
      }
      for (const job of shellPending) {
        const tail = this.readShellTail(job.id);
        parts.push(formatShellJobCompletionNotification(job, tail));
        notifiedTaskIds.push(job.id);
      }
    }

    if (totalRunning > 0) {
      const labels: string[] = [];
      if (running.length > 0) {
        labels.push(`${running.length} async task(s)`);
      }
      if (shellRunning.length > 0) {
        labels.push(`${shellRunning.length} shell job(s)`);
      }
      parts.push(`${labels.join(' + ')} still running.`);
    }

    // Format MUST match the synchronous reminder service exactly
    // See the synchronous reminder service formatting.
    const text = `---\nSystem Note: Async Task Status\n\n${parts.join('\n\n')}\n---`;
    return { text, notifiedTaskIds };
  }

  private collectPendingShellJobs(): readonly ShellJob[] {
    if (this.shellSource === undefined) {
      return [];
    }
    return this.shellSource.getPendingNotifications();
  }

  private collectRunningShellJobs(): readonly ShellJob[] {
    if (this.shellSource === undefined) {
      return [];
    }
    return this.shellSource.getRunningJobs();
  }

  private readShellTail(id: string): {
    id: string;
    output: string;
    truncated: boolean;
  } {
    if (this.shellSource === undefined) {
      return { id, output: '', truncated: false };
    }
    return this.shellSource.tailOutput(id);
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
        emitted_vars: task.output.emitted_vars,
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
    if (this.taskManager.getPendingNotifications().length > 0) {
      return true;
    }
    return this.collectPendingShellJobs().length > 0;
  }

  /**
   * Marks specific tasks as notified.
   * Pass the IDs returned by generateReminder() so only the tasks whose
   * content was actually delivered get marked — avoids a TOCTOU race with
   * tasks that complete between generation and delivery.
   * @pseudocode lines 120-127
   */
  markNotified(taskIds: string[]): void {
    const subagentIds: string[] = [];
    const shellIds: string[] = [];
    for (const id of taskIds) {
      if (id.startsWith('shell_')) {
        shellIds.push(id);
      } else {
        subagentIds.push(id);
      }
    }

    for (const id of subagentIds) {
      this.taskManager.markNotified(id);
    }

    if (this.shellSource !== undefined && shellIds.length > 0) {
      this.shellSource.markNotified(shellIds);
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
