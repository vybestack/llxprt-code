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
import type {
  IAsyncTaskService,
  AsyncWorkInfo,
  SubagentTaskInfo,
  ShellJobInfo,
} from '../interfaces/index.js';
import { ToolConfirmationOutcome } from '../types/tool-confirmation-types.js';
import { ToolErrorType } from '../types/tool-error.js';
import {
  formatDuration,
  formatSubagentDetails,
  formatSubagentDisplay,
  statusIcon,
} from './check-async-tasks-subagent-formatter.js';
import {
  formatShellDetails,
  formatShellDisplay,
} from './check-async-tasks-shell-formatter.js';

export interface CheckAsyncTasksParams {
  task_id?: string;
  action?: 'list' | 'peek' | 'cancel';
}

export interface CheckAsyncTasksToolDependencies {
  getAsyncTaskService?: () => IAsyncTaskService | undefined;
}

const SERVICE_UNAVAILABLE_MSG =
  'Async task service is unavailable. Please configure async tasks before invoking this tool.';

function resolveAsyncTaskService(
  dependenciesOrService: CheckAsyncTasksToolDependencies | IAsyncTaskService,
): IAsyncTaskService | undefined {
  if ('getTaskStatus' in dependenciesOrService) {
    return dependenciesOrService;
  }
  return dependenciesOrService.getAsyncTaskService?.();
}

function isSubagent(task: AsyncWorkInfo): task is SubagentTaskInfo {
  return task.kind === 'subagent';
}

function isShell(task: AsyncWorkInfo): task is ShellJobInfo {
  return task.kind === 'shell';
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
    if (this.params.action === 'cancel' && this.params.task_id) {
      return `Cancel async task '${this.params.task_id}'`;
    }
    if (this.params.task_id) {
      return `Check status of async task '${this.params.task_id}'`;
    }
    return 'List all async tasks';
  }

  override async execute(): Promise<ToolResult> {
    const action = this.resolveAction();

    if (action === 'cancel') {
      return this.executeCancel(this.params.task_id ?? '');
    }
    if (action === 'peek') {
      return this.executePeek(this.params.task_id ?? '');
    }
    return this.executeList();
  }

  private resolveAction(): 'list' | 'peek' | 'cancel' {
    if (this.params.action === 'cancel') {
      return 'cancel';
    }
    if (this.params.action === 'peek') {
      return 'peek';
    }
    if (this.params.action === 'list') {
      return 'list';
    }
    return this.params.task_id ? 'peek' : 'list';
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
      lines.push(this.summaryLine(task));
    }

    const displayLines = tasks.map((t) => this.displaySummaryLine(t));

    return {
      llmContent: lines.join('\n'),
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

  private summaryLine(task: AsyncWorkInfo): string {
    const icon = statusIcon(task.status);
    const duration = formatDuration(task.launchedAt, task.completedAt);
    if (isShell(task)) {
      return `${icon} [${task.id}] shell - ${task.status} (${duration})`;
    }
    return `${icon} [${task.id}] ${task.status} (${duration})`;
  }

  private displaySummaryLine(task: AsyncWorkInfo): string {
    const icon = statusIcon(task.status);
    return `${icon} **${task.id}** - ${task.status}`;
  }

  private async executePeek(taskId: string): Promise<ToolResult> {
    const task = this.taskService.getTask(taskId);

    if (task) {
      return this.formatTaskDetails(task);
    }

    const { task: prefixTask, candidates } =
      this.taskService.getTaskByPrefix(taskId);

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

  private async executeCancel(taskId: string): Promise<ToolResult> {
    if (!taskId) {
      return {
        llmContent: 'Cannot cancel: no task_id provided.',
        returnDisplay: 'No task_id provided for cancel action.',
        error: {
          message: 'task_id is required for cancel action',
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    const exists =
      this.taskService.getTask(taskId) ??
      this.taskService.getTaskByPrefix(taskId).task;

    if (!exists) {
      return {
        llmContent: `No async task found with ID or prefix '${taskId}'.`,
        returnDisplay: `Task not found: ${taskId}`,
        error: {
          message: 'Task not found',
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    const cancelled = await this.taskService.cancel(exists.id);

    if (cancelled) {
      return {
        llmContent: `Task ${exists.id} cancelled successfully.`,
        returnDisplay: `**${exists.id}** cancelled.`,
      };
    }

    return {
      llmContent: `Task ${exists.id} was already terminal (not running).`,
      returnDisplay: `**${exists.id}** was not running (already terminal).`,
    };
  }

  private async formatTaskDetails(task: AsyncWorkInfo): Promise<ToolResult> {
    if (isSubagent(task)) {
      const details = formatSubagentDetails(task);
      return {
        llmContent: JSON.stringify(details, null, 2),
        returnDisplay: formatSubagentDisplay(task),
        metadata: details,
      };
    }
    if (isShell(task)) {
      const tail = this.taskService.getOutputTail(task.id);
      const details = formatShellDetails(task, tail.output, tail.truncated);
      return {
        llmContent: JSON.stringify(details, null, 2),
        returnDisplay: formatShellDisplay(task, tail.output),
        metadata: details,
      };
    }
    return unreachable(task);
  }
}

function unreachable(task: never): ToolResult {
  throw new Error(`Unhandled task kind: ${JSON.stringify(task)}`);
}

/**
 * Tool that allows querying the status of async tasks and cancelling them.
 * Modes:
 * - List mode (no task_id, action omitted or 'list'): Shows summary of all tasks
 * - Peek mode (task_id provided, action omitted or 'peek'): Shows detailed info for a specific task.
 *   For shell jobs, includes a bounded output tail.
 * - Cancel mode (action='cancel' + task_id): Cancels a running task.
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
      'Check the status of background async tasks (subagent tasks and managed shell jobs). ' +
        'Call with no arguments to list all tasks, ' +
        'provide a task_id (or prefix) to get detailed info about a specific task, ' +
        'or use action "cancel" with a task_id to stop a running task.',
      Kind.Think,
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: {
            type: 'string',
            description:
              'Optional task ID or unique prefix to get details for a specific task, or to cancel.',
          },
          action: {
            type: 'string',
            enum: ['list', 'peek', 'cancel'],
            description:
              'Optional action: "list" (default when no task_id), "peek" (default when task_id given), ' +
              'or "cancel" to stop a running task (requires task_id).',
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
      throw new Error(SERVICE_UNAVAILABLE_MSG);
    }

    return new CheckAsyncTasksInvocation(params, service, messageBus);
  }

  async execute(params: CheckAsyncTasksParams): Promise<ToolResult> {
    const service = resolveAsyncTaskService(this.dependencies);
    if (!service) {
      throw new Error(SERVICE_UNAVAILABLE_MSG);
    }
    return new CheckAsyncTasksInvocation(params, service, {
      requestConfirmation: async () => ToolConfirmationOutcome.ProceedOnce,
    }).execute();
  }

  protected override validateToolParamValues(): string | null {
    return null;
  }
}
