/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AsyncTaskManager, AsyncTaskInfo } from './asyncTaskManager.js';
import type { ShellJobManager } from './shellJobManager.js';
import type { ShellJob } from './shellJobTypes.js';

export type AsyncWorkKind = 'subagent' | 'shell';

export interface FacadeWorkInfo {
  kind: AsyncWorkKind;
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  launchedAt?: number;
  completedAt?: number;
  // subagent-specific
  subagentName?: string;
  goalPrompt?: string;
  output?: unknown;
  error?: string;
  // shell-specific
  command?: string;
  cwd?: string;
  pid?: number;
  exitCode?: number;
  signal?: string;
  failureReason?: string;
}

export interface FacadeLookupResult {
  task?: FacadeWorkInfo;
  candidates?: FacadeWorkInfo[];
}

export interface FacadeTailOptions {
  lines?: number;
  maxBytes?: number;
}

export interface FacadeTailResult {
  id: string;
  output: string;
  truncated: boolean;
}

function taskToInfo(task: AsyncTaskInfo): FacadeWorkInfo {
  return {
    kind: 'subagent',
    id: task.id,
    status: task.status,
    launchedAt: task.launchedAt,
    completedAt: task.completedAt,
    subagentName: task.subagentName,
    goalPrompt: task.goalPrompt,
    output: task.output,
    error: task.error,
  };
}

function jobToInfo(job: ShellJob): FacadeWorkInfo {
  return {
    kind: 'shell',
    id: job.id,
    status: job.state,
    pid: job.pid,
    launchedAt: job.startedAt,
    completedAt: job.endedAt,
    command: job.command,
    cwd: job.cwd,
    exitCode: job.exitCode,
    signal: job.signal,
    failureReason: job.failureReason,
  };
}

/**
 * Aggregates {@link AsyncTaskManager} (subagent-driven work) and
 * {@link ShellJobManager} (managed background shell jobs) behind a single
 * query/control surface.
 *
 * Ids are disjoint by construction: shell ids carry the `shell_` prefix and
 * subagent ids are agent-derived. However, prefix lookup MUST still detect
 * cross-source ambiguity: if a prefix matches tasks in both managers, all
 * candidates are reported.
 */
export class AsyncWorkFacade {
  constructor(
    private readonly taskManagerProvider: () => AsyncTaskManager | undefined,
    private readonly jobManagerProvider: () => ShellJobManager | undefined,
  ) {}

  /**
   * List all work from both sources, subagent tasks first then shell jobs.
   */
  list(): FacadeWorkInfo[] {
    const results: FacadeWorkInfo[] = [];
    const taskMgr = this.taskManagerProvider();
    if (taskMgr) {
      for (const t of taskMgr.getAllTasks()) {
        results.push(taskToInfo(t));
      }
    }
    const jobMgr = this.jobManagerProvider();
    if (jobMgr) {
      for (const j of jobMgr.list()) {
        results.push(jobToInfo(j));
      }
    }
    return results;
  }

  /**
   * Get a single work item by exact id. Checks subagent tasks first, then
   * shell jobs.
   */
  get(id: string): FacadeWorkInfo | undefined {
    const taskMgr = this.taskManagerProvider();
    if (taskMgr) {
      const task = taskMgr.getTask(id);
      if (task) {
        return taskToInfo(task);
      }
    }
    const jobMgr = this.jobManagerProvider();
    if (jobMgr) {
      const job = jobMgr.get(id);
      if (job) {
        return jobToInfo(job);
      }
    }
    return undefined;
  }

  /**
   * Lookup by prefix across both sources. Detects cross-source ambiguity:
   * if the prefix matches entries from both managers, ALL candidates are
   * returned so the caller can disambiguate.
   */
  getByPrefix(prefix: string): FacadeLookupResult {
    const candidates: FacadeWorkInfo[] = [];

    const taskMgr = this.taskManagerProvider();
    if (taskMgr) {
      const taskResult = taskMgr.getTaskByPrefix(prefix);
      if (taskResult.task) {
        candidates.push(taskToInfo(taskResult.task));
      }
      if (taskResult.candidates) {
        for (const c of taskResult.candidates) {
          candidates.push(taskToInfo(c));
        }
      }
    }

    const jobMgr = this.jobManagerProvider();
    if (jobMgr) {
      const jobResult = jobMgr.getByPrefix(prefix);
      if (jobResult.job) {
        candidates.push(jobToInfo(jobResult.job));
      }
      if (jobResult.candidates) {
        for (const c of jobResult.candidates) {
          candidates.push(jobToInfo(c));
        }
      }
    }

    if (candidates.length === 0) {
      return {};
    }
    if (candidates.length === 1) {
      return { task: candidates[0] };
    }
    return { candidates };
  }

  /**
   * Read a bounded output tail for a work item by id. Only shell jobs have
   * log output; subagent tasks return an empty tail.
   */
  tailOutput(id: string, options?: FacadeTailOptions): FacadeTailResult {
    const jobMgr = this.jobManagerProvider();
    if (jobMgr) {
      const result = jobMgr.tailOutput(id, options);
      if (result.output !== '' || this.get(id)?.kind === 'shell') {
        return result;
      }
    }
    return { id, output: '', truncated: false };
  }

  /**
   * Cancel a running work item by id. Routes to the correct manager.
   * Returns true if the cancel won the terminal transition, false if the
   * task was already terminal.
   */
  async cancel(id: string): Promise<boolean> {
    const jobMgr = this.jobManagerProvider();
    if (jobMgr) {
      const job = jobMgr.get(id);
      if (job) {
        return jobMgr.cancel(id);
      }
    }
    const taskMgr = this.taskManagerProvider();
    if (taskMgr) {
      const task = taskMgr.getTask(id);
      if (task) {
        return taskMgr.cancelTask(id);
      }
    }
    return false;
  }
}
