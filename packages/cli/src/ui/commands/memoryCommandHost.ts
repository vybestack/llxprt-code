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
  runtime: MemoryCommandRuntime,
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
): MemoryCommandOperations {
  return {
    isConfigured: true,
    getUserMemory: runtime.getUserMemory.bind(runtime),
    getLlxprtMdFileCount: runtime.getLlxprtMdFileCount.bind(runtime),
    getLlxprtMdFilePaths: runtime.getLlxprtMdFilePaths.bind(runtime),
    refreshMemory: () => runtime.refreshMemory(),
    updateSystemInstruction: async () => {
      await runtime.updateSystemInstructionIfInitialized();
    },
    addItem,
    setMemoryFileCount,
    saveCoreMemory: async (scope, fact) => {
      const filePath =
        scope === 'core.project'
          ? getProjectCoreMemoryFilePath(runtime.getWorkingDir())
          : getGlobalCoreMemoryFilePath(coreStorageServiceAdapter);
      await MemoryTool.performAddMemoryEntry(fact, filePath, {
        readFile: fs.readFile,
        writeFile: fs.writeFile,
        mkdir: fs.mkdir,
      });
    },
  };
}
