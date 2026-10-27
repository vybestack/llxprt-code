/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import {
  getErrorMessage,
  type HistoryService,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { type HistoryItemWithoutId, MessageType } from '../../../types.js';
import type { AppStateRuntime, MemoryState } from '../../../cliUiRuntime.js';
import { writeCommandOutput } from '../../../hooks/command-journal-output.js';

type MemoryRefreshRuntime = Pick<MemoryState, 'refreshMemory'> &
  Pick<AppStateRuntime, 'getDebugMode'>;

interface UseMemoryRefreshActionParams {
  config: MemoryRefreshRuntime;
  addItem: Parameters<typeof writeCommandOutput>[3];
  readHistory: () => HistoryService | null;
  origin: Parameters<HistoryService['appendDisplay']>[2];
  recordingOwner: 'agent' | undefined;
  setLlxprtMdFileCount: (fileCount: number) => void;
}

export function useMemoryRefreshAction({
  config,
  addItem,
  readHistory,
  origin,
  recordingOwner,
  setLlxprtMdFileCount,
}: UseMemoryRefreshActionParams): () => Promise<void> {
  return useCallback(async () => {
    const writeItem = (item: HistoryItemWithoutId): Promise<void> =>
      writeCommandOutput(
        readHistory,
        origin,
        recordingOwner,
        addItem,
        item,
        Date.now(),
      );
    await writeItem({
      type: MessageType.INFO,
      text: 'Refreshing hierarchical memory (LLXPRT.md or other context files)...',
    });
    let output: HistoryItemWithoutId;
    try {
      const { memoryContent, fileCount } = await config.refreshMemory();
      setLlxprtMdFileCount(fileCount);
      output = {
        type: MessageType.INFO,
        text: `Memory refreshed successfully. ${memoryContent.length > 0 ? `Loaded ${memoryContent.length} characters from ${fileCount} file(s).` : 'No memory content found.'}`,
      };
      if (config.getDebugMode()) {
        debugLogger.log(
          `[DEBUG] Refreshed memory content in config (${memoryContent.length} chars from ${fileCount} file(s))`,
        );
      }
    } catch (error) {
      output = {
        type: MessageType.ERROR,
        text: `Error refreshing memory: ${getErrorMessage(error)}`,
      };
      debugLogger.error('Error refreshing memory:', error);
    }
    await writeItem(output);
  }, [
    config,
    addItem,
    readHistory,
    origin,
    recordingOwner,
    setLlxprtMdFileCount,
  ]);
}
