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
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { setProviderApiKey } from '../../providers/providerConfigUtils.js';

export const keyCommand: SlashCommand = {
  name: 'key',
  description: 'set or remove API key for the current provider',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
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
      messageType: result.success ? 'info' : 'error',
      content: result.message,
    };
  },
};
