/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CommandKind,
  SlashCommand,
  CommandContext,
  SlashCommandActionReturn,
  MessageActionReturn,
} from './types.js';
import { OAuthManager } from '../../auth/oauth-manager.js';
import { MultiProviderTokenStore } from '@vybestack/llxprt-code-core';
import { QwenOAuthProvider } from '../../auth/qwen-oauth-provider.js';
import { GeminiOAuthProvider } from '../../auth/gemini-oauth-provider.js';
import { AnthropicOAuthProvider } from '../../auth/anthropic-oauth-provider.js';
import {
  getOAuthManager,
  getProviderManager,
} from '../../providers/providerManagerInstance.js';

export class AuthCommandExecutor {
  constructor(private oauthManager: OAuthManager) {}

  async execute(
    context: CommandContext,
    args?: string,
  ): Promise<SlashCommandActionReturn> {
    // Parse args while preserving original parts for error messages
    const trimmedArgs = args?.trim() || '';
    const parts = trimmedArgs.split(/\s+/).filter((p) => p.length > 0); // Remove empty parts
    const provider = parts[0];
    const action = parts[1];

    // For error messages, we want to show the provider as the user typed it
    // This should be the first word from the arguments, trimmed of leading/trailing spaces
    // but preserving any internal structure
    const originalProvider = provider || ''; // Use the parsed provider for consistency

    // If no provider specified, show the auth dialog
    if (!provider) {
      return {
        type: 'dialog',
        dialog: 'auth',
      };
    }

    // Check if provider is supported before processing actions
    const supportedProviders = this.oauthManager.getSupportedProviders();
    if (!supportedProviders.includes(provider)) {
      // Use the original provider string from args for the error message
      // This preserves whatever the user actually typed (including spaces)
      return {
        type: 'message',
        messageType: 'error',
        content: `Unknown provider: ${originalProvider}. Supported providers: ${supportedProviders.join(', ')}`,
      };
    }

    // If no action specified, show status for the provider
    if (!action) {
      return this.showProviderStatus(provider);
    }

    // Handle enable/disable actions
    if (action === 'enable' || action === 'disable') {
      return this.setProviderOAuth(provider, action === 'enable');
    }

    // Lines 15-17: Handle logout action (NEW) @pseudocode lines 15-17
    if (action === 'logout' || action === 'signout') {
      return this.logoutProvider(provider);
    }

    // Lines 19-24: Invalid action @pseudocode lines 19-24
    return {
      type: 'message',
      messageType: 'error',
      content: `Invalid action: ${action}. Use enable, disable, or logout`,
    };
  }

