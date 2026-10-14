/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  coreStorageServiceAdapter,
  getGlobalCoreMemoryFilePath,
  getProjectCoreMemoryFilePath,
  MemoryTool,
} from '@vybestack/llxprt-code-core';
import * as fs from 'fs/promises';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { MemoryCommandOperations } from './memoryCommand.js';

export function bindMemoryCommand(
  config: CliUiRuntime | null,
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
): MemoryCommandOperations {
  return {
    isConfigured: config !== null,
    getUserMemory: () => config?.getUserMemory() ?? '',
    getLlxprtMdFileCount: () => config?.getLlxprtMdFileCount() ?? 0,
    getLlxprtMdFilePaths: () => config?.getLlxprtMdFilePaths() ?? [],
    refreshMemory: async () => {
      if (!config) throw new Error('Memory runtime is unavailable');
      return config.refreshMemory();
    },
    updateSystemInstruction: async () => {
      if (!config) throw new Error('Memory runtime is unavailable');
      await config.updateSystemInstructionIfInitialized();
    },
    addItem,
    setMemoryFileCount,
    saveCoreMemory: async (scope, fact) => {
      const filePath =
        scope === 'core.project'
          ? getProjectCoreMemoryFilePath(
              config?.getWorkingDir() ?? process.cwd(),
            )
          : getGlobalCoreMemoryFilePath(coreStorageServiceAdapter);
      await MemoryTool.performAddMemoryEntry(fact, filePath, {
        readFile: fs.readFile,
        writeFile: fs.writeFile,
        mkdir: fs.mkdir,
      });
    },
  };
}
