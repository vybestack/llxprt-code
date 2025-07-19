/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, CommandContext, SimpleMessageActionReturn } from './types.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { setProviderApiKey } from '../../providers/providerConfigUtils.js';
import { MessageType } from '../types.js';

export const keyCommand: SlashCommand = {
  name: 'key',
  description: 'set or remove API key for the current provider',
  action: async (
    context: CommandContext,
    args: string
  ): Promise<SimpleMessageActionReturn> => {
    const providerManager = getProviderManager();
    const apiKey = args?.trim();

    const result = await setProviderApiKey(
      providerManager,
      context.services.settings,
      apiKey,
      context.services.config ?? undefined,
    );

    // Trigger payment mode check if available and successful
    if (result.success) {
      const extendedContext = context as CommandContext & {
        checkPaymentModeChange?: () => void;
      };
      if (extendedContext.checkPaymentModeChange) {
        setTimeout(extendedContext.checkPaymentModeChange, 100);
      }
    }

    return {
      type: 'message',
      message: {
        type: result.success ? MessageType.INFO : MessageType.ERROR,
        content: result.message,
        timestamp: new Date(),
      },
    };
  },
};