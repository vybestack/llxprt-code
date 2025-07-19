/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, CommandContext, OpenDialogActionReturn, SimpleMessageActionReturn } from './types.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { MessageType } from '../types.js';
import { AuthType } from '@vybestack/llxprt-code-core';

export const providerCommand: SlashCommand = {
  name: 'provider',
  description: 'switch between different AI providers (openai, anthropic, etc.)',
  action: async (
    context: CommandContext,
    args: string
  ): Promise<OpenDialogActionReturn | SimpleMessageActionReturn | void> => {
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
          message: {
            type: MessageType.INFO,
            content: `Already using provider: ${currentProvider}`,
            timestamp: new Date(),
          },
        };
      }

      const fromProvider = currentProvider || 'none';

      // Use conversion context to track available models
      const conversionContextJSON = {
        availableModels: await providerManager.getAllAvailableModels(),
      };

      // Switch provider
      providerManager.setActiveProvider(providerName);

      // Update config if available
      if (context.services.config) {
        context.services.config.setModel(
          providerManager.getActiveProvider().getCurrentModel?.() || ''
        );

        // Use provider auth for non-gemini providers
        if (providerName !== 'gemini') {
          const activeProvider = providerManager.getActiveProvider();
          const hasValidKey = await activeProvider.isConfigured?.();
          if (!hasValidKey) {
            context.ui.addItem({
              type: 'message',
              messages: [{
                type: MessageType.WARNING,
                content: `No API key configured for ${providerName}. Use /key to set one.`,
                timestamp: new Date(),
              }],
            });
          }
        }

        // Refresh auth if switching to/from gemini
        if (
          (fromProvider === 'gemini' && providerName !== 'gemini') ||
          (fromProvider !== 'gemini' && providerName === 'gemini')
        ) {
          await context.services.config.refreshAuth(AuthType.USE_PROVIDER);
        }
      }

      // Trigger payment mode check if available
      const extendedContext = context as CommandContext & {
        checkPaymentModeChange?: (forcePreviousProvider?: string) => void;
      };
      if (extendedContext.checkPaymentModeChange) {
        setTimeout(() => extendedContext.checkPaymentModeChange!(fromProvider), 100);
      }

      return {
        type: 'message',
        message: {
          type: MessageType.INFO,
          content: `Switched from ${fromProvider} to ${providerName}`,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        type: 'message',
        message: {
          type: MessageType.ERROR,
          content: `Failed to switch provider: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        },
      };
    }
  },
};