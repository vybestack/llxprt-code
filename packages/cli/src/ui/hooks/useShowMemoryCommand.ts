/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message, MessageType } from '../types.js';
import { Config } from '@vybestack/llxprt-code-core';
import { LoadedSettings } from '../../config/settings.js';

export function createShowMemoryAction(
  config: Config | null,
  settings: LoadedSettings,
  addMessage: (message: Message) => void,
) {
  return async () => {
    if (!config) {
      addMessage({
        type: MessageType.ERROR,
        content: 'Configuration not available. Cannot show memory.',
        timestamp: new Date(),
      });
      return;
    }

    const currentMemory = config.getUserMemory();
    const fileCount = config.getLlxprtMdFileCount();
    const contextFileName = settings.merged.contextFileName;
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
