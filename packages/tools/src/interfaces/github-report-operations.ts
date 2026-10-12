/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type GitHubReportOperation = (
  op: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<Record<string, unknown>>;

export interface GitHubReportOperations {
  readonly readReport: GitHubReportOperation;
  readonly submitReport: GitHubReportOperation;
}
