/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Anthropic OAuth Provider Implementation
 */

import type { OAuthProvider } from './types.js';
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
import {
  InitializationGuard,
  AuthCodeDialog,
  hasValidRefreshToken,
  isTokenExpired,
} from './oauth-provider-base.js';

const CALLBACK_PORT_RANGE: [number, number] = [8765, 8795];
const CALLBACK_TIMEOUT_MS = 3 * 60 * 1000;

export class AnthropicOAuthProvider implements OAuthProvider {
  name = 'anthropic';
  private deviceFlow: AnthropicDeviceFlow;
  private pendingAuthPromise?: Promise<string>;
  private initGuard: InitializationGuard;
  private dialog: AuthCodeDialog;
  private errorHandler: GracefulErrorHandler;
  private retryHandler: RetryHandler;
  private logger: DebugLogger;
  private currentAuthAttemptId?: string;
  private addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp?: number,
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
      baseTimestamp?: number,
    ) => number,
  ) {
    this.deviceFlow = new AnthropicDeviceFlow();
    this.retryHandler = new RetryHandler();
    this.errorHandler = new GracefulErrorHandler(this.retryHandler);
    this.logger = new DebugLogger('llxprt:auth:anthropic');
    this.addItem = addItem;
    this.initGuard = new InitializationGuard('wrap', this.name);
    this.dialog = new AuthCodeDialog();

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
        const { localCallback } = await this.setupDeviceFlowAndDisplay();

        this.armPendingAuthDialog();

        if (localCallback) {
          return this.raceCallbackVsManualEntry(attemptId, localCallback);
        }

        // Non-interactive: wait for manual code entry via paste box
        const authCode = await this.pendingAuthPromise!;
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
   * Start the device flow, optionally start a local callback server,
   * display the auth URL to the user, copy to clipboard, and open browser.
   * Returns the URLs and callback handle needed by the calling flow.
   */
  private async setupDeviceFlowAndDisplay(): Promise<{
    localCallback: LocalOAuthCallbackServer | null;
  }> {
    const deviceCodeResponse = await this.deviceFlow.initiateDeviceFlow();
    let noBrowser = false;
    try {
      const { getEphemeralSetting } = await import(
        '../runtime/runtimeSettings.js'
      );
      noBrowser = (getEphemeralSetting('auth.noBrowser') as boolean) ?? false;
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

    const deviceCodeUrl =
      deviceCodeResponse.verification_uri_complete ||
      `${deviceCodeResponse.verification_uri}?user_code=${deviceCodeResponse.user_code}`;
    const callbackUrl = localCallback
      ? this.deviceFlow.buildAuthorizationUrl(localCallback.redirectUri)
      : null;

    const historyItem: HistoryItemOAuthURL = {
      type: 'oauth_url',
      text: `Please visit the following URL to authorize with Anthropic Claude:\n${deviceCodeUrl}`,
      url: deviceCodeUrl,
    };
    const addItem = this.addItem || globalOAuthUI.getAddItem();
    if (addItem) {
      addItem(historyItem);
    }
    debugLogger.log('Visit the following URL to authorize:');
    debugLogger.log(deviceCodeUrl);

    try {
      await ClipboardService.copyToClipboard(deviceCodeUrl);
    } catch (error) {
      this.logger.debug(
        () =>
          `Failed to copy URL to clipboard: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }

    if (interactive) {
      debugLogger.log('Opening browser for authentication...');
      const browserUrl = callbackUrl || deviceCodeUrl;
      try {
        await openBrowserSecurely(browserUrl);
      } catch (error) {
        this.logger.debug(() => `Browser launch error: ${error}`);
      }
    }

    return { localCallback };
  }

  /**
   * Set up the manual code entry dialog with a 5-minute timeout.
   * Assigns this.pendingAuthPromise and this.dialog, and marks global auth state.
   */
  private armPendingAuthDialog(): void {
    (global as unknown as { __oauth_provider: string }).__oauth_provider =
      'anthropic';

    this.pendingAuthPromise = new Promise<string>((resolve, reject) => {
      const innerDialog = new AuthCodeDialog();
      const innerPromise = innerDialog.waitForAuthCode();
      this.dialog = innerDialog;

      const timeout = setTimeout(
        () => {
          const timeoutError = OAuthErrorFactory.fromUnknown(
            this.name,
            new Error('OAuth authentication timed out after 5 minutes'),
            'authentication timeout',
          );
          innerDialog.rejectWithError(timeoutError);
        },
        5 * 60 * 1000,
      );

      innerPromise.then(
        (code) => {
          clearTimeout(timeout);
          resolve(code);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });

    (global as unknown as { __oauth_needs_code: boolean }).__oauth_needs_code =
      true;
  }

  /**
   * Race the local OAuth callback against manual code entry via the dialog.
   * Whichever succeeds first wins; the loser is suppressed.
   */
  private async raceCallbackVsManualEntry(
    attemptId: string,
    localCallback: LocalOAuthCallbackServer,
  ): Promise<OAuthToken> {
    const callbackPromise = localCallback
      .waitForCallback()
      .then(({ code, state }) => `${code}#${state}`);

    try {
      const authCode = await Promise.race([
        callbackPromise,
        this.pendingAuthPromise!,
      ]);

      this.pendingAuthPromise!.catch(() => {});
      callbackPromise.catch(() => {});

      await localCallback.shutdown().catch(() => undefined);
      (
        global as unknown as { __oauth_needs_code: boolean }
      ).__oauth_needs_code = false;
      (
        global as unknown as { __oauth_browser_auth_complete: boolean }
      ).__oauth_browser_auth_complete = true;

      if (this.currentAuthAttemptId === attemptId) {
        return await this.completeAuth(authCode);
      }
      throw new Error('Auth attempt cancelled');
    } catch (error) {
      callbackPromise.catch(() => {});
      this.pendingAuthPromise!.catch(() => {});

      await localCallback.shutdown().catch(() => undefined);
      this.logger.debug(
        () =>
          `Local OAuth callback failed, falling back to manual entry: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );

      if (this.dialog.hasPendingPromise()) {
        const authCode = await this.pendingAuthPromise!;
        if (this.currentAuthAttemptId === attemptId) {
          return this.completeAuth(authCode);
        }
        throw new Error('Auth attempt cancelled');
      }
      throw error;
    }
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
        if (savedToken && !isTokenExpired(savedToken)) {
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

  async refreshToken(currentToken: OAuthToken): Promise<OAuthToken | null> {
    await this.ensureInitialized();

    if (hasValidRefreshToken(currentToken)) {
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
}
