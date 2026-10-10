/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

export function instructionFixture(
  memoryContent: string,
  coreMemory: string = '',
  globalMemory: string = memoryContent,
  jitMemory: string = '',
  environmentMemory: string = '',
): InstructionReadOperations {
  return {
    snapshot: () => ({
      memoryContent,
      coreMemory,
      globalMemory,
      environmentMemory,
      filePaths: [],
      fileCount: 0,
      coreMemoryFileCount: 0,
    }),
    jit: async () => jitMemory,
  };
}
