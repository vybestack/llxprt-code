/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, CommandContext, SimpleMessageActionReturn } from './types.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { setProviderBaseUrl } from '../../providers/providerConfigUtils.js';
import { MessageType } from '../types.js';

export const baseurlCommand: SlashCommand = {
  name: 'baseurl',
  description: 'set base URL for the current provider',
  action: async (
    context: CommandContext,
    args: string
  ): Promise<SimpleMessageActionReturn> => {
    const providerManager = getProviderManager();
    const baseUrl = args?.trim();

    const result = await setProviderBaseUrl(
      providerManager,
      context.services.settings,
      baseUrl,
    );

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