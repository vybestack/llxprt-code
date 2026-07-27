/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20250214-CREDPROXY.P33
 * @requirement R17.4
 */

import type {
  SlashCommand,
  CommandContext,
  SlashCommandActionReturn,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  validateProfileDirectory,
  discoverBrowserProfiles,
  type DiscoveredBrowserProfile,
} from '@vybestack/llxprt-code-core';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import {
  type CommandArgumentSchema,
  type CompleterFn,
} from './schema/types.js';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';

const logger = new DebugLogger('llxprt:ui:auth-command');
const BROWSER_PROFILE_ASSOCIATION_BROWSER = 'chrome' as const;

/**
 * Get the OAuth manager instance
 * @plan:PLAN-20250214-CREDPROXY.P33
 */
function getOAuthManager(): OAuthManager {
  try {
    return getRuntimeApi().getCliOAuthManager();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Auth command requires registered OAuth runtime infrastructure: ${message}`,
    );
  }
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
        value: 'create',
        description: 'Discover browser profiles for bucket association setup',
        next: [
          {
            kind: 'value',
            name: 'bucket',
            description: 'Bucket name (defaults to default)',
          },
        ],
      },
      {
        kind: 'literal',
        value: 'profile',
        description: 'Associate or clear a browser profile for a bucket',
        next: [
          {
            kind: 'value',
            name: 'bucket',
            description: 'Bucket name',
            completer: bucketCompleter,
            next: [
              {
                kind: 'value',
                name: 'selector',
                description: 'Profile number, directory name, or --clear',
              },
            ],
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

interface BucketStatus {
  bucket: string;
  authenticated: boolean;
  expiry?: number;
  isSessionBucket: boolean;
}

function formatAuthInfo(
  authenticated: boolean,
  expiresIn: number | undefined,
): string {
  if (!authenticated) {
    return 'not authenticated';
  }
  if (expiresIn != null) {
    return `authenticated (expires in ${Math.floor(expiresIn / 60)}m)`;
  }
  return 'authenticated';
}

function formatOAuthStatus(oauthEnabled: boolean | undefined): string {
  if (oauthEnabled === undefined) {
    return '';
  }
  return ` [OAuth ${oauthEnabled ? 'enabled' : 'disabled'}]`;
}

function formatBucketStatusLine(bucket: BucketStatus): string {
  const marker = bucket.isSessionBucket ? '* ' : '  ';

  if (!bucket.authenticated || bucket.expiry == null) {
    const statusStr = bucket.authenticated
      ? 'authenticated'
      : 'not authenticated';
    return `${marker}- ${bucket.bucket} (${statusStr})`;
  }

  const now = Date.now() / 1000;
  if (bucket.expiry <= now) {
    return `${marker}- ${bucket.bucket} (expired)`;
  }

  const expiryDate = new Date(bucket.expiry * 1000);
  const activeStr = bucket.isSessionBucket ? 'active, ' : '';
  return `${marker}- ${bucket.bucket} (${activeStr}expires: ${expiryDate.toLocaleString()})`;
}

/**
 * Resolve a profile selector into a directory name (and display name when the
 * selector is a number matching a discovered profile).
 *
 * - A 1-based number resolves against the currently discovered Chrome profiles.
 * - Any other value is treated as a literal profile directory name and must
 *   pass the strict allowlist validation (security: prevents command injection).
 *
 * Returns undefined when the selector cannot be resolved safely.
 */
function resolveProfileSelector(selector: string):
  | {
      profileDirectory: string;
      displayName?: string;
    }
  | undefined {
  const numericMatch = /^(\d+)$/.exec(selector);
  if (numericMatch) {
    const index = Number.parseInt(numericMatch[1], 10) - 1;
    const profiles: DiscoveredBrowserProfile[] = discoverBrowserProfiles(
      BROWSER_PROFILE_ASSOCIATION_BROWSER,
    );
    if (index < 0 || index >= profiles.length) {
      return undefined;
    }
    const profile = profiles[index];
    return {
      profileDirectory: profile.directoryName,
      displayName: profile.displayName,
    };
  }

  try {
    validateProfileDirectory(selector);
  } catch {
    return undefined;
  }
  return { profileDirectory: selector };
}

export class AuthCommandExecutor {
  constructor(private oauthManager: OAuthManager) {}

  async execute(
    context: CommandContext,
    args?: string,
  ): Promise<SlashCommandActionReturn> {
    // Parse args while preserving original parts for error messages
    const trimmedArgs = args?.trim() ?? '';
    const parts = trimmedArgs.split(/\s+/).filter((p) => p.length > 0);
    const rawProvider = parts[0];
    const rawAction = parts[1];
    const param = parts[2];

    // If no provider specified, show the auth dialog
    if (!rawProvider) {
      return {
        type: 'dialog',
        dialog: 'auth',
      };
    }

    const action = parts.length > 1 ? rawAction.toLowerCase() : undefined;
    const provider = rawProvider.toLowerCase();

    // `/auth anthropic` is not an OAuth identity (issue #2274): the Claude.ai
    // subscription OAuth flow lives under `claudecode`, and Anthropic API keys
    // are configured via `/provider anthropic` + `/key`/`/keyfile`. Redirect
    // users instead of touching OAuth manager state.
    if (provider === 'anthropic') {
      return {
        type: 'message',
        messageType: 'info',
        content:
          'Anthropic API keys and Claude Code subscription OAuth are now separate.\n' +
          'For Claude.ai subscription OAuth, run: /auth claudecode\n' +
          'For Anthropic API-key access, run: /provider anthropic, then /key or /keyfile',
      };
    }

    // Check if provider is supported before processing actions
    const supportedProviders = this.oauthManager.getSupportedProviders();
    if (!supportedProviders.includes(provider)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Unknown provider: ${rawProvider}. Supported providers: ${supportedProviders.join(', ')}`,
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

    // Handle create action: discover browser profiles for a new bucket
    if (action === 'create') {
      const bucket = param && param.length > 0 ? param : 'default';
      return this.discoverBrowserProfilesForBucket(provider, bucket);
    }

    // Handle profile action: associate/clear a browser profile for a bucket
    if (action === 'profile') {
      const selector = parts[3];
      return this.manageBrowserProfile(provider, param, selector);
    }

    if (action === 'logout' || action === 'signout') {
      return this.logoutWithBucket(provider, param);
    }

    return {
      type: 'message',
      messageType: 'error',
      content: `Invalid action: ${action}. Use create, disable, enable, login, logout, profile, status, or switch`,
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
        }
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
      await this.oauthManager.authenticate(provider, bucket, {
        signalAuthCompletion: true,
      });

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
        this.clearProviderCache(provider);
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
        lines.push(formatBucketStatusLine(bucket));
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
  /**
   * Discover available Chrome browser profiles so the user can associate
   * one with a bucket. The association controls which browser/profile opens
   * during the OAuth flow for that bucket.
   */
  private async discoverBrowserProfilesForBucket(
    provider: string,
    bucket: string,
  ): Promise<MessageActionReturn> {
    try {
      const profiles = discoverBrowserProfiles(
        BROWSER_PROFILE_ASSOCIATION_BROWSER,
      );

      if (profiles.length === 0) {
        return {
          type: 'message',
          messageType: 'info',
          content:
            `No Chrome profiles were detected for ${provider} bucket "${bucket}".\n` +
            `You can associate a profile manually with:\n` +
            `  /auth ${provider} profile ${bucket} <profile-directory>`,
        };
      }

      const lines: string[] = [
        `Discovered Chrome profiles for ${provider} bucket "${bucket}":`,
        '',
        ...profiles.map(
          (profile, index) =>
            `  ${index + 1}: ${profile.displayName} ` +
            `(profile: ${profile.directoryName})`,
        ),
        '',
        `To associate a profile, run:`,
        `  /auth ${provider} profile ${bucket} <number-or-directory>`,
        `Then authenticate with:`,
        `  /auth ${provider} login ${bucket}`,
      ];

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
        content: `Failed to discover browser profiles for ${provider}: ${errorMessage}`,
      };
    }
  }

  /**
   * Associate (or clear) a browser profile for a provider+bucket.
   * The selector may be a 1-based number from the discovered list, a literal
   * profile directory name, or "--clear" to remove the association.
   */
  private async manageBrowserProfile(
    provider: string,
    bucket: string | undefined,
    selector: string | undefined,
  ): Promise<MessageActionReturn> {
    try {
      if (!bucket) {
        return {
          type: 'message',
          messageType: 'error',
          content:
            'Bucket name required for profile command. Usage: /auth <provider> profile <bucket> <number|directory|--clear>',
        };
      }

      if (!selector) {
        return {
          type: 'message',
          messageType: 'error',
          content: `A selector is required. Usage: /auth ${provider} profile ${bucket} <number|directory|--clear>`,
        };
      }

      if (selector === '--clear') {
        this.oauthManager.clearBrowserProfileAssociation(provider, bucket);
        return {
          type: 'message',
          messageType: 'info',
          content: `Cleared browser profile association for ${provider} bucket "${bucket}"`,
        };
      }

      const resolved = resolveProfileSelector(selector);

      if (resolved === undefined) {
        return {
          type: 'message',
          messageType: 'error',
          content:
            `Invalid profile selector: "${selector}". ` +
            `Use a number from the discovered list or a profile directory name. ` +
            `Path separators, control characters, and traversal sequences (..) are not allowed.`,
        };
      }

      this.oauthManager.setBrowserProfileAssociation(provider, bucket, {
        browser: BROWSER_PROFILE_ASSOCIATION_BROWSER,
        profileDirectory: resolved.profileDirectory,
        ...(resolved.displayName !== undefined
          ? { displayName: resolved.displayName }
          : {}),
      });

      const label =
        resolved.displayName !== undefined
          ? `${resolved.displayName} (${resolved.profileDirectory})`
          : resolved.profileDirectory;
      return {
        type: 'message',
        messageType: 'info',
        content: `Associated ${provider} bucket "${bucket}" with Chrome profile: ${label}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to set browser profile for ${provider}: ${errorMessage}`,
      };
    }
  }

  async getAuthStatus(): Promise<string[]> {
    try {
      const statuses = await this.oauthManager.getAuthStatus();
      return statuses.map((status) => {
        const indicator = status.authenticated ? '[✓]' : '[]';
        const authInfo = formatAuthInfo(status.authenticated, status.expiresIn);
        const oauthStatus = formatOAuthStatus(status.oauthEnabled);
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
  autoExecute: true,
  schema: authCommandSchema,
  action: async (context, args) => {
    const oauthManager = getOAuthManager();

    const executor = new AuthCommandExecutor(oauthManager);
    return executor.execute(context, args);
  },
};
