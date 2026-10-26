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
import type { MemoryCommandOperations } from './memoryCommand.js';

/**
 * The memory operations the /memory command family reads. Sized to this
 * consumer only; the composition root supplies it from the UI runtime.
 */
export interface MemoryCommandRuntime {
  getUserMemory(): string;
  getLlxprtMdFileCount(): number;
  getLlxprtMdFilePaths(): string[];
  refreshMemory(): Promise<{ memoryContent: string; fileCount: number }>;
  updateSystemInstructionIfInitialized(): void | Promise<void>;
  getWorkingDir(): string;
}

export function bindMemoryCommand(
  runtime: MemoryCommandRuntime | null,
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
): MemoryCommandOperations {
  return {
    isConfigured: runtime !== null,
    getUserMemory: () => runtime?.getUserMemory() ?? '',
    getLlxprtMdFileCount: () => runtime?.getLlxprtMdFileCount() ?? 0,
    getLlxprtMdFilePaths: () => runtime?.getLlxprtMdFilePaths() ?? [],
    refreshMemory: async () => {
      if (!runtime) throw new Error('Memory runtime is unavailable');
      return runtime.refreshMemory();
    },
    updateSystemInstruction: async () => {
      if (!runtime) throw new Error('Memory runtime is unavailable');
      await runtime.updateSystemInstructionIfInitialized();
    },
    addItem,
    setMemoryFileCount,
    saveCoreMemory: async (scope, fact) => {
      const filePath =
        scope === 'core.project'
          ? getProjectCoreMemoryFilePath(
              runtime?.getWorkingDir() ?? process.cwd(),
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
