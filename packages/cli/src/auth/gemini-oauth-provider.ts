/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gemini OAuth Provider Implementation
 *
 * Bridges to the existing Google OAuth infrastructure in oauth2.ts
 * while maintaining compatibility with the LOGIN_WITH_GOOGLE flow.
 */

import { OAuthProvider } from './oauth-manager.js';
import { OAuthToken, TokenStore } from './types.js';
import {
  clearOauthClientCache,
  OAuthError,
  OAuthErrorFactory,
  GracefulErrorHandler,
  RetryHandler,
  shouldLaunchBrowser,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Credentials } from 'google-auth-library';
import { HistoryItemWithoutId } from '../ui/types.js';
import { globalOAuthUI } from './global-oauth-ui.js';

enum InitializationState {
  NotStarted = 'not-started',
  InProgress = 'in-progress',
  Completed = 'completed',
  Failed = 'failed',
}

export class GeminiOAuthProvider implements OAuthProvider {
  name = 'gemini';
  private currentToken: OAuthToken | null = null;
  private tokenStore?: TokenStore;
  private initializationState = InitializationState.NotStarted;
  private initializationPromise?: Promise<void>;
  private initializationError?: Error;
  private errorHandler: GracefulErrorHandler;
  private retryHandler: RetryHandler;
  private logger: DebugLogger;
  private addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number;

