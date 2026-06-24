/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-COREAPIGAP.P08
 * @requirement:REQ-003
 */

import type { AgentTasksControl, AgentTaskInfo } from '../agent.js';
import type { AsyncTaskManager, AsyncTaskInfo } from '@vybestack/llxprt-code-core';

/**
 * @plan:PLAN-20260622-COREAPIGAP.P08
 * @requirement:REQ-003
 */
export interface TasksControlDeps {
  readonly getManager: () => AsyncTaskManager | undefined;
}

/**
 * @plan:PLAN-20260622-COREAPIGAP.P08
 * @requirement:REQ-003
 */
export class TasksControl implements AgentTasksControl {
  constructor(private readonly deps: TasksControlDeps) {}

  /** @requirement:REQ-003 @pseudocode lines 1-13 */
  private project(task: AsyncTaskInfo): AgentTaskInfo {
    return {
      id: task.id,
      subagentName: task.subagentName,
      goalPrompt: task.goalPrompt,
      status: task.status,
      launchedAt: task.launchedAt,
      ...(task.completedAt !== undefined
        ? { completedAt: task.completedAt }
        : {}),
      ...(task.error !== undefined ? { error: task.error } : {}),
    };
  }

  /** @requirement:REQ-003 @pseudocode lines 20-25 */
  list(): readonly AgentTaskInfo[] {
    const mgr = this.deps.getManager();
    if (mgr === undefined) return [];
    return mgr.getAllTasks().map((t) => this.project(t));
  }

  /** @requirement:REQ-003 @pseudocode lines 30-35 */
  listRunning(): readonly AgentTaskInfo[] {
    const mgr = this.deps.getManager();
    if (mgr === undefined) return [];
    return mgr.getRunningTasks().map((t) => this.project(t));
  }

  /** @requirement:REQ-003 @pseudocode lines 40-47 */
  get(id: string): AgentTaskInfo | undefined {
    const mgr = this.deps.getManager();
    if (mgr === undefined) return undefined;
    const task = mgr.getTask(id);
    if (task === undefined) return undefined;
    return this.project(task);
  }

  /** @requirement:REQ-003 @pseudocode lines 50-55 */
  cancel(id: string): boolean {
    const mgr = this.deps.getManager();
    if (mgr === undefined) return false;
    return mgr.cancelTask(id);
  }

  /** @requirement:REQ-003 @pseudocode lines 60-70 */
  cancelAllRunning(): number {
    const mgr = this.deps.getManager();
    if (mgr === undefined) return 0;
    const running = mgr.getRunningTasks();
    let count = 0;
    for (const task of running) {
      if (mgr.cancelTask(task.id)) count++;
    }
    return count;
  }
}
