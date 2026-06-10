/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P12
 * @plan PLAN-20260130-ASYNCTASK.P14
 * @requirement REQ-ASYNC-005
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolResult,
} from './tools.js';
import type { IToolMessageBus } from '../interfaces/IToolMessageBus.js';
import type { IAsyncTaskService, AsyncTaskInfo } from '../interfaces/index.js';
import { ToolErrorType } from '../types/tool-error.js';

export interface CheckAsyncTasksParams {
  task_id?: string;
}

export interface CheckAsyncTasksToolDependencies {
  getAsyncTaskService?: () => IAsyncTaskService | undefined;
}

function resolveAsyncTaskService(
  dependenciesOrService: CheckAsyncTasksToolDependencies | IAsyncTaskService,
): IAsyncTaskService | undefined {
  if ('getTaskStatus' in dependenciesOrService) {
    return dependenciesOrService;
  }
  return dependenciesOrService.getAsyncTaskService?.();
}

function getTaskStartTime(task: AsyncTaskInfo): number {
  return task.launchedAt ?? Date.now();
}

function getSubagentName(task: AsyncTaskInfo): string {
  return task.subagentName ?? task.name ?? task.id;
}

function getGoalPrompt(task: AsyncTaskInfo): string {
  return task.goalPrompt ?? '';
}

class CheckAsyncTasksInvocation extends BaseToolInvocation<
  CheckAsyncTasksParams,
  ToolResult
