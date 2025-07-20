/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, CommandContext, MessageActionReturn } from './types.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { setProviderBaseUrl } from '../../providers/providerConfigUtils.js';

export const baseurlCommand: SlashCommand = {
  name: 'baseurl',
  description: 'set base URL for the current provider',
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const providerManager = getProviderManager();
    const baseUrl = args?.trim();

    const result = await setProviderBaseUrl(
      providerManager,
      context.services.settings,
      baseUrl,
    );

    return {
      type: 'message',
      messageType: result.success ? 'info' : 'error',
      content: result.message,
    };
  },
};
