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
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { MessageType } from '../types.js';
import { AuthType } from '@vybestack/llxprt-code-core';

export const providerCommand: SlashCommand = {
  name: 'provider',
  description:
    'switch between different AI providers (openai, anthropic, etc.)',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<OpenDialogActionReturn | MessageActionReturn | void> => {
    const providerManager = getProviderManager();
    const providerName = args?.trim();

    if (!providerName) {
      // Open interactive provider selection dialog
      return {
        type: 'dialog',
        dialog: 'provider',
      };
    }

    try {
      const currentProvider = providerManager.getActiveProviderName();

      // Handle switching to same provider
      if (providerName === currentProvider) {
        return {
          type: 'message',
          messageType: 'info',
          content: `Already using provider: ${currentProvider}`,
        };
      }

      const fromProvider = currentProvider || 'none';

      // Use conversion context to track available models
      // const conversionContextJSON = {
      //   availableModels: await providerManager.getAllAvailableModels(),
      // };

      // Switch provider first (this will clear state from ALL providers)
      providerManager.setActiveProvider(providerName);

      // Update config if available
      if (context.services.config) {
        // Clear ephemeral settings when switching providers
        // Get current ephemeral settings and clear them one by one
        const ephemeralKeys = [
          'auth-key',
          'auth-keyfile',
          'base-url',
          'context-limit',
          'compression-threshold',
          'tool-format',
          'api-version',
          'custom-headers',
        ];
        for (const key of ephemeralKeys) {
          context.services.config.setEphemeralSetting(key, undefined);
        }

        // Clear model parameters on the new provider
        const newProvider = providerManager.getActiveProvider();
        if (newProvider.setModelParams) {
          newProvider.setModelParams({});
        }

        // Ensure provider manager is set on config
        context.services.config.setProviderManager(providerManager);

        // Update the provider in config
        context.services.config.setProvider(providerName);

        // Get the provider's default model - it should already be set since we just switched
        const activeProvider = providerManager.getActiveProvider();
        const defaultModel = activeProvider.getCurrentModel?.() || '';

        // Ensure the model is valid for this provider
        if (defaultModel) {
          context.services.config.setModel(defaultModel);
          // Also explicitly set it on the provider to be sure
          if (activeProvider.setModel) {
            activeProvider.setModel(defaultModel);
          }
        }

        // Clear conversation history BEFORE switching to prevent tool call ID mismatches
        const geminiClient = context.services.config.getGeminiClient();
        if (geminiClient && geminiClient.isInitialized()) {
          await geminiClient.resetChat();
        }

        // Keep the current auth type - auth only affects GeminiProvider internally
        const currentAuthType =
          context.services.config.getContentGeneratorConfig()?.authType ||
          AuthType.LOGIN_WITH_GOOGLE;

        // Refresh auth to ensure provider manager is attached
        await context.services.config.refreshAuth(currentAuthType);

        // Show info about API key if needed for non-Gemini providers
        if (providerName !== 'gemini') {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Switched to ${providerName}. Use /key to set API key if needed.`,
            },
            Date.now(),
          );
        }

        // Clear UI history to prevent tool call ID mismatches
        context.ui.clear();
      }

      // Trigger payment mode check if available
      const extendedContext = context as CommandContext & {
        checkPaymentModeChange?: (forcePreviousProvider?: string) => void;
      };
      if (extendedContext.checkPaymentModeChange) {
        setTimeout(
          () => extendedContext.checkPaymentModeChange!(fromProvider),
          100,
        );
      }

      return {
        type: 'message',
        messageType: 'info',
        content: `Switched from ${fromProvider} to ${providerName}`,
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
