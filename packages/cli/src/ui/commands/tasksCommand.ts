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
import { writeCommandOutput } from '../hooks/command-journal-output.js';
import type {
  Agent,
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

function getRunningTaskIds(context: CommandContext): string[] {
  const agent = context.services.agent;
  if (agent) {
    return agent.tasks.listRunning().map((t) => t.id);
  }

  return [];
}

async function reportTaskNotFound(
  context: CommandContext,
  taskId: string,
): Promise<void> {
  await writeCommandOutput(
    () => context.services.agent?.agentClient.getHistoryService() ?? null,
    context.services.agent?.session,
    context.recordingOwner,
    context.ui.addItem,
    { type: MessageType.ERROR, text: `Task not found: ${taskId}` },
    Date.now(),
  );
}

async function reportAmbiguous(
  context: CommandContext,
  candidates: string[],
): Promise<void> {
  const candidateList = candidates.map((c) => `  ${c}`).join('\n');
  await writeCommandOutput(
    () => context.services.agent?.agentClient.getHistoryService() ?? null,
    context.services.agent?.session,
    context.recordingOwner,
    context.ui.addItem,
    {
      type: MessageType.ERROR,
      text: `Ambiguous task ID. Did you mean:\n${candidateList}`,
    },
    Date.now(),
  );
}

async function reportCancelResult(
  context: CommandContext,
  taskId: string,
  cancelled: boolean,
): Promise<void> {
  await writeCommandOutput(
    () => context.services.agent?.agentClient.getHistoryService() ?? null,
    context.services.agent?.session,
    context.recordingOwner,
    context.ui.addItem,
    cancelled
      ? { type: MessageType.INFO, text: `Cancelled task: ${taskId}` }
      : {
          type: MessageType.ERROR,
          text: `Failed to cancel task ${taskId}. It may have already completed.`,
        },
    Date.now(),
  );
}

async function endTaskViaAgent(
  context: CommandContext,
  agent: Agent,
  taskId: string,
): Promise<void> {
  let task = agent.tasks.get(taskId);
  if (!task) {
    const prefixMatches = agent.tasks
      .list()
      .filter((t) => t.id.startsWith(taskId));
    if (prefixMatches.length === 1) {
      task = prefixMatches[0];
    } else if (prefixMatches.length > 1) {
      await reportAmbiguous(
        context,
        prefixMatches.map((t) => t.id),
      );
      return;
    }
  }
  if (!task) {
    await reportTaskNotFound(context, taskId);
    return;
  }
  if (task.status !== 'running') {
    await writeCommandOutput(
      () => context.services.agent?.agentClient.getHistoryService() ?? null,
      context.services.agent?.session,
      context.recordingOwner,
      context.ui.addItem,
      {
        type: MessageType.ERROR,
        text: `Task ${task.id} is already ${task.status}.`,
      },
      Date.now(),
    );
    return;
  }
  await reportCancelResult(context, task.id, await agent.tasks.cancel(task.id));
}

export const taskCommand: SlashCommand = {
  name: 'task',
  description: 'Manage async background tasks',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    {
      name: 'list',
      description: 'List all async background tasks',
      kind: CommandKind.BUILT_IN,
      action: async (context: CommandContext) => {
        const agent = context.services.agent;
        const tasks: readonly AgentTaskInfo[] | undefined = agent
          ? agent.tasks.list()
          : undefined;

        if (!tasks) {
          await writeCommandOutput(
            () =>
              context.services.agent?.agentClient.getHistoryService() ?? null,
            context.services.agent?.session,
            context.recordingOwner,
            context.ui.addItem,
            { type: MessageType.ERROR, text: 'Agent tasks not available' },
            Date.now(),
          );
          return;
        }
        if (tasks.length === 0) {
          await writeCommandOutput(
            () =>
              context.services.agent?.agentClient.getHistoryService() ?? null,
            context.services.agent?.session,
            context.recordingOwner,
            context.ui.addItem,
            { type: MessageType.INFO, text: 'No async tasks.' },
            Date.now(),
          );
          return;
        }

        const lines: string[] = ['Async Tasks:', ''];
        for (const task of tasks) {
          lines.push(formatTask(task));
          lines.push('');
        }
        await writeCommandOutput(
          () => context.services.agent?.agentClient.getHistoryService() ?? null,
          context.services.agent?.session,
          context.recordingOwner,
          context.ui.addItem,
          { type: MessageType.INFO, text: lines.join('\n') },
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
      action: async (context: CommandContext, args: string) => {
        const taskId = args.trim();
        if (!taskId) {
          await writeCommandOutput(
            () =>
              context.services.agent?.agentClient.getHistoryService() ?? null,
            context.services.agent?.session,
            context.recordingOwner,
            context.ui.addItem,
            { type: MessageType.ERROR, text: 'Usage: /task end <task_id>' },
            Date.now(),
          );
          return;
        }
        const agent = context.services.agent;
        if (agent) {
          await endTaskViaAgent(context, agent, taskId);
          return;
        }
        await writeCommandOutput(
          () => context.services.agent?.agentClient.getHistoryService() ?? null,
          context.services.agent?.session,
          context.recordingOwner,
          context.ui.addItem,
          { type: MessageType.ERROR, text: 'Agent tasks not available' },
          Date.now(),
        );
      },
    },
  ],
};

export const tasksCommands: SlashCommand[] = [taskCommand];
