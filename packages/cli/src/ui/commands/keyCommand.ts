/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  CommandKind,
} from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';

export const keyCommand: SlashCommand = {
  name: 'key',
  description: 'set or remove API key for the current provider',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const apiKey = args?.trim();
    const runtime = getRuntimeApi();
    try {
      const targetKey =
        !apiKey || apiKey.toLowerCase() === 'none' ? null : apiKey;
      const result = await runtime.updateActiveProviderApiKey(targetKey);

      const extendedContext = context as CommandContext & {
        checkPaymentModeChange?: () => void;
      };
      if (extendedContext.checkPaymentModeChange) {
        setTimeout(extendedContext.checkPaymentModeChange, 100);
      }

      return {
        type: 'message',
        messageType: 'info',
        content: result.message,
      };
    } catch (error) {
      const status = runtime.getActiveProviderStatus();
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to update API key for provider '${status.providerName ?? 'unknown'}': ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
