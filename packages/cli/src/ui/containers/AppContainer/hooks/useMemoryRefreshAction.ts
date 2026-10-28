/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { getErrorMessage } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { type HistoryItem, MessageType } from '../../../types.js';
import type { RefreshMemoryResult } from '../../../cliUiRuntime.js';
import type { LoadedSettings } from '../../../../config/settings.js';
interface UseMemoryRefreshActionParams {
  refreshMemory: () => Promise<RefreshMemoryResult>;
  readDebugMode: () => boolean;
  settings: LoadedSettings;
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => number;
  setLlxprtMdFileCount: (fileCount: number) => void;
}

export function useMemoryRefreshAction({
  refreshMemory,
  readDebugMode,
  addItem,
  setLlxprtMdFileCount,
}: UseMemoryRefreshActionParams): () => Promise<void> {
  return useCallback(async () => {
    addItem(
      {
        type: MessageType.INFO,
        text: 'Refreshing hierarchical memory (LLXPRT.md or other context files)...',
      },
      Date.now(),
    );

    try {
      const { memoryContent, fileCount } = await refreshMemory();

      setLlxprtMdFileCount(fileCount);

      addItem(
        {
          type: MessageType.INFO,
          text: `Memory refreshed successfully. ${memoryContent.length > 0 ? `Loaded ${memoryContent.length} characters from ${fileCount} file(s).` : 'No memory content found.'}`,
        },
        Date.now(),
      );

      if (readDebugMode()) {
        debugLogger.log(
          `[DEBUG] Refreshed memory content in config (${memoryContent.length} chars from ${fileCount} file(s))`,
        );
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      addItem(
        {
          type: MessageType.ERROR,
          text: `Error refreshing memory: ${errorMessage}`,
        },
        Date.now(),
      );
      debugLogger.error('Error refreshing memory:', error);
    }
    // settings.merged reference changes when any setting changes, so this dep is correct.
  }, [refreshMemory, readDebugMode, addItem, setLlxprtMdFileCount]);
}
