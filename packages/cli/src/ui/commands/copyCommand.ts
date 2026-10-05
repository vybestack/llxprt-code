/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyToClipboard } from '../utils/commandUtils.js';
import type { SlashCommand, SlashCommandActionReturn } from './types.js';
import { CommandKind } from './types.js';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';

export const copyCommand: SlashCommand = {
  name: 'copy',
  description: 'Copy the last result or code snippet to clipboard',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, _args): Promise<SlashCommandActionReturn | void> => {
    const client = context.services.config?.getAgentClient();

    // Check if chat is initialized before accessing it
    if (client == null || client.hasChatInitialized() !== true) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No chat history available yet',
      };
    }

    let lastAiOutput: string | undefined;
    for await (const item of client.getChat().streamHistory(context.signal)) {
      if (item.speaker !== 'ai') continue;
      lastAiOutput = '';
      for (const block of item.blocks) {
        if (block.type === 'text') lastAiOutput += block.text;
      }
    }
    context.signal.throwIfAborted();

    if (lastAiOutput === undefined) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No output in history',
      };
    }
    if (lastAiOutput) {
      try {
        await copyToClipboard(lastAiOutput);

        return {
          type: 'message',
          messageType: 'info',
          content: 'Last output copied to the clipboard',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debugLogger.debug(message);

        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to copy to the clipboard. ${message}`,
        };
      }
    } else {
      return {
        type: 'message',
        messageType: 'info',
        content: 'Last AI output contains no text to copy.',
      };
    }
  },
};
