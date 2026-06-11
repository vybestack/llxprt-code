/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Status of an async task. */
export type AsyncTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** Information about an async task. */
export interface AsyncTaskInfo {
  /** Task identifier. */
  id: string;
  /** Task name or description. */
  name?: string;
  /** Subagent name for task-driven async work. */
  subagentName?: string;
  /** Goal prompt used to launch the task. */
  goalPrompt?: string;
  /** Current task status. */
  status: AsyncTaskStatus;
  /** Unix timestamp in milliseconds when the task was launched. */
  launchedAt?: number;
  /** Unix timestamp in milliseconds when the task completed. */
  completedAt?: number;
  /** Task output payload. */
  output?: unknown;
  /** Error message for failed tasks. */
  error?: string;
}

export interface AsyncTaskLookupResult {
  task?: AsyncTaskInfo;
  candidates?: AsyncTaskInfo[];
}

export interface IAsyncTaskService {
  /**
   * Check the status of a specific async task.
   * @param taskId - The task identifier.
   * @returns The current task status.
   */
  checkAsyncTask(taskId: string): Promise<AsyncTaskStatus>;

  /**
   * Get information for all tracked tasks.
   * @returns Array of task information objects.
   */
  getTaskStatus(): AsyncTaskInfo[];

  /**
   * Get a task by exact ID.
   */
  getTask(taskId: string): AsyncTaskInfo | undefined;

  /**
   * Get a task by unique prefix or return ambiguous candidates.
   */
  getTaskByPrefix(prefix: string): AsyncTaskLookupResult;
}
