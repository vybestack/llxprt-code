/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-COREAPIGAP.P08
 * @requirement:REQ-003
 */

import type {
  AgentTasksControl,
  AgentTaskInfo,
  AgentSubagentTaskInfo,
  AgentShellJobInfo,
} from '../agent.js';
import type {
  AsyncTaskManager,
  AsyncTaskInfo,
  ShellJobManager,
  ShellJob,
} from '@vybestack/llxprt-code-core';

/**
 * @plan:PLAN-20260622-COREAPIGAP.P08
 * @requirement:REQ-003
 */
export interface TasksControlDeps {
  readonly getManager: () => AsyncTaskManager | undefined;
  /**
   * The session-owned ShellJobManager, injected directly rather than fetched
   * through Config. Undefined only when the caller has no shell runtime.
   *
   * @plan PLAN-20260808-ISSUE2615
   */
  readonly shellJobManager?: ShellJobManager;
}

/**
 * @plan:PLAN-20260622-COREAPIGAP.P08
 * @requirement:REQ-003
 */
export class TasksControl implements AgentTasksControl {
  constructor(private readonly deps: TasksControlDeps) {}

  /** @requirement:REQ-003 @pseudocode lines 1-13 */
  private project(task: AsyncTaskInfo): AgentSubagentTaskInfo {
    return {
      kind: 'subagent',
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

  /** #1995 slice 7 — project a shell job into the public view */
  private projectShell(job: ShellJob): AgentShellJobInfo {
    return {
      kind: 'shell',
      id: job.id,
      command: job.command,
      cwd: job.cwd,
      status: job.state,
      launchedAt: job.startedAt,
      ...(job.endedAt !== undefined ? { completedAt: job.endedAt } : {}),
      ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
      ...(job.signal !== undefined ? { signal: job.signal } : {}),
      ...(job.failureReason !== undefined
        ? { failureReason: job.failureReason }
        : {}),
    };
  }

  /** @requirement:REQ-003 @pseudocode lines 20-25 */
  list(): readonly AgentTaskInfo[] {
    const results: AgentTaskInfo[] = [];
    const mgr = this.deps.getManager();
    if (mgr) {
      for (const t of mgr.getAllTasks()) {
        results.push(this.project(t));
      }
    }
    const shellMgr = this.deps.shellJobManager;
    if (shellMgr) {
      for (const j of shellMgr.list()) {
        results.push(this.projectShell(j));
      }
    }
    return results;
  }

  /** @requirement:REQ-003 @pseudocode lines 30-35 */
  listRunning(): readonly AgentTaskInfo[] {
    const results: AgentTaskInfo[] = [];
    const mgr = this.deps.getManager();
    if (mgr) {
      for (const t of mgr.getRunningTasks()) {
        results.push(this.project(t));
      }
    }
    const shellMgr = this.deps.shellJobManager;
    if (shellMgr) {
      for (const j of shellMgr.getRunningJobs()) {
        results.push(this.projectShell(j));
      }
    }
    return results;
  }

  /** @requirement:REQ-003 @pseudocode lines 40-47 */
  get(id: string): AgentTaskInfo | undefined {
    const mgr = this.deps.getManager();
    if (mgr) {
      const task = mgr.getTask(id);
      if (task) {
        return this.project(task);
      }
    }
    const shellMgr = this.deps.shellJobManager;
    if (shellMgr) {
      const job = shellMgr.get(id);
      if (job) {
        return this.projectShell(job);
      }
    }
    return undefined;
  }

  /** @requirement:REQ-003 @pseudocode lines 50-55 */
  async cancel(id: string): Promise<boolean> {
    const mgr = this.deps.getManager();
    if (mgr) {
      const task = mgr.getTask(id);
      if (task) {
        return mgr.cancelTask(id);
      }
    }
    const shellMgr = this.deps.shellJobManager;
    if (shellMgr) {
      const job = shellMgr.get(id);
      if (job) {
        return shellMgr.cancel(id);
      }
    }
    return false;
  }

  /** @requirement:REQ-003 @pseudocode lines 60-70 */
  async cancelAllRunning(): Promise<number> {
    let count = 0;
    const mgr = this.deps.getManager();
    if (mgr) {
      for (const task of mgr.getRunningTasks()) {
        if (mgr.cancelTask(task.id)) count++;
      }
    }
    const shellMgr = this.deps.shellJobManager;
    if (shellMgr) {
      for (const job of shellMgr.getRunningJobs()) {
        if (await shellMgr.cancel(job.id)) count++;
      }
    }
    return count;
  }
}
