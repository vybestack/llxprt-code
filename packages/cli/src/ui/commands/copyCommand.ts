/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type { SlashCommand, SlashCommandActionReturn } from './types.js';
import { CommandKind } from './types.js';

export type CopyCommandOutput =
  | { readonly kind: 'no-chat' }
  | { readonly kind: 'no-output' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'text'; readonly text: string };

export type CopyCommand = Omit<SlashCommand, 'action'> & {
  action: () => Promise<SlashCommandActionReturn>;
};

export function createCopyCommand(
  readLatestAiOutput: () => Promise<CopyCommandOutput>,
  copyToClipboard: (text: string) => Promise<void>,
): CopyCommand {
  return {
    name: 'copy',
    description: 'Copy the last result or code snippet to clipboard',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async (): Promise<SlashCommandActionReturn> => {
      const output = await readLatestAiOutput();
      if (output.kind === 'no-chat') {
        return {
          type: 'message',
          messageType: 'info',
          content: 'No chat history available yet',
        };
      }
      if (output.kind === 'no-output') {
        return {
          type: 'message',
          messageType: 'info',
          content: 'No output in history',
        };
      }
      if (output.kind === 'empty') {
        return {
          type: 'message',
          messageType: 'info',
          content: 'Last AI output contains no text to copy.',
        };
      }

      try {
        await copyToClipboard(output.text);
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
    },
  };
}
