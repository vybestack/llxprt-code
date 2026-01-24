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
      const originalTokenCount = historyService?.getTotalTokens() ?? 0;
      await chat?.performCompression(promptId);
      const newTokenCount = historyService?.getTotalTokens() ?? 0;
      ui.addItem(
        {
          type: MessageType.COMPRESSION,
          compression: {
            isPending: false,
            originalTokenCount,
            newTokenCount,
            compressionStatus: CompressionStatus.COMPRESSED,
          },
        } as HistoryItemCompression,
        Date.now(),
      );
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
