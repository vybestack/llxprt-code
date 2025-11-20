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
  private authCodeResolver?: (code: string) => void;
  private authCodeRejecter?: (error: Error) => void;
  private pendingAuthPromise?: Promise<string>;

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
   * Wait for authorization code from UI dialog
   */
  waitForAuthCode(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.authCodeResolver = resolve;
      this.authCodeRejecter = reject;
    });
  }

  /**
   * Submit authorization code from UI dialog
   */
  submitAuthCode(code: string): void {
    if (this.authCodeResolver) {
      this.authCodeResolver(code);
      this.authCodeResolver = undefined;
      this.authCodeRejecter = undefined;
    }
  }

  /**
   * Cancel OAuth flow
   */
  cancelAuth(): void {
    if (this.authCodeRejecter) {
      const error = OAuthErrorFactory.fromUnknown(
        this.name,
        new Error('OAuth authentication was cancelled by user'),
        'user cancellation',
      );
      this.authCodeRejecter(error);
      this.authCodeResolver = undefined;
      this.authCodeRejecter = undefined;
    }
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


  /**
   * Fallback auth flow when browser cannot be opened
   * Displays URL and waits for user to paste authorization code
   */
  private async fallbackAuthFlow(): Promise<void> {
    await this.errorHandler.wrapMethod(
      async () => {
        const { OAuth2Client, CodeChallengeMethod } = await import('google-auth-library');
        const crypto = await import('crypto');
        
        // Generate PKCE parameters
        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        const codeChallenge = crypto
          .createHash('sha256')
          .update(codeVerifier)
          .digest('base64url');
        const state = crypto.randomBytes(32).toString('hex');

        // Create OAuth2 client with redirect URI for manual flow
        const redirectUri = 'http://localhost:8765/oauth2callback';
        const client = new OAuth2Client({
          clientId: process.env.GOOGLE_CLIENT_ID || '1087459693054-kh5t5o33ocq7ik2h62puk0q6lruqcuvj.apps.googleusercontent.com',
          clientSecret: process.env.GOOGLE_CLIENT_SECRET || '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',
          redirectUri,
        });

        // Generate authorization URL
        const authUrl = client.generateAuthUrl({
          access_type: 'offline',
          scope: [
            'https://www.googleapis.com/auth/generative-language.retriever',
            'https://www.googleapis.com/auth/userinfo.email',
          ],
          code_challenge_method: CodeChallengeMethod.S256,
          code_challenge: codeChallenge,
          state,
        });

        // Display URL to user
        const addItem = this.addItem || globalOAuthUI.getAddItem();
        if (addItem) {
          const historyItem: HistoryItemWithoutId = {
            type: 'oauth_url',
            text: `Please authorize with Gemini:\n1. Visit the URL below\n2. Complete authorization\n3. Paste the full callback URL (starting with http://localhost:8765/oauth2callback?...)`,
            url: authUrl,
          };
          addItem(historyItem, Date.now());
        }

        console.log('Visit the following URL to authorize:');
        console.log(authUrl);
        console.log('\nAfter authorizing, paste the full callback URL here.');

        // Set global flags for UI to detect
        (global as any).__oauth_provider = 'gemini';
        (global as any).__oauth_needs_code = true;

        // Wait for user to submit the callback URL
        this.pendingAuthPromise = new Promise<string>((resolve, reject) => {
          this.authCodeResolver = resolve;
          this.authCodeRejecter = reject;
          setTimeout(() => {
            const timeoutError = OAuthErrorFactory.fromUnknown(
              this.name,
              new Error('OAuth authentication timed out after 5 minutes'),
              'authentication timeout',
            );
            reject(timeoutError);
          }, 5 * 60 * 1000);
        });

        const callbackUrl = await this.pendingAuthPromise;

        // Parse the callback URL
        const urlObj = new URL(callbackUrl);
        const code = urlObj.searchParams.get('code');
        const returnedState = urlObj.searchParams.get('state');

        if (!code) {
          throw OAuthErrorFactory.fromUnknown(
            this.name,
            new Error('No authorization code in callback URL'),
            'invalid callback',
          );
        }

        if (returnedState !== state) {
          throw OAuthErrorFactory.fromUnknown(
            this.name,
            new Error('State mismatch in OAuth callback'),
            'security error',
          );
        }

        // Exchange code for tokens
        const { tokens } = await client.getToken({
          code,
          codeVerifier,
        });

        if (!tokens.access_token) {
          throw OAuthErrorFactory.fromUnknown(
            this.name,
            new Error('No access token received'),
            'token exchange failed',
          );
        }

        // Save the token
        const token: OAuthToken = {
          token_type: 'Bearer',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? undefined,
          expiry: tokens.expiry_date
            ? tokens.expiry_date
            : Date.now() + 3600 * 1000,
        };

        if (this.tokenStore) {
          await this.tokenStore.saveToken('gemini', token);
          this.currentToken = token;

          const addItem = this.addItem || globalOAuthUI.getAddItem();
          if (addItem) {
            addItem(
              {
                type: 'info',
                text: 'Successfully authenticated with Google Gemini!',
              },
              Date.now(),
            );
          }
        }
      },
      this.name,
      'fallbackAuthFlow',
    );
  }


  async initiateAuth(): Promise<void> {
    await this.ensureInitialized();

    await this.errorHandler.wrapMethod(
      async () => {
        const interactive = shouldLaunchBrowser();

        // If browser is not available, go straight to fallback
        if (!interactive) {
          this.logger.debug(() => 'Browser not available, using fallback flow');
          await this.fallbackAuthFlow();
          return;
        }

        // Import the existing Google OAuth infrastructure
        const coreModule = await import('@vybestack/llxprt-code-core');
        const { getOauthClient, AuthType } = coreModule;

        // Create a minimal config for OAuth - use type assertion for test environment
        // Type assertion is needed since we're creating a partial Config for test mode
        const config = {
          getProxy: () => undefined,
          isBrowserLaunchSuppressed: () => false,
        } as unknown as Parameters<typeof getOauthClient>[1];

        // Use the existing Google OAuth infrastructure to get a client
        let client;
        try {
          client = await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, config);
        } catch (error) {
          // Handle browser auth cancellation or other auth failures
          if (error instanceof Error) {
            // Check for specific cancellation messages - trigger fallback
            if (
              error.message.includes('cancelled') ||
              error.message.includes('denied') ||
              error.message.includes('access_denied') ||
              error.message.includes('user_cancelled') ||
              error.message.includes('Browser') ||
              error.message.includes('browser')
            ) {
              this.logger.debug(
                () =>
                  `Browser auth cancelled, attempting fallback: ${error.message}`,
              );

              // Attempt fallback flow
              await this.fallbackAuthFlow();
              return;
            }

            // Show error message to user for other errors
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
          }

          throw OAuthErrorFactory.fromUnknown(
            this.name,
            error,
            'failed to obtain OAuth client',
          );
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
            reason: 'OAuth succeeded but no credentials received',
          });
        }
      },
      this.name,
      'initiateAuth',
    );
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

    return this.errorHandler.handleGracefully(
      async () => {
        // First check if we have a current token
        if (!this.currentToken) {
          // Try to get from token store
          if (this.tokenStore) {
            const storedToken = await this.tokenStore.getToken('gemini');
            if (storedToken) {
              this.currentToken = storedToken;
            }
          }
        }

        if (!this.currentToken) {
          return null;
        }

        // Check if token is expired or about to expire (within 5 minutes)
        const expiryTime = this.currentToken.expiry;
        const isExpired = expiryTime && expiryTime < Date.now() + 5 * 60 * 1000;

        if (isExpired) {
          // Google OAuth doesn't support automatic refresh through our flow
          // User needs to re-authenticate
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
