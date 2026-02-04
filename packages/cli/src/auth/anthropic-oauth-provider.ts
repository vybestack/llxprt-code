/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Anthropic OAuth Provider Implementation
 */

import { OAuthProvider } from './oauth-manager.js';
import {
  OAuthToken,
  AnthropicDeviceFlow,
  openBrowserSecurely,
  shouldLaunchBrowser,
  TokenStore,
  OAuthError,
  OAuthErrorFactory,
  GracefulErrorHandler,
  RetryHandler,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import { ClipboardService } from '../services/ClipboardService.js';
import { HistoryItemWithoutId, HistoryItemOAuthURL } from '../ui/types.js';
import {
  LocalOAuthCallbackServer,
  startLocalOAuthCallback,
} from './local-oauth-callback.js';
import { globalOAuthUI } from './global-oauth-ui.js';

enum InitializationState {
  NotStarted = 'not-started',
  InProgress = 'in-progress',
  Completed = 'completed',
  Failed = 'failed',
}

const CALLBACK_PORT_RANGE: [number, number] = [8765, 8795];
const CALLBACK_TIMEOUT_MS = 3 * 60 * 1000;

export class AnthropicOAuthProvider implements OAuthProvider {
  name = 'anthropic';
  private deviceFlow: AnthropicDeviceFlow;
  private authCodeResolver?: (code: string) => void;
  private authCodeRejecter?: (error: Error) => void;
  private pendingAuthPromise?: Promise<string>;
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

  /**
   * @plan PLAN-20250823-AUTHFIXES.P06
   * @requirement REQ-001.1
   * @pseudocode lines 7-10
   *
   * Constructor completes synchronously - no async calls
   */
  constructor(
    private _tokenStore?: TokenStore,
    addItem?: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp: number,
    ) => number,
  ) {
    this.deviceFlow = new AnthropicDeviceFlow();
    this.retryHandler = new RetryHandler();
    this.errorHandler = new GracefulErrorHandler(this.retryHandler);
    this.logger = new DebugLogger('llxprt:auth:anthropic');
    this.addItem = addItem;

    /**
     * @plan PLAN-20250823-AUTHFIXES.P16
     * @requirement REQ-004.2
     * Deprecation warning for missing TokenStore
     */
    if (!_tokenStore) {
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
        new Error('OAuth authentication cancelled'),
        'cancelAuth',
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

  async initiateAuth(): Promise<void> {
    return this.errorHandler.wrapMethod(
      async () => {
        await this.ensureInitialized();
        const deviceCodeResponse = await this.deviceFlow.initiateDeviceFlow();
        const interactive = shouldLaunchBrowser();
        let localCallback: LocalOAuthCallbackServer | null = null;

        if (interactive) {
          try {
            const state = this.deviceFlow.getState();
            localCallback = await startLocalOAuthCallback({
              state,
              portRange: CALLBACK_PORT_RANGE,
              timeoutMs: CALLBACK_TIMEOUT_MS,
            });
          } catch (error) {
            this.logger.debug(
              () =>
                `Local OAuth callback unavailable: ${
                  error instanceof Error ? error.message : String(error)
                }`,
            );
          }
        }

        // In interactive mode with local callback, use the redirect-based URL
        // In non-interactive or fallback mode, use the device code URL
        let authUrl: string;
        if (localCallback) {
          // Browser-based OAuth with local callback server
          authUrl = this.deviceFlow.buildAuthorizationUrl(
            localCallback.redirectUri,
          );
        } else {
          // Device flow URL (for non-interactive or when callback server fails)
          authUrl =
            deviceCodeResponse.verification_uri_complete ||
            `${deviceCodeResponse.verification_uri}?user_code=${deviceCodeResponse.user_code}`;
        }

        // Show the auth URL in the TUI
        const message = `Please visit the following URL to authorize with Anthropic Claude:\\n${authUrl}`;
        const historyItem: HistoryItemOAuthURL = {
          type: 'oauth_url',
          text: message,
          url: authUrl,
        };
        // Try instance addItem first, fallback to global
        const addItem = this.addItem || globalOAuthUI.getAddItem();
        if (addItem) {
          addItem(historyItem, Date.now());
        }

        console.log('Visit the following URL to authorize:');
        console.log(authUrl);

        // Copy URL to clipboard with error handling
        try {
          await ClipboardService.copyToClipboard(authUrl);
        } catch (error) {
          // Clipboard copy is non-critical, continue without it
          this.logger.debug(
            () =>
              `Failed to copy URL to clipboard: ${
                error instanceof Error ? error.message : String(error)
              }`,
          );
        }

        if (interactive) {
          console.log('Opening browser for authentication...');

          try {
            await openBrowserSecurely(authUrl);
          } catch (error) {
            this.logger.debug(() => `Browser launch error: ${error}`);
          }
        }

        // If we have a local callback server, wait for it - this is the primary flow
        // for interactive mode. Only fall back to paste box if callback fails.
        if (localCallback) {
          try {
            const { code, state } = await localCallback.waitForCallback();
            await localCallback.shutdown();
            await this.completeAuth(`${code}#${state}`);
            return; // Success! Don't fall through to paste box.
          } catch (error) {
            await localCallback.shutdown().catch(() => undefined);
            this.logger.debug(
              () =>
                `Local OAuth callback failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
            );
            // Local callback failed - throw the error rather than falling back to paste box
            // in interactive mode. The user should retry.
            throw OAuthErrorFactory.fromUnknown(
              this.name,
              error instanceof Error
                ? error
                : new Error('OAuth callback failed'),
              'local callback',
            );
          }
        }

        // Only reach here in non-interactive mode (no browser, no local callback)
        // This is the device code / paste box flow for headless environments
        (global as unknown as { __oauth_provider: string }).__oauth_provider =
          'anthropic';

        this.pendingAuthPromise = new Promise<string>((resolve, reject) => {
          this.authCodeResolver = resolve;
          this.authCodeRejecter = reject;
          setTimeout(
            () => {
              const timeoutError = OAuthErrorFactory.fromUnknown(
                this.name,
                new Error('OAuth authentication timed out after 5 minutes'),
                'authentication timeout',
              );
              reject(timeoutError);
            },
            5 * 60 * 1000,
          );
        });

        (
          global as unknown as { __oauth_needs_code: boolean }
        ).__oauth_needs_code = true;

        const authCode = await this.pendingAuthPromise;

        await this.completeAuth(authCode);
      },
      this.name,
      'initiateAuth',
    )();
  }

  /**
   * Complete authentication with the authorization code
   * @pseudocode lines 60-62: Save token after successful auth
   */
  async completeAuth(authCode: string): Promise<void> {
    if (!authCode) {
      throw OAuthErrorFactory.fromUnknown(
        this.name,
        new Error('No authorization code provided'),
        'completeAuth',
      );
    }

    return this.errorHandler.wrapMethod(
      async () => {
        // Exchange the authorization code for tokens
        const token = await this.deviceFlow.exchangeCodeForToken(authCode);

        // @pseudocode line 61: Save token to store
        if (this._tokenStore) {
          try {
            await this._tokenStore.saveToken('anthropic', token);
          } catch (error) {
            throw OAuthErrorFactory.storageError(
              this.name,
              error instanceof Error ? error : undefined,
              {
                operation: 'saveToken',
                provider: 'anthropic',
              },
            );
          }
        }

        this.logger.debug(
          () => 'Successfully authenticated with Anthropic Claude!',
        );
      },
      this.name,
      'completeAuth',
    )();
  }
  /**
   * @plan PLAN-20250823-AUTHFIXES.P08
   * @requirement REQ-001.1
   * @pseudocode lines 17-25
   */
  async initializeToken(): Promise<void> {
    if (!this._tokenStore) {
      return;
    }

    return this.errorHandler.handleGracefully(
      async () => {
        // @pseudocode line 19: Load saved token from store
        const savedToken = await this._tokenStore!.getToken('anthropic');
        // @pseudocode lines 20-22: Check if token exists and not expired
        if (savedToken && !this.isTokenExpired(savedToken)) {
          return; // Token is valid, ready to use
        }
      },
      undefined, // No fallback needed - graceful failure is acceptable
      this.name,
      'initializeToken',
    );
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P08
   * @requirement REQ-001.1
   * @pseudocode lines 71-72
   */
  async getToken(): Promise<OAuthToken | null> {
    await this.ensureInitialized();
    if (!this._tokenStore) {
      return null;
    }

    return this.errorHandler.handleGracefully(
      async () => {
        // @pseudocode line 72: Return token from store, but check if refresh is needed
        const token = await this._tokenStore!.getToken('anthropic');
        if (token && this.isTokenExpired(token)) {
          // Token is expired or near expiry, try to refresh
          return await this.refreshIfNeeded();
        }
        return token;
      },
      null, // Return null on error
      this.name,
      'getToken',
    );
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P08
   * @requirement REQ-001.1
   * @pseudocode lines 74-98
   *
   * Issue #1159: Prevents race conditions when multiple clients refresh the same token
   * Flow:
   * 1. Check disk for updated token (another client may have already refreshed)
   * 2. Try to acquire refresh lock
   * 3. If lock acquired, re-check disk and refresh if still needed
   * 4. If lock not acquired, wait and re-check disk
   */
  async refreshIfNeeded(): Promise<OAuthToken | null> {
    await this.ensureInitialized();
    if (!this._tokenStore) {
      return null;
    }

    // @pseudocode line 75: Get current token from store
    const currentToken = await this._tokenStore.getToken('anthropic');

    // @pseudocode lines 77-79: Return null if no token
    if (!currentToken) {
      return null;
    }

    // @pseudocode line 81: Check if token is expired
    if (this.isTokenExpired(currentToken)) {
      // Issue #1159: Check disk for updated token before attempting refresh
      const diskToken = await this._tokenStore.getToken('anthropic');
      if (
        diskToken &&
        !this.isTokenExpired(diskToken) &&
        diskToken.access_token !== currentToken.access_token
      ) {
        // Token was already refreshed by another client
        this.logger.debug(
          () =>
            'Token was already refreshed by another process, using updated version from disk',
        );
        return diskToken;
      }

      // @pseudocode line 82: Check if refresh token exists and is valid
      if (this.hasValidRefreshToken(currentToken)) {
        // Issue #1159: Try to acquire lock to prevent concurrent refreshes
        const lockAcquired = await this._tokenStore.acquireRefreshLock(
          'anthropic',
          {
            waitMs: 10000, // Wait up to 10 seconds
            staleMs: 30000, // Break locks older than 30 seconds
          },
        );

        if (!lockAcquired) {
          // Failed to acquire lock, check disk again for updated token
          this.logger.debug(
            () =>
              'Failed to acquire refresh lock, checking disk for updated token',
          );
          const updatedToken = await this._tokenStore.getToken('anthropic');
          if (updatedToken && !this.isTokenExpired(updatedToken)) {
            return updatedToken;
          }
          // Still expired, return null to trigger re-auth
          return null;
        }

        try {
          // Re-check disk after acquiring lock (double-check pattern)
          const recheckToken = await this._tokenStore.getToken('anthropic');
          if (
            recheckToken &&
            !this.isTokenExpired(recheckToken) &&
            recheckToken.access_token !== currentToken.access_token
          ) {
            // Another process refreshed while we were waiting for lock
            this.logger.debug(
              () =>
                'Token was refreshed while waiting for lock, using updated version',
            );
            return recheckToken;
          }

          // @pseudocode lines 84-86: Refresh the token
          const refreshedToken = await this.deviceFlow.refreshToken(
            currentToken.refresh_token,
          );

          try {
            await this._tokenStore.saveToken('anthropic', refreshedToken);
          } catch (saveError) {
            throw OAuthErrorFactory.storageError(
              this.name,
              saveError instanceof Error ? saveError : undefined,
              {
                operation: 'saveRefreshedToken',
              },
            );
          }

          return refreshedToken;
        } catch (error) {
          // @pseudocode lines 88-90: Remove invalid token on refresh failure
          const refreshError =
            error instanceof OAuthError
              ? error
              : OAuthErrorFactory.authorizationExpired(this.name, {
                  originalError:
                    error instanceof Error ? error.message : String(error),
                  operation: 'refreshToken',
                });

          this.logger.debug(
            () =>
              `Token refresh failed: ${JSON.stringify(refreshError.toLogEntry())}`,
          );

          try {
            await this._tokenStore.removeToken('anthropic');
          } catch (removeError) {
            this.logger.debug(
              () => `Failed to remove invalid token: ${removeError}`,
            );
          }

          return null;
        } finally {
          // Always release the lock
          await this._tokenStore
            .releaseRefreshLock('anthropic')
            .catch((releaseError) => {
              this.logger.debug(
                () => `Failed to release refresh lock: ${releaseError}`,
              );
            });
        }
      } else {
        // @pseudocode lines 93-95: Remove token without refresh capability
        await this._tokenStore.removeToken('anthropic');
        return null;
      }
    }

    // @pseudocode line 98: Return current valid token
    return currentToken;
  }

  async refreshToken(currentToken: OAuthToken): Promise<OAuthToken | null> {
    await this.ensureInitialized();

    if (this.hasValidRefreshToken(currentToken)) {
      try {
        const refreshedToken = await this.deviceFlow.refreshToken(
          currentToken.refresh_token,
        );

        return {
          ...currentToken,
          ...refreshedToken,
          refresh_token:
            refreshedToken.refresh_token ?? currentToken.refresh_token,
        };
      } catch (error) {
        const refreshError =
          error instanceof OAuthError
            ? error
            : OAuthErrorFactory.authorizationExpired(this.name, {
                originalError:
                  error instanceof Error ? error.message : String(error),
                operation: 'refreshToken',
              });

        this.logger.debug(
          () =>
            `Token refresh failed: ${JSON.stringify(refreshError.toLogEntry())}`,
        );

        return null;
      }
    }

    return null;
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P08
   * @requirement REQ-002.1
   * @pseudocode lines 100-112
   */
  async logout(token?: OAuthToken): Promise<void> {
    await this.ensureInitialized();

    // NO ERROR SUPPRESSION - let it fail loudly
    if (token) {
      try {
        if (this.deviceFlow.revokeToken) {
          await this.deviceFlow.revokeToken(token.access_token);
        } else {
          this.logger.debug(
            () =>
              'Token revocation not supported: revokeToken method not implemented',
          );
        }
      } catch (error) {
        this.logger.debug(
          () =>
            `Token revocation failed (continuing with local cleanup): ${error}`,
        );
      }
    }

    // @pseudocode line 112: Log successful logout
    this.logger.debug(() => 'Logged out of Anthropic Claude');
  }

  private hasValidRefreshToken(
    token: OAuthToken,
  ): token is OAuthToken & { refresh_token: string } {
    return (
      typeof token.refresh_token === 'string' &&
      token.refresh_token.trim().length > 0 &&
      token.refresh_token.length < 1000
    );
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P08
   * @requirement REQ-003.1
   * @pseudocode lines 27-30
   */
  private isTokenExpired(token: OAuthToken): boolean {
    // @pseudocode line 28: Get current time
    const now = Date.now() / 1000;
    // @pseudocode line 29: 30-second buffer
    const buffer = 30;
    // @pseudocode line 30: Check expiry with buffer
    return token.expiry <= now + buffer;
  }

  /**
   * Get usage information from Anthropic OAuth endpoint
   * Returns full usage data for Claude Code/Max plans
   * Only works with OAuth tokens (sk-ant-oat01-...), not API keys
   */
  async getUsageInfo(): Promise<Record<string, unknown> | null> {
    await this.ensureInitialized();
    if (!this._tokenStore) {
      return null;
    }

    const token = await this._tokenStore.getToken('anthropic');
    if (!token) {
      return null;
    }

    try {
      const { fetchAnthropicUsage } = await import(
        '@vybestack/llxprt-code-core'
      );
      const usageInfo = await fetchAnthropicUsage(token.access_token);

      return usageInfo;
    } catch (error) {
      this.logger.debug(
        () =>
          `Error fetching usage info: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      return null;
    }
  }
}
