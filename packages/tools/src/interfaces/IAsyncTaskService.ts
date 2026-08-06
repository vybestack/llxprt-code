/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Status shared by all async work (subagent tasks and shell jobs). */
export type AsyncTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** Discriminated union member: subagent-driven async work. */
export interface SubagentTaskInfo {
  kind: 'subagent';
  id: string;
  subagentName: string;
  goalPrompt: string;
  status: AsyncTaskStatus;
  launchedAt?: number;
  completedAt?: number;
  output?: unknown;
  error?: string;
}

/** Discriminated union member: managed background shell job. */
export interface ShellJobInfo {
  kind: 'shell';
  id: string;
  command: string;
  cwd: string;
  status: AsyncTaskStatus;
  pid?: number;
  launchedAt?: number;
  completedAt?: number;
  exitCode?: number;
  signal?: string;
  failureReason?: string;
}

/**
 * Discriminated union of all async work the model can observe.
 * The `kind` field is required so consumers can narrow without guesswork.
 */
export type AsyncWorkInfo = SubagentTaskInfo | ShellJobInfo;

/**
 * Legacy alias kept for gradual migration of consumers that still reference
 * the pre-discriminated name. New code MUST use {@link AsyncWorkInfo}.
 */
export type AsyncTaskInfo = AsyncWorkInfo;

export interface AsyncTaskLookupResult {
  task?: AsyncWorkInfo;
  candidates?: AsyncWorkInfo[];
}

export interface AsyncOutputTailOptions {
  lines?: number;
  maxBytes?: number;
}

export interface AsyncOutputTailResult {
  id: string;
  output: string;
  truncated: boolean;
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
  getTaskStatus(): AsyncWorkInfo[];

  /**
   * Get a task by exact ID.
   */
  getTask(taskId: string): AsyncWorkInfo | undefined;

  /**
   * Get a task by unique prefix or return ambiguous candidates.
   */
  getTaskByPrefix(prefix: string): AsyncTaskLookupResult;

  /**
   * Read a bounded output tail for a task by id (#1995).
   * Only meaningful for shell jobs; subagent tasks return empty output.
   */
  getOutputTail(
    taskId: string,
    options?: AsyncOutputTailOptions,
  ): AsyncOutputTailResult;

  /**
   * Cancel a running task by id (#1995). Returns true if the cancel won
   * the terminal transition, false if the task was already terminal.
   */
  cancel(taskId: string): Promise<boolean>;
}