  private async showProviderStatus(
    provider: string,
  ): Promise<MessageActionReturn> {
    try {
      // Provider validation is now done in execute(), so we can proceed directly

      // Get current OAuth status
      const isEnabled = this.oauthManager.isOAuthEnabled(provider);
      const isAuthenticated = await this.oauthManager.isAuthenticated(provider);

      let status = `OAuth for ${provider}: ${isEnabled ? 'ENABLED' : 'DISABLED'}`;
      if (isEnabled && isAuthenticated) {
        let token = null;
        try {
          token = await this.oauthManager.peekStoredToken(provider);
        } catch (error) {
          console.debug(
            `Failed to read stored OAuth token for ${provider}:`,
            error,
          );
        }

        if (token && typeof token.expiry === 'number') {
          // Lines 72-76: Calculate time until expiry
          const expiryDate = new Date(token.expiry * 1000);
          const timeUntilExpiry = Math.max(0, token.expiry - Date.now() / 1000);
          const hours = Math.floor(timeUntilExpiry / 3600);
          const minutes = Math.floor((timeUntilExpiry % 3600) / 60);

          // Lines 78-85: Return detailed status with logout instruction
          status =
            `${provider} OAuth: Enabled and authenticated\n` +
            `Token expires: ${expiryDate.toISOString()}\n` +
            `Time remaining: ${hours}h ${minutes}m\n` +
            `Use /auth ${provider} logout to sign out`;
          return {
            type: 'message',
            messageType: 'info',
            content: status,
          };
        } else {
          status += ' (authenticated)';
        }
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
      // Provider validation is now done in execute(), so we can proceed directly

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

      // Toggle to achieve desired state using the settings service
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

  /**
   * @plan PLAN-20250823-AUTHFIXES.P14
   * @requirement REQ-002.3
   * @pseudocode lines 26-63
   * Logout from a specific provider
   * @param provider - Name of the provider to logout from
   * @returns MessageActionReturn with logout result
   */
  private async logoutProvider(provider: string): Promise<MessageActionReturn> {
    try {
      // Provider validation is now done in execute(), so we can proceed directly

      // Lines 38-49: Check if user is authenticated and perform logout
      const isAuthenticated = await this.oauthManager.isAuthenticated(provider);
      if (!isAuthenticated) {
        // Still attempt logout in case there's an expired/invalid token to clean up
        try {
          await this.oauthManager.logout(provider);
        } catch (error) {
          // OAuth manager failures should be treated as errors
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to logout from ${provider}: ${errorMessage}`,
          };
        }
        // If logout succeeded for unauthenticated user, they had stale tokens
        // Clear provider cache if it's a Qwen provider
        this.clearProviderCache(provider);
        return {
          type: 'message',
          messageType: 'info',
          content: `Successfully logged out of ${provider}`,
        };
      } else {
        // User is authenticated, perform logout
        await this.oauthManager.logout(provider);
        // Clear provider cache if it's a Qwen provider
        this.clearProviderCache(provider);
      }

      // Lines 51-55: Return success message
      return {
        type: 'message',
        messageType: 'info',
        content: `Successfully logged out of ${provider}`,
      };
    } catch (error) {
      // Lines 56-62: Handle errors
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to logout from ${provider}: ${errorMessage}`,
      };
    }
  }

  /**
   * Clear the cached client for a provider after logout
   * This ensures the provider doesn't use stale credentials
   */
  private clearProviderCache(provider: string): void {
    try {
      // Get the provider manager
      const providerManager = getProviderManager();
      if (!providerManager) return;

      // Get the provider instance
      const providerInstance = providerManager.getProviderByName(provider);
      if (!providerInstance) return;

      // If it's an OpenAI provider (which Qwen uses), clear its cache
      if (
        'clearClientCache' in providerInstance &&
        typeof providerInstance.clearClientCache === 'function'
      ) {
        (
          providerInstance as { clearClientCache: () => void }
        ).clearClientCache();
      }
    } catch (error) {
      // Failing to clear cache is not critical, just log it
      console.debug(`Failed to clear provider cache for ${provider}:`, error);
    }
  }

  async getAuthStatus(): Promise<string[]> {
    try {
      const statuses = await this.oauthManager.getAuthStatus();
      return statuses.map((status) => {
        const indicator = status.authenticated ? '[✓]' : '[✗]';
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
    // Ensure provider manager is initialized (which creates the OAuth manager)
    // Pass settings to ensure OAuth state is properly initialized
    getProviderManager(undefined, false, context.services.settings);

    // Get the shared OAuth manager instance
    let oauthManager = getOAuthManager();

    // If for some reason it doesn't exist yet, create it
    if (!oauthManager) {
      // This should rarely happen, but handle it as a fallback
      const tokenStore = new MultiProviderTokenStore();
      oauthManager = new OAuthManager(tokenStore, context.services.settings);

      // Register OAuth providers
      oauthManager.registerProvider(new GeminiOAuthProvider());
      oauthManager.registerProvider(new QwenOAuthProvider());
      oauthManager.registerProvider(new AnthropicOAuthProvider());
    }

    const executor = new AuthCommandExecutor(oauthManager);
    return executor.execute(context, args);
  },
};
