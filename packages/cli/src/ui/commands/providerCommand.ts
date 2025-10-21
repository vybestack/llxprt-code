/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  OpenDialogActionReturn,
  MessageActionReturn,
  CommandKind,
} from './types.js';
import { MessageType } from '../types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';

export const providerCommand: SlashCommand = {
  name: 'provider',
  description:
    'switch between different AI providers (openai, anthropic, etc.)',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<OpenDialogActionReturn | MessageActionReturn | void> => {
    const providerName = args?.trim();

    if (!providerName) {
      // Open interactive provider selection dialog
      return {
        type: 'dialog',
        dialog: 'provider',
      };
    }

    try {
      const runtime = getRuntimeApi();
      const result = await runtime.switchActiveProvider(providerName);

      if (!result.changed) {
        return {
          type: 'message',
          messageType: 'info',
          content: `Already using provider: ${result.nextProvider}`,
        };
      }

      for (const info of result.infoMessages) {
        if (context.ui?.addItem) {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: info,
            },
            Date.now(),
          );
        }
      }

      // Trigger payment mode check if available
      const extendedContext = context as CommandContext & {
        checkPaymentModeChange?: (forcePreviousProvider?: string) => void;
      };
      if (extendedContext.checkPaymentModeChange) {
        setTimeout(
          () =>
            extendedContext.checkPaymentModeChange!(
              result.previousProvider ?? undefined,
            ),
          100,
        );
      }

      return {
        type: 'message',
        messageType: 'info',
        content: `Switched from ${result.previousProvider ?? 'none'} to ${result.nextProvider}`,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to switch provider: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
