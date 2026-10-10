import { promises as fixtureFs } from 'node:fs';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileDiscoveryService } from '@vybestack/llxprt-code-storage';
import type {
  IToolHost,
  IToolHostFileFilteringOptions,
} from '../../interfaces/index.js';

export function createRealToolHost(
  targetDir: string,
  defaultFiltering: IToolHostFileFilteringOptions,
): IToolHost {
  const fileService = new FileDiscoveryService(targetDir);
  return {
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    runSearch: <T>(
      _directories: readonly string[],
      operation: () => Promise<T>,
    ): Promise<T> => operation(),
    getFileService: () => fileService,
    getFileFilteringOptions: () => ({ ...defaultFiltering }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () =>
      defaultFiltering.respectLlxprtIgnore,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    readTextFile: (filePath) => fixtureFs.readFile(filePath, 'utf8'),
    writeTextFile: (filePath, content) =>
      fixtureFs.writeFile(filePath, content),
    getLlxprtIgnorePatterns: () => fileService.getLlxprtIgnorePatterns(),
    readExecutionPolicy: () => ({
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 50000,
      'tool-output-item-size-limit': 524288,
    }),
    getDebugMode: () => false,
  };
}
