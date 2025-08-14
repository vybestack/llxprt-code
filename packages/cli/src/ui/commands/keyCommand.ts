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
import { AuthType } from '@vybestack/llxprt-code-core';

export const keyCommand: SlashCommand = {
  name: 'key',
  description: 'set or remove API key for the current provider',
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

    const settingsService = config.getSettingsService();
    const useSettingsService = settingsService !== null;

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
    const apiKey = args?.trim();

    // If no key provided or 'none', remove the key
    if (!apiKey || apiKey.toLowerCase() === 'none') {
      // Clear the API key
      if (activeProvider.setApiKey) {
        activeProvider.setApiKey('');

        if (useSettingsService && settingsService) {
          // Use SettingsService to update provider settings
          try {
            await settingsService.updateSettings(providerName, {
              apiKey: undefined,
            });
          } catch (error) {
            console.error('SettingsService error, using fallback:', error);
            config.setEphemeralSetting('auth-key', undefined);
          }
        } else {
          // Fallback to direct ephemeral setting
          config.setEphemeralSetting('auth-key', undefined);
        }

        // If this is the Gemini provider, we might need to switch auth mode
        const requiresAuthRefresh = providerName === 'gemini';
        if (requiresAuthRefresh) {
          await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);
        }

        const isPaidMode = activeProvider.isPaidMode?.() ?? true;
        const paymentMessage =
          !isPaidMode && providerName === 'gemini'
            ? '\n✅ You are now in FREE MODE - using OAuth authentication'
            : '';

        return {
          type: 'message',
          messageType: 'info',
          content: `API key removed for provider '${providerName}'${paymentMessage}`,
        };
      } else {
        return {
          type: 'message',
          messageType: 'error',
          content: `Provider '${providerName}' does not support API key updates`,
        };
      }
    }

    // Set the API key
    if (activeProvider.setApiKey) {
      activeProvider.setApiKey(apiKey);

      if (useSettingsService && settingsService) {
        // Use SettingsService to update provider settings
        try {
          await settingsService.updateSettings(providerName, { apiKey });
        } catch (error) {
          console.error('SettingsService error, using fallback:', error);
          config.setEphemeralSetting('auth-key', apiKey);
        }
      } else {
        // Fallback to direct ephemeral setting
        config.setEphemeralSetting('auth-key', apiKey);
      }

      // If this is the Gemini provider, we need to refresh auth to use API key mode
      const requiresAuthRefresh = providerName === 'gemini';
      if (requiresAuthRefresh) {
        await config.refreshAuth(AuthType.USE_GEMINI);
      }

      // Check if we're now in paid mode
      const isPaidMode = activeProvider.isPaidMode?.() ?? true;
      const paymentWarning = isPaidMode
        ? '\nWARNING: You are now in PAID MODE - API usage will be charged to your account'
        : '';

      // Trigger payment mode check if available
      const extendedContext = context as CommandContext & {
        checkPaymentModeChange?: () => void;
      };
      if (extendedContext.checkPaymentModeChange) {
        setTimeout(extendedContext.checkPaymentModeChange, 100);
      }

      return {
        type: 'message',
        messageType: 'info',
        content: `API key updated for provider '${providerName}'${paymentWarning}`,
      };
    } else {
      return {
        type: 'message',
        messageType: 'error',
        content: `Provider '${providerName}' does not support API key updates`,
      };
    }
  },
};
