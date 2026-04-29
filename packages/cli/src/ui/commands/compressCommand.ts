/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CompressionStatus,
  PerformCompressionResult,
} from '@vybestack/llxprt-code-core';
import type { HistoryItemCompression } from '../types.js';
import { MessageType } from '../types.js';
import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';

export const compressCommand: SlashCommand = {
  name: 'compress',
  altNames: ['summarize'],
  description: 'Compresses the context by replacing it with a summary.',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    const { ui } = context;
    if (ui.pendingItem) {
      ui.addItem(
        {
          type: MessageType.ERROR,
          text: 'Already compressing, wait for previous request to complete',
        },
        Date.now(),
      );
      return;
    }

    const pendingMessage: HistoryItemCompression = {
      type: MessageType.COMPRESSION,
      compression: {
        isPending: true,
        originalTokenCount: null,
        newTokenCount: null,
        compressionStatus: null,
      },
    };

    try {
      ui.setPendingItem(pendingMessage);
      const promptId = `compress-${Date.now()}`;
      const geminiClient = context.services.config?.getGeminiClient();
      if (!geminiClient?.hasChatInitialized()) {
        ui.addItem(
          {
            type: MessageType.ERROR,
            text: 'Chat instance not available for compression.',
          },
          Date.now(),
        );
        return;
      }
      const chat = geminiClient.getChat();
      const getHistoryService = (): ReturnType<
        typeof chat.getHistoryService
      > | null => chat.getHistoryService();
      const historyService = getHistoryService();
      if (!historyService) {
        ui.addItem(
          {
            type: MessageType.ERROR,
            text: 'Chat instance not available for compression.',
          },
          Date.now(),
        );
        return;
      }
      const originalTokenCount = historyService.getTotalTokens();
      const wasRecentlyCompressedBeforeCommand = chat.wasRecentlyCompressed();
      const result = await chat.performCompression(promptId);
      const newTokenCount = historyService.getTotalTokens();

      let compressionStatus: CompressionStatus;
      switch (result) {
        case PerformCompressionResult.FAILED:
        case PerformCompressionResult.SKIPPED_COOLDOWN:
          compressionStatus = CompressionStatus.COMPRESSION_FAILED;
          break;
        case PerformCompressionResult.SKIPPED_EMPTY:
          compressionStatus = CompressionStatus.NOOP;
          break;
        case PerformCompressionResult.COMPRESSED:
          if (newTokenCount < originalTokenCount) {
            compressionStatus = CompressionStatus.COMPRESSED;
          } else if (newTokenCount > originalTokenCount) {
            compressionStatus =
              CompressionStatus.COMPRESSION_FAILED_INFLATED_TOKEN_COUNT;
          } else if (wasRecentlyCompressedBeforeCommand) {
            compressionStatus = CompressionStatus.ALREADY_COMPRESSED;
          } else {
            compressionStatus = CompressionStatus.NOOP;
          }
          break;
        default:
          compressionStatus = CompressionStatus.NOOP;
      }
      const compressionResult: HistoryItemCompression = {
        type: MessageType.COMPRESSION,
        compression: {
          isPending: false,
          originalTokenCount,
          newTokenCount,
          compressionStatus,
        },
      };
      ui.addItem(compressionResult);
    } catch (e) {
      ui.addItem(
        {
          type: MessageType.ERROR,
          text: `Failed to compress chat history: ${
            e instanceof Error ? e.message : String(e)
          }`,
        },
        Date.now(),
      );
    } finally {
      ui.setPendingItem(null);
    }
  },
};
