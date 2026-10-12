/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bun-test-free IToolHost stub for the ast_read_file suites.
 *
 * This module deliberately imports nothing from `bun:test` so that child
 * processes (for example the memory-regression fixture) can construct the
 * exact same host as the in-process tests instead of duplicating the stub.
 */

import { physicalFiles } from '../../../__tests__/helpers/physical-files.js';

import type { IToolHost } from '../../../interfaces/IToolHost.js';

/** Build the minimal real IToolHost used by every ast_read_file fixture. */
export function createAstReadToolHost(targetDir: string): IToolHost {
  return {
    ...physicalFiles,
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,

    runSearch: <T>(
      _directories: readonly string[],
      operation: () => Promise<T>,
    ): Promise<T> => operation(),
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths: string[]) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getLlxprtIgnorePatterns: () => [],
    readExecutionPolicy: () => ({}),
    getDebugMode: () => false,
  };
}
