/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Message } from '../types.js';
import { MessageType } from '../types.js';

import type { LoadedSettings } from '../../config/settings.js';
import type { MemoryState } from '../cliUiRuntime.js';

export function createShowMemoryAction(
  memory: MemoryState | null,
  settings: LoadedSettings,
  addMessage: (message: Message) => void,
) {
  return async () => {
    if (!memory) {
      addMessage({
        type: MessageType.ERROR,
        content: 'Memory state is not available. Cannot show memory.',
        timestamp: new Date(),
      });
      return;
    }

    const currentMemory = memory.getUserMemory();
    const fileCount = memory.getLlxprtMdFileCount();
    const contextFileName = settings.merged.ui.contextFileName;
    const contextFileNames = Array.isArray(contextFileName)
      ? contextFileName
      : [contextFileName];

    if (fileCount > 0) {
      const allNamesTheSame = new Set(contextFileNames).size < 2;
      const name = allNamesTheSame ? contextFileNames[0] : 'context';
      addMessage({
        type: MessageType.INFO,
        content: `Loaded memory from ${fileCount} ${name} file${
          fileCount > 1 ? 's' : ''
        }.`,
        timestamp: new Date(),
      });
    }

    if (currentMemory && currentMemory.trim().length > 0) {
      addMessage({
        type: MessageType.INFO,
        content: `Current combined memory content:\n\`\`\`markdown\n${currentMemory}\n\`\`\``,
        timestamp: new Date(),
      });
    } else {
      addMessage({
        type: MessageType.INFO,
        content:
          fileCount > 0
            ? 'Hierarchical memory (LLXPRT.md or other context files) is loaded but content is empty.'
            : 'No hierarchical memory (LLXPRT.md or other context files) is currently loaded.',
        timestamp: new Date(),
      });
    }
  };
}
