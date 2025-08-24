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
import { getOAuthManager } from '../../providers/providerManagerInstance.js';

export const logoutCommand: SlashCommand = {
  name: 'logout',
  description:
    'logout from OAuth authentication for a provider (gemini, qwen, anthropic)',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const provider = args?.trim();

    // If no provider specified, show error
    if (!provider) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Please specify a provider to logout from: /logout <provider>\nSupported providers: gemini, qwen, anthropic',
      };
    }

    try {
      const oauthManager = getOAuthManager();
      if (!oauthManager) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'OAuth manager not available. Please try again.',
        };
      }

      // Check if provider is supported
      const supportedProviders = oauthManager.getSupportedProviders();
      if (!supportedProviders.includes(provider)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Unknown provider: ${provider}. Supported providers: ${supportedProviders.join(', ')}`,
        };
      }

      // Check if user is authenticated
      const isAuthenticated = await oauthManager.isAuthenticated(provider);

      // Perform logout regardless of authentication status to clean up any stale tokens
      await oauthManager.logout(provider);

      if (isAuthenticated) {
        return {
          type: 'message',
          messageType: 'info',
          content: `Successfully logged out of ${provider}`,
        };
      } else {
        // User wasn't authenticated but we cleaned up any stale tokens
        return {
          type: 'message',
          messageType: 'info',
          content: `Cleaned up authentication state for ${provider} (was not authenticated)`,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to logout from ${provider}: ${errorMessage}`,
      };
    }
  },
};
