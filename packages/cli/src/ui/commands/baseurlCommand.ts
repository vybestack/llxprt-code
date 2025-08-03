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

export const baseurlCommand: SlashCommand = {
  name: 'baseurl',
  description: 'set base URL for the current provider',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const config = context.services.config;
    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No configuration available',
      };
    }

    const providerManager = config.getProviderManager();
    if (!providerManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No provider manager available',
      };
    }

    const activeProvider = providerManager.getActiveProvider();
    const providerName = activeProvider.name;
    const baseUrl = args?.trim();

    if (!baseUrl || baseUrl === '') {
      // Clear base URL to provider default
      if (activeProvider.setBaseUrl) {
        activeProvider.setBaseUrl(undefined);
        config.setEphemeralSetting('base-url', undefined);

        return {
          type: 'message',
          messageType: 'info',
          content: `Base URL cleared, provider '${providerName}' now uses default URL`,
        };
      } else {
        return {
          type: 'message',
          messageType: 'error',
          content: `Provider '${providerName}' does not support base URL updates`,
        };
      }
    }

    // Update the provider's base URL
    if (activeProvider.setBaseUrl) {
      activeProvider.setBaseUrl(baseUrl);
      config.setEphemeralSetting('base-url', baseUrl);

      return {
        type: 'message',
        messageType: 'info',
        content: `Base URL updated to '${baseUrl}' for provider '${providerName}'`,
      };
    } else {
      return {
        type: 'message',
        messageType: 'error',
        content: `Provider '${providerName}' does not support base URL updates`,
      };
    }
  },
};
