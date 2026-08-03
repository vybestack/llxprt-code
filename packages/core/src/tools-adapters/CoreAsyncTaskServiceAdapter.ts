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
  AsyncOutputTailOptions,
  AsyncOutputTailResult,
  SubagentTaskInfo,
  ShellJobInfo,
} from '@vybestack/llxprt-code-tools';
import type {
  FacadeWorkInfo,
  FacadeLookupResult,
  AsyncWorkFacade,
} from '../services/asyncWorkFacade.js';

function isSubagent(info: FacadeWorkInfo): boolean {
  return info.kind === 'subagent';
}

function toSubagentInfo(info: FacadeWorkInfo): SubagentTaskInfo {
  return {
    kind: 'subagent',
    id: info.id,
    subagentName: info.subagentName ?? info.id,
    goalPrompt: info.goalPrompt ?? '',
    status: info.status,
    ...(info.launchedAt !== undefined ? { launchedAt: info.launchedAt } : {}),
    ...(info.completedAt !== undefined
      ? { completedAt: info.completedAt }
      : {}),
    ...(info.output !== undefined ? { output: info.output } : {}),
    ...(info.error !== undefined ? { error: info.error } : {}),
  };
}

function toShellJobInfo(info: FacadeWorkInfo): ShellJobInfo {
  return {
    kind: 'shell',
    id: info.id,
    command: info.command ?? '',
    cwd: info.cwd ?? '',
    status: info.status,
    ...(info.launchedAt !== undefined ? { launchedAt: info.launchedAt } : {}),
    ...(info.completedAt !== undefined
      ? { completedAt: info.completedAt }
      : {}),
    ...(info.exitCode !== undefined ? { exitCode: info.exitCode } : {}),
    ...(info.signal !== undefined ? { signal: info.signal } : {}),
    ...(info.failureReason !== undefined
      ? { failureReason: info.failureReason }
      : {}),
  };
}

function toToolsInfo(info: FacadeWorkInfo): ToolsAsyncTaskInfo {
  return isSubagent(info) ? toSubagentInfo(info) : toShellJobInfo(info);
}

function toToolsLookup(result: FacadeLookupResult): AsyncTaskLookupResult {
  return {
    task: result.task ? toToolsInfo(result.task) : undefined,
    candidates: result.candidates?.map(toToolsInfo),
  };
}

export class CoreAsyncTaskServiceAdapter implements IAsyncTaskService {
  constructor(private readonly facade: AsyncWorkFacade) {}

  async checkAsyncTask(taskId: string): Promise<ToolsAsyncTaskStatus> {
    const task = this.facade.get(taskId);
    if (!task) {
      const { task: prefixTask } = this.facade.getByPrefix(taskId);
      if (!prefixTask) {
        throw new Error(`Async task not found: ${taskId}`);
      }
      return prefixTask.status;
    }
    return task.status;
  }

  getTaskStatus(): ToolsAsyncTaskInfo[] {
    return this.facade.list().map(toToolsInfo);
  }

  getTask(taskId: string): ToolsAsyncTaskInfo | undefined {
    const task = this.facade.get(taskId);
    return task ? toToolsInfo(task) : undefined;
  }

  getTaskByPrefix(prefix: string): AsyncTaskLookupResult {
    return toToolsLookup(this.facade.getByPrefix(prefix));
  }

  getOutputTail(
    taskId: string,
    options?: AsyncOutputTailOptions,
  ): AsyncOutputTailResult {
    return this.facade.tailOutput(taskId, options);
  }

  async cancel(taskId: string): Promise<boolean> {
    return this.facade.cancel(taskId);
  }
}
