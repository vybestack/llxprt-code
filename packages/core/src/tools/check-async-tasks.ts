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
import { ToolErrorType } from './tool-error.js';
import type {
  AsyncTaskManager,
  AsyncTaskInfo,
} from '../services/asyncTaskManager.js';

export interface CheckAsyncTasksParams {
  task_id?: string;
}

export interface CheckAsyncTasksToolDependencies {
  getAsyncTaskManager?: () => AsyncTaskManager | undefined;
}

class CheckAsyncTasksInvocation extends BaseToolInvocation<
  CheckAsyncTasksParams,
  ToolResult
> {
  private readonly taskManager: AsyncTaskManager;

  constructor(params: CheckAsyncTasksParams, taskManager: AsyncTaskManager) {
    super(params);
    this.taskManager = taskManager;
  }

  override getDescription(): string {
    if (this.params.task_id) {
      return `Check status of async task '${this.params.task_id}'`;
    }
    return 'List all async tasks';
  }

  override async execute(): Promise<ToolResult> {
    // Peek mode: specific task requested
    if (this.params.task_id) {
      return this.executePeek(this.params.task_id);
    }

    // List mode: show all tasks
    return this.executeList();
  }

  private executeList(): ToolResult {
    const tasks = this.taskManager.getAllTasks();

    if (tasks.length === 0) {
      return {
        llmContent: 'No async tasks.',
        returnDisplay: 'No async tasks are currently running or completed.',
        metadata: { count: 0 },
      };
    }

    // Build summary
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
      const statusIcon =
        task.status === 'running'
          ? ''
          : task.status === 'completed'
            ? '[OK]'
            : task.status === 'failed'
              ? '[FAILED]'
              : '';
      // Use full task ID (agentId like "hardproblemcoder-cmh7yw") for uniqueness
      const duration = this.formatDuration(task.launchedAt, task.completedAt);
      lines.push(`${statusIcon} [${task.id}] - ${task.status} (${duration})`);
    }

    const llmContent = lines.join('\n');

    // Display version (same content, markdown formatted)
    const displayLines = tasks.map((t) => {
      const icon =
        t.status === 'running'
          ? ''
          : t.status === 'completed'
            ? '[OK]'
            : t.status === 'failed'
              ? '[FAILED]'
              : '';
      // Use full task ID (agentId) for uniqueness
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
    // Try exact match first
    const task = this.taskManager.getTask(taskId);

    if (task) {
      return this.formatTaskDetails(task);
    }

    // Try prefix match
    const { task: prefixTask, candidates } =
      this.taskManager.getTaskByPrefix(taskId);

    if (prefixTask) {
      return this.formatTaskDetails(prefixTask);
    }

    if (candidates && candidates.length > 0) {
      // Ambiguous prefix - show full task IDs since they're now the unique agentId
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

    // Not found
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
      subagentName: task.subagentName,
      goalPrompt: task.goalPrompt,
      status: task.status,
      launchedAt: new Date(task.launchedAt).toISOString(),
      duration: this.formatDuration(task.launchedAt, task.completedAt),
    };

    if (task.completedAt) {
      details.completedAt = new Date(task.completedAt).toISOString();
    }

    if (task.output) {
      details.output = task.output;
    }

    if (task.error) {
      details.error = task.error;
    }

    return {
      llmContent: JSON.stringify(details, null, 2),
      returnDisplay: this.formatTaskDisplay(task),
      metadata: details,
    };
  }

  private formatDuration(startTime: number, endTime?: number): string {
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

  private formatTaskDisplay(task: AsyncTaskInfo): string {
    const lines: string[] = [];
    const icon =
      task.status === 'running'
        ? ''
        : task.status === 'completed'
          ? '[OK]'
          : task.status === 'failed'
            ? '[FAILED]'
            : '';

    lines.push(`${icon} **${task.subagentName}**`);
    lines.push(`ID: \`${task.id}\``);

    lines.push(`Status: ${task.status}`);
    lines.push(
      `Goal: ${task.goalPrompt.substring(0, 100)}${task.goalPrompt.length > 100 ? '...' : ''}`,
    );
    lines.push(
      `Duration: ${this.formatDuration(task.launchedAt, task.completedAt)}`,
    );

    if (
      task.output?.emitted_vars &&
      Object.keys(task.output.emitted_vars).length > 0
    ) {
      lines.push('Emitted variables:');
      for (const [key, value] of Object.entries(task.output.emitted_vars)) {
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

  constructor(private readonly dependencies: CheckAsyncTasksToolDependencies) {
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
  ): CheckAsyncTasksInvocation {
    const manager = this.dependencies.getAsyncTaskManager?.();

    if (!manager) {
      throw new Error(
        'AsyncTaskManager service is unavailable. Please configure async tasks before invoking this tool.',
      );
    }

    return new CheckAsyncTasksInvocation(params, manager);
  }

  protected override validateToolParamValues(): string | null {
    return null;
  }
}
