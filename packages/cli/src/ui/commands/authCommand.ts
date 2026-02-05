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
import {
  MultiProviderTokenStore,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import { QwenOAuthProvider } from '../../auth/qwen-oauth-provider.js';
import { GeminiOAuthProvider } from '../../auth/gemini-oauth-provider.js';
import { AnthropicOAuthProvider } from '../../auth/anthropic-oauth-provider.js';
import { CodexOAuthProvider } from '../../auth/codex-oauth-provider.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import {
  type CommandArgumentSchema,
  type CompleterFn,
} from './schema/types.js';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';

const logger = new DebugLogger('llxprt:ui:auth-command');

/**
 * Get the OAuth manager instance
 */
function getOAuthManager(): OAuthManager {
  const runtime = getRuntimeApi();
  let oauthManager = runtime.getCliOAuthManager();

  if (!oauthManager) {
    const tokenStore = new MultiProviderTokenStore();
    oauthManager = new OAuthManager(tokenStore);
    oauthManager.registerProvider(new GeminiOAuthProvider());
    oauthManager.registerProvider(new QwenOAuthProvider());
    oauthManager.registerProvider(new AnthropicOAuthProvider());
  }

  return oauthManager;
}

/**
 * Completer for provider names
 */
const providerCompleter: CompleterFn = withFuzzyFilter(async () => {
  try {
    const oauthManager = getOAuthManager();
    const providers = oauthManager.getSupportedProviders();
    return providers.map((provider) => ({
      value: provider,
      description: `Configure ${provider} OAuth`,
    }));
  } catch {
    return [];
  }
});

/**
 * Completer for bucket names for a given provider
 */
const bucketCompleter: CompleterFn = withFuzzyFilter(
  async (_ctx, _partial, tokens) => {
    try {
      const provider = tokens.tokens[0];
      if (!provider) return [];

      const oauthManager = getOAuthManager();
      const buckets = await oauthManager.listBuckets(provider);
      return buckets.map((bucket) => ({
        value: bucket,
        description: `OAuth bucket: ${bucket}`,
      }));
    } catch {
      return [];
    }
  },
);

/**
 * Completer for logout command (buckets + --all flag)
 */
const logoutCompleter: CompleterFn = withFuzzyFilter(
  async (_ctx, _partial, tokens) => {
    try {
      const provider = tokens.tokens[0];
      if (!provider) return [];

      const oauthManager = getOAuthManager();
      const buckets = await oauthManager.listBuckets(provider);
      const options = [
        { value: '--all', description: 'Logout from all buckets' },
        ...buckets.map((bucket) => ({
          value: bucket,
          description: `Logout from bucket: ${bucket}`,
        })),
      ];
      return options;
    } catch {
      return [];
    }
  },
);

/**
 * Command schema for auth command autocomplete
 */
const authCommandSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'provider',
    description: 'Select OAuth provider',
    completer: providerCompleter,
    next: [
      {
        kind: 'literal',
        value: 'login',
        description: 'Login to provider with optional bucket',
        next: [
          {
            kind: 'value',
            name: 'bucket',
            description: 'Bucket name (optional)',
            completer: bucketCompleter,
          },
        ],
      },
      {
        kind: 'literal',
        value: 'logout',
        description: 'Logout from provider',
        next: [
          {
            kind: 'value',
            name: 'bucket-or-flag',
            description: 'Bucket name or --all',
            completer: logoutCompleter,
          },
        ],
      },
      {
        kind: 'literal',
        value: 'status',
        description: 'Show authentication status and buckets',
      },
      {
        kind: 'literal',
        value: 'switch',
        description: 'Switch to a different bucket',
        next: [
          {
            kind: 'value',
            name: 'bucket',
            description: 'Bucket name to switch to',
            completer: bucketCompleter,
          },
        ],
      },
      {
        kind: 'literal',
        value: 'enable',
        description: 'Enable OAuth for provider',
      },
      {
        kind: 'literal',
        value: 'disable',
        description: 'Disable OAuth for provider',
      },
    ],
  },
];

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
    const param = parts[2];

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

    // Handle login action with optional bucket
    if (action === 'login') {
      return this.loginWithBucket(provider, param);
    }

    // Handle status action to show all buckets
    if (action === 'status') {
      return this.showBucketStatus(provider);
    }

    // Handle switch action to set session bucket
    if (action === 'switch') {
      return this.switchBucket(provider, param);
    }

    // Lines 15-17: Handle logout action (NEW) @pseudocode lines 15-17
    if (action === 'logout' || action === 'signout') {
      return this.logoutWithBucket(provider, param);
    }

    // Lines 19-24: Invalid action @pseudocode lines 19-24
    return {
      type: 'message',
      messageType: 'error',
      content: `Invalid action: ${action}. Use enable, disable, login, logout, status, or switch`,
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
          logger.debug(
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
   * Clear the cached client for a provider after logout
   * This ensures the provider doesn't use stale credentials
   */
  private clearProviderCache(provider: string): void {
    try {
      const providerManager = getRuntimeApi().getCliProviderManager();

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
      logger.debug(`Failed to clear provider cache for ${provider}:`, error);
    }
  }

  /**
   * Login to a provider with optional bucket parameter
   */
  private async loginWithBucket(
    provider: string,
    bucket?: string,
  ): Promise<SlashCommandActionReturn> {
    try {
      // Authenticate with bucket (default if not specified)
      await this.oauthManager.authenticate(provider, bucket);

      const bucketInfo = bucket ? ` (bucket: ${bucket})` : '';
      return {
        type: 'message',
        messageType: 'info',
        content: `Successfully authenticated ${provider}${bucketInfo}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Authentication failed for ${provider}: ${errorMessage}`,
      };
    }
  }

  /**
   * Logout from provider with optional bucket parameter or --all flag
   */
  private async logoutWithBucket(
    provider: string,
    bucketOrFlag?: string,
  ): Promise<MessageActionReturn> {
    try {
      // Check if --all flag specified
      if (bucketOrFlag === '--all') {
        await this.oauthManager.logoutAllBuckets(provider);
        return {
          type: 'message',
          messageType: 'info',
          content: `Successfully logged out of all buckets for ${provider}`,
        };
      }

      // Check if authenticated before logout
      const isAuthenticated = await this.oauthManager.isAuthenticated(
        provider,
        bucketOrFlag,
      );

      if (!isAuthenticated && bucketOrFlag) {
        // Still attempt logout to clean up stale tokens
        try {
          await this.oauthManager.logout(provider, bucketOrFlag);
          // Clear session bucket after successful logout
          this.oauthManager.clearSessionBucket(provider);
          // Clear provider cache
          this.clearProviderCache(provider);
          return {
            type: 'message',
            messageType: 'info',
            content: `Successfully logged out of ${provider} (bucket: ${bucketOrFlag})`,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          return {
            type: 'message',
            messageType: 'error',
            content: `Bucket not found: ${errorMessage}`,
          };
        }
      }

      // Perform logout for authenticated session or default bucket
      await this.oauthManager.logout(provider, bucketOrFlag);

      // Clear session bucket
      this.oauthManager.clearSessionBucket(provider);

      // Clear provider cache
      this.clearProviderCache(provider);

      const bucketInfo = bucketOrFlag ? ` (bucket: ${bucketOrFlag})` : '';
      return {
        type: 'message',
        messageType: 'info',
        content: `Successfully logged out of ${provider}${bucketInfo}`,
      };
    } catch (error) {
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
   * Show status for all buckets of a provider
   */
  private async showBucketStatus(
    provider: string,
  ): Promise<MessageActionReturn> {
    try {
      const buckets =
        await this.oauthManager.getAuthStatusWithBuckets(provider);

      if (buckets.length === 0) {
        return {
          type: 'message',
          messageType: 'info',
          content: `${provider} has no buckets authenticated`,
        };
      }

      const lines: string[] = [`Authentication Status (${provider}):`];
      lines.push('  OAuth Buckets:');

      for (const bucket of buckets) {
        const marker = bucket.isSessionBucket ? '* ' : '  ';
        const statusStr = bucket.authenticated
          ? 'authenticated'
          : 'not authenticated';

        if (bucket.authenticated && bucket.expiry) {
          const expiryDate = new Date(bucket.expiry * 1000);
          const now = Date.now() / 1000;
          const isExpired = bucket.expiry <= now;

          if (isExpired) {
            lines.push(`${marker}- ${bucket.bucket} (expired)`);
          } else {
            const activeStr = bucket.isSessionBucket ? 'active, ' : '';
            lines.push(
              `${marker}- ${bucket.bucket} (${activeStr}expires: ${expiryDate.toLocaleString()})`,
            );
          }
        } else {
          lines.push(`${marker}- ${bucket.bucket} (${statusStr})`);
        }
      }

      return {
        type: 'message',
        messageType: 'info',
        content: lines.join('\n'),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to get bucket status for ${provider}: ${errorMessage}`,
      };
    }
  }

  /**
   * Switch session bucket for a provider
   */
  private async switchBucket(
    provider: string,
    bucket?: string,
  ): Promise<MessageActionReturn> {
    try {
      // Bucket name is required
      if (!bucket) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Bucket name required for switch command',
        };
      }

      // Validate bucket exists
      const buckets = await this.oauthManager.listBuckets(provider);

      if (buckets.length === 0) {
        return {
          type: 'message',
          messageType: 'error',
          content: `No buckets available for ${provider}. Please authenticate first.`,
        };
      }

      if (!buckets.includes(bucket)) {
        const availableStr = buckets.join(', ');
        return {
          type: 'message',
          messageType: 'error',
          content: `Bucket not found: ${bucket}. Available buckets: ${availableStr}`,
        };
      }

      // Set session bucket
      this.oauthManager.setSessionBucket(provider, bucket);

      return {
        type: 'message',
        messageType: 'info',
        content: `Session bucket for ${provider} set to: ${bucket} (temporary override)`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to switch bucket for ${provider}: ${errorMessage}`,
      };
    }
  }

  async getAuthStatus(): Promise<string[]> {
    try {
      const statuses = await this.oauthManager.getAuthStatus();
      return statuses.map((status) => {
        const indicator = status.authenticated ? '[[OK]]' : '[]';
        const authInfo = status.authenticated
          ? `authenticated${status.expiresIn ? ` (expires in ${Math.floor(status.expiresIn / 60)}m)` : ''}`
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
  description: 'Manage OAuth authentication for providers',
  kind: CommandKind.BUILT_IN,
  schema: authCommandSchema,
  action: async (context, args) => {
    const runtime = getRuntimeApi();
    // Ensure provider manager is initialized (throws if bootstrap skipped registration)
    const providerManager = runtime.getCliProviderManager();

    // Get the shared OAuth manager instance
    let oauthManager = runtime.getCliOAuthManager();

    // If for some reason it doesn't exist yet, create it
    if (!oauthManager) {
      // This should rarely happen, but handle it as a fallback
      const tokenStore = new MultiProviderTokenStore();
      oauthManager = new OAuthManager(tokenStore, context.services.settings);

      // Register OAuth providers
      oauthManager.registerProvider(new GeminiOAuthProvider());
      oauthManager.registerProvider(new QwenOAuthProvider());
      oauthManager.registerProvider(new AnthropicOAuthProvider());
      oauthManager.registerProvider(new CodexOAuthProvider(tokenStore));

      runtime.registerCliProviderInfrastructure(providerManager, oauthManager);
    }

    const executor = new AuthCommandExecutor(oauthManager);
    return executor.execute(context, args);
  },
};
