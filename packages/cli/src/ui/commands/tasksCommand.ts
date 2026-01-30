/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P15
 * @plan PLAN-20260130-ASYNCTASK.P17
 * @requirement REQ-ASYNC-006, REQ-ASYNC-007
 */

import type { SlashCommand, CommandContext } from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';
import type { AsyncTaskInfo } from '@vybestack/llxprt-code-core';

/**
 * Format duration for display
 */
function formatDuration(startTime: number, endTime?: number): string {
  const end = endTime ?? Date.now();
  const durationMs = end - startTime;
  const seconds = Math.floor(durationMs / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format task for display
 */
function formatTask(task: AsyncTaskInfo): string {
  const statusIcon =
    task.status === 'running'
      ? '[RUNNING]'
      : task.status === 'completed'
        ? '[DONE]'
        : task.status === 'failed'
          ? '[FAILED]'
          : '[CANCELLED]';

  const idPrefix = task.id.substring(0, 8);
  const duration = formatDuration(task.launchedAt, task.completedAt);
  const goalPreview =
    task.goalPrompt.length > 40
      ? task.goalPrompt.substring(0, 40) + '...'
      : task.goalPrompt;

  return `${statusIcon} ${idPrefix}  ${task.subagentName}  ${duration}\n   Goal: ${goalPreview}`;
}

/**
 * Get running task IDs for autocomplete
 */
function getRunningTaskIds(context: CommandContext): string[] {
  const asyncTaskManager = context.services.config?.getAsyncTaskManager?.();
  if (!asyncTaskManager) {
    return [];
  }

  return asyncTaskManager
    .getAllTasks()
    .filter((t) => t.status === 'running')
    .map((t) => t.id.substring(0, 8));
}

/**
 * /task command - Manage async background tasks
 * Subcommands:
 *   /task list - List all async tasks
 *   /task end <id> - Cancel a running async task
 *
 * @plan PLAN-20260130-ASYNCTASK.P15
 * @plan PLAN-20260130-ASYNCTASK.P17
 * @requirement REQ-ASYNC-006, REQ-ASYNC-007
 */
export const taskCommand: SlashCommand = {
  name: 'task',
  description: 'Manage async background tasks',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    {
      name: 'list',
      description: 'List all async background tasks',
      kind: CommandKind.BUILT_IN,
      action: (context: CommandContext) => {
        const asyncTaskManager =
          context.services.config?.getAsyncTaskManager?.();
        if (!asyncTaskManager) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'AsyncTaskManager not available',
            },
            Date.now(),
          );
          return;
        }

        const tasks = asyncTaskManager.getAllTasks();

        if (tasks.length === 0) {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: 'No async tasks.',
            },
            Date.now(),
          );
          return;
        }

        const lines: string[] = ['Async Tasks:', ''];

        for (const task of tasks) {
          lines.push(formatTask(task));
          lines.push('');
        }

        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: lines.join('\n'),
          },
          Date.now(),
        );
      },
    },
    {
      name: 'end',
      description: 'Cancel a running async task',
      kind: CommandKind.BUILT_IN,
      completion: async (
        context: CommandContext,
        partialArg: string,
      ): Promise<string[]> => {
        const taskIds = getRunningTaskIds(context);
        if (!partialArg) {
          return taskIds;
        }
        return taskIds.filter((id) =>
          id.toLowerCase().startsWith(partialArg.toLowerCase()),
        );
      },
      action: (context: CommandContext, args: string) => {
        const taskId = args.trim();

        if (!taskId) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'Usage: /task end <task_id>',
            },
            Date.now(),
          );
          return;
        }

        const asyncTaskManager =
          context.services.config?.getAsyncTaskManager?.();
        if (!asyncTaskManager) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'AsyncTaskManager not available',
            },
            Date.now(),
          );
          return;
        }

        // Try exact match first
        let task = asyncTaskManager.getTask(taskId);

        if (!task) {
          // Try prefix match
          const result = asyncTaskManager.getTaskByPrefix(taskId);

          if (result.task) {
            task = result.task;
          } else if (result.candidates && result.candidates.length > 0) {
            // Ambiguous
            const candidateList = result.candidates
              .map((c) => `  ${c.id.substring(0, 8)}  ${c.subagentName}`)
              .join('\n');

            context.ui.addItem(
              {
                type: MessageType.ERROR,
                text: `Ambiguous task ID. Did you mean:\n${candidateList}`,
              },
              Date.now(),
            );
            return;
          } else {
            context.ui.addItem(
              {
                type: MessageType.ERROR,
                text: `Task not found: ${taskId}`,
              },
              Date.now(),
            );
            return;
          }
        }

        // Check if already terminal
        if (task.status !== 'running') {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Task ${task.id.substring(0, 8)} is already ${task.status}.`,
            },
            Date.now(),
          );
          return;
        }

        // Cancel the task
        const cancelled = asyncTaskManager.cancelTask(task.id);

        if (cancelled) {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Cancelled task: ${task.subagentName} (${task.id.substring(0, 8)})`,
            },
            Date.now(),
          );
        } else {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Failed to cancel task ${task.id.substring(0, 8)}. It may have already completed.`,
            },
            Date.now(),
          );
        }
      },
    },
  ],
};

// Export as array for compatibility with BuiltinCommandLoader
export const tasksCommands: SlashCommand[] = [taskCommand];
