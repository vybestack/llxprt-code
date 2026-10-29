/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryItemCompression } from '../types.js';
import { MessageType } from '../types.js';
import type { CommandContext, SlashCommand } from './types.js';
import { CommandKind } from './types.js';

export function makePendingCompression(): HistoryItemCompression {
  return {
    type: MessageType.COMPRESSION,
    compression: {
      isPending: true,
      originalTokenCount: null,
      newTokenCount: null,
      compressionStatus: null,
    },
  };
}

export function createCompressCommand(
  compress: (promptId: string) => Promise<HistoryItemCompression>,
): SlashCommand {
  return {
    name: 'compress',
    altNames: ['summarize'],
    description: 'Compresses the context by replacing it with a summary.',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async (context: Pick<CommandContext, 'ui'>) => {
      const { ui } = context;
      if (ui.pendingItem) {
        ui.addItem({
          type: MessageType.ERROR,
          text: 'Already compressing, wait for previous request to complete',
        });
        return;
      }

      try {
        ui.setPendingItem(makePendingCompression());
        const result = await compress(`compress-${Date.now()}`);
        ui.addItem(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ui.addItem({
          type: MessageType.ERROR,
          text:
            message === 'Chat instance not available for compression.'
              ? message
              : `Failed to compress chat history: ${message}`,
        });
      } finally {
        ui.setPendingItem(null);
      }
    },
  };
}
