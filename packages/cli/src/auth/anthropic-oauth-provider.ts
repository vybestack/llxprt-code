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
  debugLogger,
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
  private currentAuthAttemptId?: string;
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
      debugLogger.warn(
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
    (global as unknown as { __oauth_needs_code: boolean }).__oauth_needs_code =
      false;
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

  async initiateAuth(): Promise<OAuthToken> {
    return this.errorHandler.wrapMethod(
      async () => {
        // Cancel any previous auth attempt's pending dialog
        const attemptId = crypto.randomUUID();
        if (this.currentAuthAttemptId) {
          this.cancelAuth();
        }
        this.currentAuthAttemptId = attemptId;

        await this.ensureInitialized();
        const deviceCodeResponse = await this.deviceFlow.initiateDeviceFlow();
        let noBrowser = false;
        try {
          const { getEphemeralSetting } = await import(
            '../runtime/runtimeSettings.js'
          );
          noBrowser =
            (getEphemeralSetting('auth.noBrowser') as boolean) ?? false;
        } catch {
          // Runtime not initialized (e.g., tests) — use default
        }
        const interactive = shouldLaunchBrowser({ forceManual: noBrowser });
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

        // Always build the device code URL for user-facing display
        const deviceCodeUrl =
          deviceCodeResponse.verification_uri_complete ||
          `${deviceCodeResponse.verification_uri}?user_code=${deviceCodeResponse.user_code}`;

        // Build callback URL for browser if local callback is available
        const callbackUrl = localCallback
          ? this.deviceFlow.buildAuthorizationUrl(localCallback.redirectUri)
          : null;

        // Always display the device code URL to the user (never the callback URL)
        const message = `Please visit the following URL to authorize with Anthropic Claude:\n${deviceCodeUrl}`;
        const historyItem: HistoryItemOAuthURL = {
          type: 'oauth_url',
          text: message,
          url: deviceCodeUrl,
        };
        // Try instance addItem first, fallback to global
        const addItem = this.addItem || globalOAuthUI.getAddItem();
        if (addItem) {
          addItem(historyItem, Date.now());
        }

        debugLogger.log('Visit the following URL to authorize:');
        debugLogger.log(deviceCodeUrl);

        // Copy device code URL to clipboard with error handling
        try {
          await ClipboardService.copyToClipboard(deviceCodeUrl);
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
          debugLogger.log('Opening browser for authentication...');

          // Open browser with callback URL if available, else device code URL
          const browserUrl = callbackUrl || deviceCodeUrl;
          try {
            await openBrowserSecurely(browserUrl);
          } catch (error) {
            this.logger.debug(() => `Browser launch error: ${error}`);
          }
        }

        // Set up the manual code entry dialog (paste box) for ALL modes
        // In interactive mode, this races against the callback
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

        // If we have a local callback server, race callback against manual code entry
        if (localCallback) {
          const callbackPromise = localCallback
            .waitForCallback()
            .then(({ code, state }) => `${code}#${state}`);

          try {
            const authCode = await Promise.race([
              callbackPromise,
              this.pendingAuthPromise,
            ]);

            // Suppress unhandled rejection from the losing branch
            this.pendingAuthPromise.catch(() => {});
            callbackPromise.catch(() => {});

            // Whichever succeeded, clean up the other
            await localCallback.shutdown().catch(() => undefined);
            (
              global as unknown as { __oauth_needs_code: boolean }
            ).__oauth_needs_code = false;
            // Signal that browser auth completed successfully (Issue #1404)
            (
              global as unknown as { __oauth_browser_auth_complete: boolean }
            ).__oauth_browser_auth_complete = true;

            if (this.currentAuthAttemptId === attemptId) {
              return await this.completeAuth(authCode);
            }
            throw new Error('Auth attempt cancelled');
          } catch (error) {
            // Suppress unhandled rejection from the losing branch
            callbackPromise.catch(() => {});
            this.pendingAuthPromise.catch(() => {});

            // Both paths failed or callback failed - fall through to manual entry
            await localCallback.shutdown().catch(() => undefined);
            this.logger.debug(
              () =>
                `Local OAuth callback failed, falling back to manual entry: ${
                  error instanceof Error ? error.message : String(error)
                }`,
            );

            // If the pending auth promise also rejected (timeout), re-throw
            // Otherwise, the dialog is still open for manual entry
            if (this.authCodeResolver) {
              // Dialog is still open, wait for manual code entry
              const authCode = await this.pendingAuthPromise;
              if (this.currentAuthAttemptId === attemptId) {
                return this.completeAuth(authCode);
              }
              throw new Error('Auth attempt cancelled');
            }
            throw error;
          }
        }

        // Non-interactive mode (no browser, no local callback)
        // Wait for manual code entry via paste box
        const authCode = await this.pendingAuthPromise;

        if (this.currentAuthAttemptId === attemptId) {
          return this.completeAuth(authCode);
        }
        throw new Error('Auth attempt cancelled');
      },
      this.name,
      'initiateAuth',
    )();
  }

  /**
   * Complete authentication with the authorization code
   * Returns the token for OAuthManager to persist with correct bucket
   */
  async completeAuth(authCode: string): Promise<OAuthToken> {
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

        // Clear the dialog flag on successful auth
        (
          global as unknown as { __oauth_needs_code: boolean }
        ).__oauth_needs_code = false;

        this.logger.debug(
          () => 'Successfully authenticated with Anthropic Claude!',
        );

        return token;
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
      // Issue #1378: Return token as-is; OAuthManager owns all refresh operations
      async () => this._tokenStore!.getToken('anthropic'),
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
    this.logger.debug(
      () =>
        'refreshIfNeeded() is deprecated — refresh is handled by OAuthManager',
    );
    return null;
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
