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
} from './types.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { MessageType } from '../types.js';
import { AuthType } from '@llxprt/core';

export const providerCommand: SlashCommand = {
  name: 'provider',
  description:
    'switch between different AI providers (openai, anthropic, etc.)',
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
        // Ensure provider manager is set on config
        context.services.config.setProviderManager(providerManager);

        // Update model to match the new provider's default
        const newModel =
          providerManager.getActiveProvider().getCurrentModel?.() || '';
        context.services.config.setModel(newModel);

        // Clear conversation history BEFORE switching to prevent tool call ID mismatches
        const geminiClient = context.services.config.getGeminiClient();
        if (geminiClient && geminiClient.isInitialized()) {
          await geminiClient.resetChat();
        }

        // Always refresh auth when switching providers
        let authType: AuthType;

        if (providerName === 'gemini') {
          // When switching TO Gemini, determine appropriate auth
          const currentAuthType =
            context.services.config.getContentGeneratorConfig()?.authType;

          // If we were using provider auth, switch to appropriate Gemini auth
          if (currentAuthType === AuthType.USE_PROVIDER || !currentAuthType) {
            if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
              authType = AuthType.USE_VERTEX_AI;
            } else if (process.env.GEMINI_API_KEY) {
              authType = AuthType.USE_GEMINI;
            } else {
              authType = AuthType.LOGIN_WITH_GOOGLE; // Default to OAuth
            }
          } else {
            // Keep existing Gemini auth type
            authType = currentAuthType;
          }
        } else {
          // When switching to non-Gemini provider
          authType = AuthType.USE_PROVIDER;

          // Show info about API key if needed
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Switched to ${providerName}. Use /key to set API key if needed.`,
            },
            Date.now(),
          );
        }

        // Refresh auth with the appropriate type
        await context.services.config.refreshAuth(authType);

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
