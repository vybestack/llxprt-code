/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceContext } from '../../utils/workspaceContext.js';
import type { FileFilteringOptions } from '../configTypes.js';
import type { FileExclusions } from '../../utils/ignorePatterns.js';

/**
 * Role interface for workspace path and file-filtering concerns.
 *
 * Transcribed from the checker-based census in
 * `project-plans/issue2615/analysis/role-assignment.json` (P01).
 * Every member signature matches the concrete Config declaration exactly.
 */
export interface WorkspacePaths {
  getTargetDir(): string;
  getWorkspaceContext(): WorkspaceContext;
  getProjectRoot(): string;
  getProjectTempDir(): string;
  getWorkingDir(): string;
  getFileFilteringOptions(): FileFilteringOptions;
  getEnableRecursiveFileSearch(): boolean;
  getFileExclusions(): FileExclusions;
}