  constructor(
    tokenStore?: TokenStore,
    addItem?: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp: number,
    ) => number,
  ) {
    this.tokenStore = tokenStore;
    this.retryHandler = new RetryHandler();
    this.errorHandler = new GracefulErrorHandler(this.retryHandler);
    this.logger = new DebugLogger('llxprt:auth:gemini');
    this.addItem = addItem;

    if (!tokenStore) {
      console.warn(
        `DEPRECATION: ${this.name} OAuth provider created without TokenStore. ` +
          `Token persistence will not work. Please update your code.`,
      );
    }

    // DO NOT call initializeToken() - lazy initialization pattern
  }

  /**
   * Set the addItem callback for displaying messages in the UI
   */
  setAddItem(
    addItem: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp: number,
    ) => number,
  ): void {
    this.addItem = addItem;
  }

  /**
   * Lazy initialization with proper state management
   * Ensures initialization only happens once and handles concurrent calls
   */
  private async ensureInitialized(): Promise<void> {
    // If already completed, return immediately
    if (this.initializationState === InitializationState.Completed) {
      return;
    }

    // If failed, allow retry by resetting to NotStarted
    if (this.initializationState === InitializationState.Failed) {
      this.initializationState = InitializationState.NotStarted;
      this.initializationPromise = undefined;
      this.initializationError = undefined;
    }

    // If not started, start initialization
    if (this.initializationState === InitializationState.NotStarted) {
      this.initializationState = InitializationState.InProgress;
      this.initializationPromise = this.initializeToken();
    }

    // Wait for initialization to complete (handles concurrent calls)
    if (this.initializationPromise) {
      try {
        await this.initializationPromise;
        this.initializationState = InitializationState.Completed;
      } catch (error) {
        this.initializationState = InitializationState.Failed;
        this.initializationError =
          error instanceof OAuthError
            ? error
            : OAuthErrorFactory.fromUnknown(
                this.name,
                error,
                'ensureInitialized',
              );
        throw this.initializationError;
      }
    }
  }

  async initializeToken(): Promise<void> {
    if (!this.tokenStore) {
      return;
    }

    return this.errorHandler.handleGracefully(
      async () => {
        // Try to load from new location first
        let savedToken = await this.tokenStore!.getToken('gemini');

        if (!savedToken) {
          // Try to migrate from legacy locations
          savedToken = await this.migrateFromLegacyTokens();
        }

        if (savedToken) {
          this.currentToken = savedToken;
        }
      },
      undefined, // No fallback needed - graceful failure is acceptable
      this.name,
      'initializeToken',
    );
  }

  async initiateAuth(): Promise<void> {
    await this.ensureInitialized();

    return this.errorHandler.wrapMethod(
      async () => {
        // Import the existing Google OAuth infrastructure
        const coreModule = await import('@vybestack/llxprt-code-core');
        const { getOauthClient, AuthType } = coreModule;

        // Create a minimal config for OAuth - use type assertion for test environment
        // Type assertion is needed since we're creating a partial Config for test mode
        const config = {
          getProxy: () => undefined,
          isBrowserLaunchSuppressed: () => !shouldLaunchBrowser(),
        } as unknown as Parameters<typeof getOauthClient>[1];

        // Use the existing Google OAuth infrastructure to get a client
        let client;
        try {
          client = await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, config);
        } catch (error) {
          // Handle browser auth cancellation or other auth failures
          if (error instanceof Error) {
            // Show error message to user if addItem is available
            const addItem = this.addItem || globalOAuthUI.getAddItem();
            if (addItem) {
              addItem(
                {
                  type: 'error',
                  text: `Browser authentication failed: ${error.message}
Please try again or use an API key with /keyfile <path-to-your-gemini-key>`,
                },
                Date.now(),
              );
            }

            // Check for specific cancellation messages
            if (
              error.message.includes('cancelled') ||
              error.message.includes('denied') ||
              error.message.includes('access_denied') ||
              error.message.includes('user_cancelled')
            ) {
              // CRITICAL FIX: Trigger fallback flow instead of failing
              this.logger.debug(
                () =>
                  `Browser auth cancelled, triggering fallback: ${error.message}`,
              );

              // Show fallback instructions to user
              const fallbackMessage = `Browser authentication was cancelled or failed.\nFallback options:\n1. Use API key: /keyfile <path-to-your-gemini-key>\n2. Set environment: export GEMINI_API_KEY=<your-key>\n3. Try OAuth again: /auth gemini enable`;

              const addItem = this.addItem || globalOAuthUI.getAddItem();
              if (addItem) {
                addItem(
                  {
                    type: 'info',
                    text: fallbackMessage,
                  },
                  Date.now(),
                );
              } else {
                console.log('\\n' + '─'.repeat(60));
                console.log('Browser authentication was cancelled or failed.');
                console.log('Fallback options:');
                console.log(
                  '1. Use API key: /keyfile <path-to-your-gemini-key>',
                );
                console.log(
                  '2. Set environment: export GEMINI_API_KEY=<your-key>',
                );
                console.log('3. Try OAuth again: /auth gemini enable');
                console.log('─'.repeat(60));
              }

              // Throw a user-friendly error that doesn't hang the system
              throw OAuthErrorFactory.authenticationRequired(this.name, {
                reason:
                  'Browser authentication was cancelled or failed. Please use one of the fallback options shown above, or check the URL in your history.',
              });
            }
          }
          // Re-throw other authentication errors
          throw error;
        }

        // The client should now have valid credentials
        // Extract and cache the token
        const credentials = client.credentials;
        if (credentials && credentials.access_token) {
          const token = this.credentialsToOAuthToken(credentials);
          if (token && this.tokenStore) {
            try {
              await this.tokenStore.saveToken('gemini', token);
              this.currentToken = token;

              // Display success message
              const addItem = this.addItem || globalOAuthUI.getAddItem();
              if (addItem) {
                addItem(
                  {
                    type: 'info',
                    text: 'Successfully authenticated with Google Gemini!',
                  },
                  Date.now(),
                );
              } else {
                console.log('Successfully authenticated with Google Gemini!');
              }
            } catch (saveError) {
              throw OAuthErrorFactory.storageError(
                this.name,
                saveError instanceof Error ? saveError : undefined,
                {
                  operation: 'saveToken',
                },
              );
            }
          }
        } else {
          throw OAuthErrorFactory.authenticationRequired(this.name, {
            reason: 'No valid credentials received from Google OAuth',
          });
        }
      },
      this.name,
      'initiateAuth',
    )();
  }

  async getToken(): Promise<OAuthToken | null> {
    await this.ensureInitialized();

    return this.errorHandler.handleGracefully(
      async () => {
        // Try to get from memory first
        let token = await this.refreshIfNeeded();

        if (!token) {
          // Try to get from existing Google OAuth infrastructure
          token = await this.getTokenFromGoogleOAuth();

          // Cache it if found
          if (token && this.tokenStore) {
            try {
              await this.tokenStore.saveToken('gemini', token);
              this.currentToken = token;
            } catch (error) {
              // Non-critical - we can still return the token
              this.logger.debug(
                () => `Failed to cache token from Google OAuth: ${error}`,
              );
            }
          }
        }

        return token;
      },
      null, // Return null on error
      this.name,
      'getToken',
    );
  }

  async refreshIfNeeded(): Promise<OAuthToken | null> {
    await this.ensureInitialized();
    if (!this.currentToken) {
      return null;
    }

    return this.errorHandler.handleGracefully(
      async () => {
        // Check if token needs refresh (30 second buffer)
        const now = Date.now() / 1000;
        const expiresAt = this.currentToken!.expiry;

        if (expiresAt && expiresAt <= now + 30) {
          // Token is expired or expires soon
          // Since actual Gemini OAuth refresh is handled by the GeminiProvider itself,
          // we clear the expired token and return null to signal re-authentication is needed
          this.currentToken = null;
          if (this.tokenStore) {
            try {
              await this.tokenStore.removeToken('gemini');
            } catch (error) {
              throw OAuthErrorFactory.storageError(
                this.name,
                error instanceof Error ? error : undefined,
                {
                  operation: 'removeExpiredToken',
                },
              );
            }
          }
          return null;
        }

        return this.currentToken;
      },
      null, // Return null on error
      this.name,
      'refreshIfNeeded',
    );
  }

  async logout(): Promise<void> {
    await this.ensureInitialized();

    // NO ERROR SUPPRESSION - let it fail loudly
    // Clear current token
    this.currentToken = null;

    // Remove from new token storage location - THIS MUST SUCCEED
    if (this.tokenStore) {
      await this.tokenStore.removeToken('gemini');
    }

    // Remove from legacy token locations
    await this.clearLegacyTokens();

    // CRITICAL SECURITY FIX: Clear OAuth client cache to prevent session leakage
    // This ensures that subsequent authentication attempts require re-authentication
    try {
      clearOauthClientCache();
    } catch (error) {
      // Log warning but don't fail logout if cache clearing fails
      this.logger.debug(
        () =>
          `Failed to clear OAuth client cache during Gemini logout: ${error}`,
      );
    }
  }

  /**
   * Converts Google OAuth Credentials to our OAuthToken format
   */
  private credentialsToOAuthToken(creds: Credentials): OAuthToken | null {
    if (!creds.access_token) {
      return null;
    }

    const token: OAuthToken = {
      access_token: creds.access_token,
      refresh_token: creds.refresh_token || undefined,
      // Google OAuth uses expiry_date (milliseconds), we need expiry (seconds)
      expiry: creds.expiry_date
        ? Math.floor(creds.expiry_date / 1000)
        : Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer' as const,
      scope: creds.scope || undefined,
    };

    // Add id_token if available (some tests expect this)
    if (creds.id_token && typeof creds === 'object' && creds.id_token) {
      (token as OAuthToken & { id_token?: string }).id_token = creds.id_token;
    }

    return token;
  }

  /**
   * Gets token from the existing Google OAuth infrastructure
   */
  private async getTokenFromGoogleOAuth(): Promise<OAuthToken | null> {
    return this.errorHandler.handleGracefully(
      async () => {
        // Try to read from the existing OAuth credentials file
        const credPath = path.join(os.homedir(), '.llxprt', 'oauth_creds.json');
        const credsJson = await fs.readFile(credPath, 'utf8');
        const creds = JSON.parse(credsJson) as Credentials;

        if (creds.refresh_token || creds.access_token) {
          return this.credentialsToOAuthToken(creds);
        }

        return null;
      },
      null, // Return null if we can't read the file
      this.name,
      'getTokenFromGoogleOAuth',
    );
  }

  /**
   * Migrates tokens from legacy locations to new format
   */
  private async migrateFromLegacyTokens(): Promise<OAuthToken | null> {
    return this.errorHandler.handleGracefully(
      async () => {
        // Try to get token from existing Google OAuth
        const token = await this.getTokenFromGoogleOAuth();

        if (token && this.tokenStore) {
          try {
            // Save to new location
            await this.tokenStore.saveToken('gemini', token);
            this.logger.debug(
              () => 'Successfully migrated Gemini token from legacy location',
            );
            return token;
          } catch (error) {
            throw OAuthErrorFactory.storageError(
              this.name,
              error instanceof Error ? error : undefined,
              {
                operation: 'migrateToken',
              },
            );
          }
        }

        return token;
      },
      null, // Return null if migration fails
      this.name,
      'migrateFromLegacyTokens',
    );
  }

  /**
   * Clears tokens from all legacy locations
   */
  private async clearLegacyTokens(): Promise<void> {
    const legacyPaths = [
      // Legacy OAuth credentials file
      path.join(os.homedir(), '.llxprt', 'oauth_creds.json'),
      // Legacy Google accounts file
      path.join(os.homedir(), '.llxprt', 'google_accounts.json'),
    ];

    // Use Promise.allSettled to continue even if some paths fail
    const results = await Promise.allSettled(
      legacyPaths.map(async (legacyPath) => {
        try {
          await fs.unlink(legacyPath);
          this.logger.debug(() => `Cleared legacy token file: ${legacyPath}`);
        } catch (error) {
          // File doesn't exist or can't be removed - that's fine for legacy cleanup
          this.logger.debug(
            () => `Could not remove legacy token file ${legacyPath}: ${error}`,
          );
        }
      }),
    );

    // Log any unexpected failures for debugging
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.debug(
          () =>
            `Legacy cleanup failed for ${legacyPaths[index]}: ${result.reason}`,
        );
      }
    });
  }
}