> {
  private readonly taskService: IAsyncTaskService;

  constructor(
    params: CheckAsyncTasksParams,
    taskService: IAsyncTaskService,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
    this.taskService = taskService;
  }

  override getDescription(): string {
    if (this.params.task_id) {
      return `Check status of async task '${this.params.task_id}'`;
    }
    return 'List all async tasks';
  }

  override async execute(): Promise<ToolResult> {
    if (this.params.task_id) {
      return this.executePeek(this.params.task_id);
    }

    return this.executeList();
  }

  private executeList(): ToolResult {
    const tasks = this.taskService.getTaskStatus();

    if (tasks.length === 0) {
      return {
        llmContent: 'No async tasks.',
        returnDisplay: 'No async tasks are currently running or completed.',
        metadata: { count: 0 },
      };
    }

    const running = tasks.filter((t) => t.status === 'running');
    const completed = tasks.filter((t) => t.status === 'completed');
    const failed = tasks.filter((t) => t.status === 'failed');
    const cancelled = tasks.filter((t) => t.status === 'cancelled');

    const lines: string[] = [];
    lines.push('Async Tasks Summary:');
    lines.push(`- Running: ${running.length}`);
    lines.push(`- Completed: ${completed.length}`);
    lines.push(`- Failed: ${failed.length}`);
    lines.push(`- Cancelled: ${cancelled.length}`);
    lines.push('');
    lines.push('Details:');

    for (const task of tasks) {
      const statusIcon = this.statusIcon(task.status);
      const duration = this.formatDuration(task.launchedAt, task.completedAt);
      lines.push(`${statusIcon} [${task.id}] - ${task.status} (${duration})`);
    }

    const llmContent = lines.join('\n');
    const displayLines = tasks.map((t) => {
      const icon = this.statusIcon(t.status);
      return `${icon} **${t.id}** - ${t.status}`;
    });

    return {
      llmContent,
      returnDisplay: displayLines.join('\n'),
      metadata: {
        count: tasks.length,
        running: running.length,
        completed: completed.length,
        failed: failed.length,
        cancelled: cancelled.length,
      },
    };
  }

  private executePeek(taskId: string): ToolResult {
    const task = this.taskService.getTask?.(taskId);

    if (task) {
      return this.formatTaskDetails(task);
    }

    const { task: prefixTask, candidates } = this.taskService.getTaskByPrefix?.(
      taskId,
    ) ?? {
      task: undefined,
      candidates: [],
    };

    if (prefixTask) {
      return this.formatTaskDetails(prefixTask);
    }

    if (candidates && candidates.length > 0) {
      const candidateList = candidates.map((c) => `- ${c.id}`).join('\n');

      return {
        llmContent: `Ambiguous task ID prefix '${taskId}'. Candidates:\n${candidateList}`,
        returnDisplay: `Ambiguous prefix. Did you mean:\n${candidateList}`,
        error: {
          message: 'Ambiguous task ID',
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    return {
      llmContent: `No async task found with ID or prefix '${taskId}'.`,
      returnDisplay: `Task not found: ${taskId}`,
      error: {
        message: 'Task not found',
        type: ToolErrorType.INVALID_TOOL_PARAMS,
      },
    };
  }

  private formatTaskDetails(task: AsyncTaskInfo): ToolResult {
    const details: Record<string, unknown> = {
      id: task.id,
      subagentName: getSubagentName(task),
      goalPrompt: getGoalPrompt(task),
      status: task.status,
      launchedAt: new Date(getTaskStartTime(task)).toISOString(),
      duration: this.formatDuration(task.launchedAt, task.completedAt),
    };

    if (
      task.completedAt !== undefined &&
      task.completedAt !== 0 &&
      !Number.isNaN(task.completedAt)
    ) {
      details.completedAt = new Date(task.completedAt).toISOString();
    }

    const output = task.output as unknown;
    if (output !== undefined && output !== '') {
      details.output = task.output;
    }

    if (task.error !== undefined && task.error !== '') {
      details.error = task.error;
    }

    return {
      llmContent: JSON.stringify(details, null, 2),
      returnDisplay: this.formatTaskDisplay(task),
      metadata: details,
    };
  }

  private formatDuration(
    startTime: number | undefined,
    endTime?: number,
  ): string {
    const end = endTime ?? Date.now();
    const durationMs = end - (startTime ?? end);
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

  private formatTaskDisplay(task: AsyncTaskInfo): string {
    const lines: string[] = [];
    const icon = this.statusIcon(task.status);
    const goalPrompt = getGoalPrompt(task);

    lines.push(`${icon} **${getSubagentName(task)}**`);
    lines.push(`ID: \`${task.id}\``);
    lines.push(`Status: ${task.status}`);
    lines.push(
      `Goal: ${goalPrompt.substring(0, 100)}${goalPrompt.length > 100 ? '...' : ''}`,
    );
    lines.push(
      `Duration: ${this.formatDuration(task.launchedAt, task.completedAt)}`,
    );

    const output = task.output as { emitted_vars?: Record<string, unknown> };
    if (output?.emitted_vars && Object.keys(output.emitted_vars).length > 0) {
      lines.push('Emitted variables:');
      for (const [key, value] of Object.entries(output.emitted_vars)) {
        const valueStr = String(value);
        const truncated = valueStr.substring(0, 50);
        const suffix = valueStr.length > 50 ? '...' : '';
        lines.push(`  - ${key}: ${truncated}${suffix}`);
      }
    }

    if (task.error) {
      lines.push(`Error: ${task.error}`);
    }
    return lines.join('\n');
  }

  private statusIcon(status: AsyncTaskInfo['status']): string {
    if (status === 'completed') {
      return '[OK]';
    }
    if (status === 'failed') {
      return '[FAILED]';
    }
    return '';
  }
}

/**
 * Tool that allows querying the status of async tasks.
 * Two modes:
 * - List mode (no task_id): Shows summary of all tasks
 * - Peek mode (with task_id): Shows detailed info for specific task
 */
export class CheckAsyncTasksTool extends BaseDeclarativeTool<
  CheckAsyncTasksParams,
  ToolResult
> {
  static readonly Name = 'check_async_tasks';

  constructor(
    private readonly dependencies:
      | CheckAsyncTasksToolDependencies
      | IAsyncTaskService,
  ) {
    super(
      CheckAsyncTasksTool.Name,
      'Check Async Tasks',
      'Check the status of background async tasks. Call with no arguments to list all tasks, ' +
        'or provide a task_id (or prefix) to get detailed info about a specific task.',
      Kind.Think,
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: {
            type: 'string',
            description:
              'Optional task ID or unique prefix to get details for a specific task.',
          },
        },
      },
    );
  }

  protected override createInvocation(
    params: CheckAsyncTasksParams,
    messageBus: IToolMessageBus,
  ): CheckAsyncTasksInvocation {
    const service = resolveAsyncTaskService(this.dependencies);

    if (!service) {
      throw new Error(
        'AsyncTaskManager service is unavailable. Please configure async tasks before invoking this tool.',
      );
    }

    return new CheckAsyncTasksInvocation(params, service, messageBus);
  }

  async execute(params: CheckAsyncTasksParams): Promise<ToolResult> {
    const service = resolveAsyncTaskService(this.dependencies);
    if (!service) {
      throw new Error(
        'AsyncTaskManager service is unavailable. Please configure async tasks before invoking this tool.',
      );
    }
    return new CheckAsyncTasksInvocation(params, service, {
      requestConfirmation: async () => undefined,
    }).execute();
  }

  protected override validateToolParamValues(): string | null {
    return null;
  }
}
