/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host-side context for one GitHub operation. It travels beside the
 * operation parameters, never inside them: the model cannot set it, and the
 * sandbox socket transport does not carry it.
 */
export interface GitHubOperationOptions {
  /**
   * The session workspace directory the `gh` process should run in. The
   * broker falls back to other directories when it is absent or missing.
   */
  readonly workingDirectory?: string;
}

export type GitHubReportOperation = (
  op: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
  options?: GitHubOperationOptions,
) => Promise<Record<string, unknown>>;

export interface GitHubReportOperations {
  readonly readReport: GitHubReportOperation;
  readonly submitReport: GitHubReportOperation;
}
