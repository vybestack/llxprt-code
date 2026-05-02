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

import type { OAuthProvider, OAuthToken, TokenStore } from './types.js';
import {
  clearOauthClientCache,
  OAuthErrorFactory,
  GracefulErrorHandler,
  RetryHandler,
  shouldLaunchBrowser,
  DebugLogger,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Credentials } from 'google-auth-library';
import type { HistoryItemWithoutId } from '../ui/types.js';
import { globalOAuthUI } from './global-oauth-ui.js';
import { InitializationGuard, AuthCodeDialog } from './oauth-provider-base.js';

export class GeminiOAuthProvider implements OAuthProvider {
  name = 'gemini';
  private currentToken: OAuthToken | null = null;
  private tokenStore?: TokenStore;
  private initGuard: InitializationGuard;
  private dialog: AuthCodeDialog;
  private errorHandler: GracefulErrorHandler;
  private retryHandler: RetryHandler;
  private logger: DebugLogger;
  private addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp?: number,
  ) => number;

  constructor(
    tokenStore?: TokenStore,
    addItem?: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp?: number,
    ) => number,
  ) {
    this.tokenStore = tokenStore;
    this.retryHandler = new RetryHandler();
    this.errorHandler = new GracefulErrorHandler(this.retryHandler);
    this.logger = new DebugLogger('llxprt:auth:gemini');
    this.addItem = addItem;
    this.initGuard = new InitializationGuard('wrap', this.name);
    this.dialog = new AuthCodeDialog();

    if (!tokenStore) {
      debugLogger.warn(
        `DEPRECATION: ${this.name} OAuth provider created without TokenStore. ` +
          `Token persistence will not work. Please update your code.`,
      );
    }

    this.installPersistentAuthCodeHook();

    // DO NOT call initializeToken() - lazy initialization pattern
  }

  /**
   * Set the addItem callback for displaying messages in the UI
   */
  setAddItem(
    addItem: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp?: number,
    ) => number,
  ): void {
    this.addItem = addItem;
  }

  /**
   * Wait for authorization code from UI dialog
   */
  waitForAuthCode(): Promise<string> {
    return this.dialog.waitForAuthCode();
  }

  /**
   * Submit authorization code from UI dialog
   */
  submitAuthCode(code: string): void {
    this.dialog.submitAuthCode(code);
  }

  /**
   * Cancel OAuth flow
   */
  cancelAuth(): void {
    this.dialog.cancelAuth(this.name);
  }

  private async ensureInitialized(): Promise<void> {
    return this.initGuard.ensureInitialized(() => this.initializeToken());
  }

  async initializeToken(): Promise<void> {
    if (!this.tokenStore) {
      return;
    }

    return this.errorHandler.handleGracefully(
      async () => {
        // Try to load from new location first
        let savedToken = await this.tokenStore!.getToken('gemini');

        // Try to migrate from legacy locations
        savedToken ??= await this.migrateFromLegacyTokens();

        if (savedToken) {
          this.currentToken = savedToken;
        }
      },
      undefined, // No fallback needed - graceful failure is acceptable
      this.name,
      'initializeToken',
    );
  }

  async initiateAuth(): Promise<OAuthToken> {
    await this.ensureInitialized();

    return this.errorHandler.wrapMethod(
      async () => {
        const cleanupAuthHooks = this.installAuthCodeHooks();
        try {
          const client = await this.getOauthClientWithErrorHandling();
          return await this.extractAndPersistToken(client.credentials);
        } finally {
          cleanupAuthHooks();
        }
      },
      this.name,
      'initiateAuth',
    )();
  }

  /**
   * Obtain a Google OAuth client, converting cancellation errors into
   * user-friendly OAuthErrors and showing fallback instructions.
   */
  private async getOauthClientWithErrorHandling(): Promise<{
    credentials: Credentials;
  }> {
    const coreModule = await import('@vybestack/llxprt-code-core');
    const { getOauthClient } = coreModule;

    let noBrowser = false;
    try {
      const { getEphemeralSetting } = await import(
        '../runtime/runtimeSettings.js'
      );
      const noBrowserSetting = getEphemeralSetting('auth.noBrowser') as
        | boolean
        | undefined;
      noBrowser = noBrowserSetting ?? false;
    } catch {
      // Runtime not initialized (e.g., tests) — use default
    }
    const config = {
      getProxy: () => undefined,
      isBrowserLaunchSuppressed: () =>
        !shouldLaunchBrowser({ forceManual: noBrowser }),
    } as unknown as Parameters<typeof getOauthClient>[0];

    try {
      return await getOauthClient(config);
    } catch (error) {
      if (error instanceof Error) {
        if (this.addItem) {
          this.addItem(
            {
              type: 'error',
              text: `Browser authentication failed: ${error.message}\nPlease try again or use an API key with /keyfile <path-to-your-gemini-key>`,
            },
            Date.now(),
          );
        } else {
          globalOAuthUI.callAddItem(
            {
              type: 'error',
              text: `Browser authentication failed: ${error.message}\nPlease try again or use an API key with /keyfile <path-to-your-gemini-key>`,
            },
            Date.now(),
          );
        }

        if (
          error.message.includes('cancelled') ||
          error.message.includes('denied') ||
          error.message.includes('access_denied') ||
          error.message.includes('user_cancelled')
        ) {
          this.logger.debug(
            () =>
              `Browser auth cancelled, triggering fallback: ${error.message}`,
          );
          this.showGeminiFallbackInstructions();
          throw OAuthErrorFactory.authenticationRequired(this.name, {
            reason:
              'Browser authentication was cancelled or failed. Please use one of the fallback options shown above, or check the URL in your history.',
          });
        }
      }
      throw error;
    }
  }

  /**
   * Show Gemini authentication fallback instructions via addItem or console.
   */
  private showGeminiFallbackInstructions(): void {
    const fallbackMessage = `Browser authentication was cancelled or failed.\nFallback options:\n1. Use API key: /keyfile <path-to-your-gemini-key>\n2. Set environment: export GEMINI_API_KEY=<your-key>\n3. Try OAuth again: /auth gemini enable`;

    if (this.addItem) {
      this.addItem({ type: 'info', text: fallbackMessage }, Date.now());
    } else {
      const delivered = globalOAuthUI.callAddItem(
        { type: 'info', text: fallbackMessage },
        Date.now(),
      );
      if (delivered === undefined) {
        debugLogger.log('\n' + '─'.repeat(60));
        debugLogger.log('Browser authentication was cancelled or failed.');
        debugLogger.log('Fallback options:');
        debugLogger.log('1. Use API key: /keyfile <path-to-your-gemini-key>');
        debugLogger.log('2. Set environment: export GEMINI_API_KEY=<your-key>');
        debugLogger.log('3. Try OAuth again: /auth gemini enable');
        debugLogger.log('─'.repeat(60));
      }
    }
  }

  /**
   * Extract an OAuthToken from Google credentials and persist it.
   */
  private async extractAndPersistToken(
    credentials: Credentials,
  ): Promise<OAuthToken> {
    if (!credentials.access_token) {
      throw OAuthErrorFactory.authenticationRequired(this.name, {
        reason: 'No valid credentials received from Google OAuth',
      });
    }

    const token = this.credentialsToOAuthToken(credentials);
    if (!token) {
      throw OAuthErrorFactory.authenticationRequired(this.name, {
        reason: 'Failed to convert credentials to OAuthToken',
      });
    }

    if (this.tokenStore) {
      try {
        await this.tokenStore.saveToken('gemini', token);
      } catch (saveError) {
        throw OAuthErrorFactory.storageError(
          this.name,
          saveError instanceof Error ? saveError : undefined,
          { operation: 'saveToken' },
        );
      }
    }

    this.currentToken = token;

    if (this.addItem) {
      this.addItem(
        {
          type: 'info',
          text: 'Successfully authenticated with Google Gemini!',
        },
        Date.now(),
      );
    } else {
      const delivered = globalOAuthUI.callAddItem(
        {
          type: 'info',
          text: 'Successfully authenticated with Google Gemini!',
        },
        Date.now(),
      );
      if (delivered === undefined) {
        debugLogger.log('Successfully authenticated with Google Gemini!');
      }
    }

    return token;
  }

  async getToken(): Promise<OAuthToken | null> {
    await this.ensureInitialized();

    return this.errorHandler.handleGracefully(
      async () => {
        // Read-only - no refresh, no migration writes
        // Try to get from current token first
        if (this.currentToken) {
          return this.currentToken;
        }

        // Try to get from existing Google OAuth infrastructure
        const token = await this.getTokenFromGoogleOAuth();

        // Update in-memory cache (but DO NOT persist)
        if (token) {
          this.currentToken = token;
        }

        return token;
      },
      null, // Return null on error
      this.name,
      'getToken',
    );
  }

  async refreshToken(_currentToken: OAuthToken): Promise<OAuthToken | null> {
    await this.ensureInitialized();
    return null;
  }

  /**
   * GeminiOAuthProvider manages authentication externally via LOGIN_WITH_GOOGLE.
   * Returns true to signal that authentication status is determined by the
   * Google OAuth infrastructure, not the token store.
   *
   * Gemini regularization G1 — see plan.md.
   */
  async isAuthenticated(): Promise<boolean> {
    return true;
  }

  async logout(_token?: OAuthToken): Promise<void> {
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
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: normalize null/undefined/empty-string to undefined
      refresh_token: creds.refresh_token || undefined,
      // Google OAuth uses expiry_date (milliseconds), we need expiry (seconds)
      // Explicitly check for valid timestamp (non-nullish, non-zero, non-NaN)
      expiry:
        creds.expiry_date !== null &&
        creds.expiry_date !== undefined &&
        creds.expiry_date > 0 &&
        !Number.isNaN(creds.expiry_date)
          ? Math.floor(creds.expiry_date / 1000)
          : Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer' as const,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: normalize null/undefined/empty-string to undefined
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

        if (token) {
          this.logger.debug(
            () => 'Found Gemini token in legacy location (read-only)',
          );
          return token;
        }

        return null;
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

  /**
   * Install a persistent auth-code hook so ANY code path that triggers OAuth
   * (e.g. streaming re-auth) can use the UI dialog instead of readline (Issue #1370).
   */
  private installPersistentAuthCodeHook(): void {
    const globalObj = global as Record<string, unknown>;
    if (globalObj.__oauth_wait_for_code === undefined || globalObj.__oauth_wait_for_code === null) {
      globalObj.__oauth_wait_for_code = () => this.waitForAuthCode();
      globalObj.__oauth_provider = this.name;
    }
  }

  /**
   * Install auth-code hooks so oauth2.ts can ask the UI for the code instead of readline
   */
  private installAuthCodeHooks(): () => void {
    const globalObj = global as Record<string, unknown>;
    const previousWaitForCode = globalObj.__oauth_wait_for_code;
    const previousProvider = globalObj.__oauth_provider;
    globalObj.__oauth_wait_for_code = () => this.waitForAuthCode();
    globalObj.__oauth_provider = this.name;

    return () => {
      if (previousWaitForCode !== undefined) {
        globalObj.__oauth_wait_for_code = previousWaitForCode;
      } else {
        delete globalObj.__oauth_wait_for_code;
      }

      if (previousProvider !== undefined) {
        globalObj.__oauth_provider = previousProvider;
      } else {
        delete globalObj.__oauth_provider;
      }
    };
  }
}
