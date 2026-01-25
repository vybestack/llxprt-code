/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CompressionStatus } from '@vybestack/llxprt-code-core';
import { HistoryItemCompression, MessageType } from '../types.js';
import { CommandKind, SlashCommand } from './types.js';

export const compressCommand: SlashCommand = {
  name: 'compress',
  altNames: ['summarize'],
  description: 'Compresses the context by replacing it with a summary.',
  kind: CommandKind.BUILT_IN,
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
      const chat = context.services.config?.getGeminiClient()?.getChat();
      const historyService = chat?.getHistoryService();
      if (!chat || !historyService) {
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
      await chat.performCompression(promptId);
      const newTokenCount = historyService.getTotalTokens();
      const compressionResult: HistoryItemCompression = {
        type: MessageType.COMPRESSION,
        compression: {
          isPending: false,
          originalTokenCount,
          newTokenCount,
          compressionStatus: CompressionStatus.COMPRESSED,
        },
      };
      ui.addItem(compressionResult, Date.now());
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
