/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CommandKind,
  SlashCommand,
  CommandContext,
  SlashCommandActionReturn,
  MessageActionReturn,
  OpenDialogActionReturn,
} from './types.js';
import { OAuthManager } from '../../auth/oauth-manager.js';
import { MultiProviderTokenStore } from '@vybestack/llxprt-code-core';
import { QwenOAuthProvider } from '../../auth/qwen-oauth-provider.js';
import { GeminiOAuthProvider } from '../../auth/gemini-oauth-provider.js';
import { AnthropicOAuthProvider } from '../../auth/anthropic-oauth-provider.js';

export class AuthCommandExecutor {
  constructor(private oauthManager: OAuthManager) {}

  async execute(
    context: CommandContext,
    args?: string,
  ): Promise<SlashCommandActionReturn> {
    const parts = args?.trim().split(/\s+/) || [];
    const provider = parts[0];
    const action = parts[1];

    // If no provider specified, show OAuth menu
    if (!provider) {
      return this.showOAuthMenu();
    }

    // If no action specified, show status for the provider
    if (!action) {
      return this.showProviderStatus(provider);
    }

    // Handle enable/disable actions
    if (action === 'enable' || action === 'disable') {
      return this.setProviderOAuth(provider, action === 'enable');
    }

    // Invalid action
    return {
      type: 'message',
      messageType: 'error',
      content: `Invalid action: ${action}. Use 'enable' or 'disable'`,
    };
  }

  private async showOAuthMenu(): Promise<OpenDialogActionReturn> {
    // Return dialog action to show OAuth authentication dialog
    return {
      type: 'dialog',
      dialog: 'auth',
    };
  }

  private async showProviderStatus(
    provider: string,
  ): Promise<MessageActionReturn> {
    try {
      // Check if provider is supported
      const supportedProviders = this.oauthManager.getSupportedProviders();
      if (!supportedProviders.includes(provider)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Unknown provider: ${provider}. Supported providers: ${supportedProviders.join(', ')}`,
        };
      }

      // Get current OAuth status
      const isEnabled = this.oauthManager.isOAuthEnabled(provider);
      const isAuthenticated = await this.oauthManager.isAuthenticated(provider);

      let status = `OAuth for ${provider}: ${isEnabled ? 'ENABLED' : 'DISABLED'}`;
      if (isEnabled && isAuthenticated) {
        status += ' (authenticated)';
      } else if (isEnabled && !isAuthenticated) {
        status += ' (not authenticated)';
      }

      // Check for higher priority auth
      const higherPriorityAuth =
        await this.oauthManager.getHigherPriorityAuth(provider);
      if (higherPriorityAuth) {
        status += `\nNote: ${higherPriorityAuth} will take precedence`;
      }

      return {
        type: 'message',
        messageType: 'info',
        content: status,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to get status for ${provider}: ${errorMessage}`,
      };
    }
  }

  private async setProviderOAuth(
    provider: string,
    enable: boolean,
  ): Promise<MessageActionReturn> {
    try {
      // Check if provider is supported
      const supportedProviders = this.oauthManager.getSupportedProviders();
      if (!supportedProviders.includes(provider)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Unknown provider: ${provider}. Supported providers: ${supportedProviders.join(', ')}`,
        };
      }

      // Check current state
      const currentlyEnabled = this.oauthManager.isOAuthEnabled(provider);

      // If already in desired state, just report it
      if (currentlyEnabled === enable) {
        return {
          type: 'message',
          messageType: 'info',
          content: `OAuth for ${provider} is already ${enable ? 'enabled' : 'disabled'}`,
        };
      }

      // Toggle to achieve desired state
      await this.oauthManager.toggleOAuthEnabled(provider);

      // Check for higher priority auth warning
      const higherPriorityAuth =
        await this.oauthManager.getHigherPriorityAuth(provider);
      const baseMessage = `OAuth ${enable ? 'enabled' : 'disabled'} for ${provider}`;

      if (enable && higherPriorityAuth) {
        return {
          type: 'message',
          messageType: 'info',
          content: `${baseMessage} (Note: ${higherPriorityAuth} will take precedence)`,
        };
      }

      return {
        type: 'message',
        messageType: 'info',
        content: baseMessage,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to ${enable ? 'enable' : 'disable'} OAuth for ${provider}: ${errorMessage}`,
      };
    }
  }

  async getAuthStatus(): Promise<string[]> {
    try {
      const statuses = await this.oauthManager.getAuthStatus();
      return statuses.map((status) => {
        const indicator = status.authenticated ? '✓' : '✗';
        const authInfo = status.authenticated
          ? `${status.authType}${status.expiresIn ? ` (expires in ${Math.floor(status.expiresIn / 60)}m)` : ''}`
          : 'not authenticated';
        const oauthStatus =
          status.oauthEnabled !== undefined
            ? ` [OAuth ${status.oauthEnabled ? 'enabled' : 'disabled'}]`
            : '';
        return `${indicator} ${status.provider}: ${authInfo}${oauthStatus}`;
      });
    } catch (error) {
      return [
        `Error getting auth status: ${error instanceof Error ? error.message : String(error)}`,
      ];
    }
  }
}

export const authCommand: SlashCommand = {
  name: 'auth',
  description:
    'toggle OAuth enablement for providers (gemini, qwen, anthropic)',
  kind: CommandKind.BUILT_IN,
  action: async (context, args) => {
    // Initialize OAuth manager with token store and settings
    const tokenStore = new MultiProviderTokenStore();
    const oauthManager = new OAuthManager(
      tokenStore,
      context.services.settings,
    );

    // Register OAuth providers
    oauthManager.registerProvider(new GeminiOAuthProvider());
    oauthManager.registerProvider(new QwenOAuthProvider());
    oauthManager.registerProvider(new AnthropicOAuthProvider());

    const executor = new AuthCommandExecutor(oauthManager);
    return executor.execute(context, args);
  },
};
