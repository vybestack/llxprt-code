/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AsyncTaskInfo as ToolsAsyncTaskInfo,
  AsyncTaskLookupResult,
  AsyncTaskStatus as ToolsAsyncTaskStatus,
  IAsyncTaskService,
} from '@vybestack/llxprt-code-tools';
import type {
  AsyncTaskInfo as CoreAsyncTaskInfo,
  AsyncTaskManager,
} from '../services/asyncTaskManager.js';

function toToolsTask(task: CoreAsyncTaskInfo): ToolsAsyncTaskInfo {
  return {
    id: task.id,
    name: task.subagentName,
    subagentName: task.subagentName,
    goalPrompt: task.goalPrompt,
    status: task.status,
    launchedAt: task.launchedAt,
    completedAt: task.completedAt,
    output: task.output,
    error: task.error,
  };
}

export class CoreAsyncTaskServiceAdapter implements IAsyncTaskService {
  constructor(
    private readonly managerProvider: () => AsyncTaskManager | undefined,
  ) {}

  async checkAsyncTask(taskId: string): Promise<ToolsAsyncTaskStatus> {
    const task = this.getTask(taskId) ?? this.getTaskByPrefix(taskId).task;
    if (!task) {
      throw new Error(`Async task not found: ${taskId}`);
    }
    return task.status;
  }

  getTaskStatus(): ToolsAsyncTaskInfo[] {
    return this.requireManager().getAllTasks().map(toToolsTask);
  }

  getTask(taskId: string): ToolsAsyncTaskInfo | undefined {
    const task = this.requireManager().getTask(taskId);
    return task ? toToolsTask(task) : undefined;
  }

  getTaskByPrefix(prefix: string): AsyncTaskLookupResult {
    const result = this.requireManager().getTaskByPrefix(prefix);
    return {
      task: result.task ? toToolsTask(result.task) : undefined,
      candidates: result.candidates?.map(toToolsTask),
    };
  }

  private requireManager(): AsyncTaskManager {
    const manager = this.managerProvider();
    if (!manager) {
      throw new Error(
        'AsyncTaskManager service is unavailable. Please configure async tasks before invoking this tool.',
      );
    }
    return manager;
  }
}
