/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyToClipboard } from '../utils/commandUtils.js';
import {
  CommandKind,
  type SlashCommand,
  type SlashCommandActionReturn,
} from './types.js';
import type { Part, Content } from '@google/genai';
import { debugLogger } from '@vybestack/llxprt-code-core';

export const copyCommand: SlashCommand = {
  name: 'copy',
  description: 'Copy the last result or code snippet to clipboard',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, _args): Promise<SlashCommandActionReturn | void> => {
    const client = context.services.config?.getGeminiClient();

    // Check if chat is initialized before accessing it
    if (!client?.hasChatInitialized()) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No chat history available yet',
      };
    }

    const chat = client.getChat();
    const history = chat?.getHistory();

    // Get the last message from the AI (model role)
    const lastAiMessage = history
      ? history.filter((item: Content) => item.role === 'model').pop()
      : undefined;

    if (lastAiMessage == null) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No output in history',
      };
    }
    // Extract text from the parts
    const lastAiOutput = lastAiMessage.parts
      ?.filter((part: Part) => part.text)
      .map((part: Part) => part.text)
      .join('');

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
