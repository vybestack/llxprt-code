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

import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import { MessageType, type HistoryItemWithoutId } from '../types.js';
import type {
  AgentTaskInfo,
  AgentSubagentTaskInfo,
  AgentShellJobInfo,
} from '@vybestack/llxprt-code-agents';

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

const STATUS_ICONS: Record<string, string> = {
  running: '[RUNNING]',
  completed: '[DONE]',
  failed: '[FAILED]',
};

function statusIcon(status: string): string {
  return STATUS_ICONS[status] ?? '[CANCELLED]';
}

function formatSubagentTask(task: AgentSubagentTaskInfo): string {
  const icon = statusIcon(task.status);
  const duration = formatDuration(task.launchedAt, task.completedAt);
  const goalPreview =
    task.goalPrompt.length > 40
      ? task.goalPrompt.substring(0, 40) + '...'
      : task.goalPrompt;
  return `${icon} ${task.id}  ${duration}\n   Goal: ${goalPreview}`;
}

function formatShellJob(job: AgentShellJobInfo): string {
  const icon = statusIcon(job.status);
  const duration = formatDuration(job.launchedAt, job.completedAt);
  const cmdPreview =
    job.command.length > 60
      ? job.command.substring(0, 60) + '...'
      : job.command;
  const exitInfo = formatExitInfo(job);
  return `${icon} ${job.id}  ${duration}\n   Command: ${cmdPreview}${exitInfo}`;
}

function formatExitInfo(job: AgentShellJobInfo): string {
  if (job.status === 'running') return '';
  if (job.failureReason !== undefined) {
    return `\n   Failure: ${job.failureReason}`;
  }
  if (job.signal !== undefined) {
    return `\n   Signal: ${job.signal}`;
  }
  if (job.exitCode !== undefined) {
    return `\n   Exit: ${job.exitCode}`;
  }
  return '';
}

function formatTask(task: AgentTaskInfo): string {
  if (task.kind === 'subagent') {
    return formatSubagentTask(task);
  }
  return formatShellJob(task);
}

export interface TaskCommandOperations {
  readonly list: () => readonly AgentTaskInfo[];
  readonly listRunning: () => readonly AgentTaskInfo[];
  readonly get: (id: string) => AgentTaskInfo | undefined;
  readonly cancel: (id: string) => Promise<boolean>;
}

type AddTaskItem = (item: HistoryItemWithoutId, timestamp?: number) => void;

function listTasks(
  operations: TaskCommandOperations | null,
  addItem: AddTaskItem,
): void {
  if (operations === null) {
    addItem(
      { type: MessageType.ERROR, text: 'Agent tasks not available' },
      Date.now(),
    );
    return;
  }
  const tasks = operations.list();
  if (tasks.length === 0) {
    addItem({ type: MessageType.INFO, text: 'No async tasks.' }, Date.now());
    return;
  }
  const lines = ['Async Tasks:', ''];
  for (const task of tasks) lines.push(formatTask(task), '');
  addItem({ type: MessageType.INFO, text: lines.join('\n') }, Date.now());
}

async function cancelTask(
  operations: TaskCommandOperations,
  addItem: AddTaskItem,
  taskId: string,
): Promise<void> {
  let task = operations.get(taskId);
  if (task === undefined) {
    const matches = operations
      .list()
      .filter((entry) => entry.id.startsWith(taskId));
    if (matches.length === 1) task = matches[0];
    else if (matches.length > 1) {
      const candidates = matches.map((entry) => `  ${entry.id}`).join('\n');
      addItem(
        {
          type: MessageType.ERROR,
          text: `Ambiguous task ID. Did you mean:\n${candidates}`,
        },
        Date.now(),
      );
      return;
    }
  }
  if (task === undefined) {
    addItem(
      { type: MessageType.ERROR, text: `Task not found: ${taskId}` },
      Date.now(),
    );
    return;
  }
  if (task.status !== 'running') {
    addItem(
      {
        type: MessageType.ERROR,
        text: `Task ${task.id} is already ${task.status}.`,
      },
      Date.now(),
    );
    return;
  }
  const cancelled = await operations.cancel(task.id);
  addItem(
    cancelled
      ? { type: MessageType.INFO, text: `Cancelled task: ${task.id}` }
      : {
          type: MessageType.ERROR,
          text: `Failed to cancel task ${task.id}. It may have already completed.`,
        },
    Date.now(),
  );
}

function createEndTaskCommand(
  operations: TaskCommandOperations | null,
  addItem: AddTaskItem,
): SlashCommand {
  return {
    name: 'end',
    description: 'Cancel a running async task',
    kind: CommandKind.BUILT_IN,
    completion: async (_invocation, partialArg): Promise<string[]> =>
      (operations?.listRunning() ?? [])
        .map((entry) => entry.id)
        .filter((id) => id.toLowerCase().startsWith(partialArg.toLowerCase())),
    action: async (_invocation, args): Promise<void> => {
      const taskId = args.trim();
      if (!taskId) {
        addItem(
          { type: MessageType.ERROR, text: 'Usage: /task end <task_id>' },
          Date.now(),
        );
        return;
      }
      if (operations === null) {
        addItem(
          { type: MessageType.ERROR, text: 'Agent tasks not available' },
          Date.now(),
        );
        return;
      }
      await cancelTask(operations, addItem, taskId);
    },
  };
}

export function createTaskCommand(
  operations: TaskCommandOperations | null,
  addItem: AddTaskItem,
): SlashCommand {
  return {
    name: 'task',
    description: 'Manage async background tasks',
    kind: CommandKind.BUILT_IN,
    subCommands: [
      {
        name: 'list',
        description: 'List all async background tasks',
        kind: CommandKind.BUILT_IN,
        action: (): void => listTasks(operations, addItem),
      },
      createEndTaskCommand(operations, addItem),
    ],
  };
}
