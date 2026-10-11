/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core';

export const emptyInstructionReads: InstructionReadOperations = {
  snapshot: () => ({
    globalMemory: '',
    environmentMemory: '',
    coreMemory: '',
    memoryContent: '',
    filePaths: [],
    fileCount: 0,
    coreMemoryFileCount: 0,
  }),
  jit: async () => '',
};
