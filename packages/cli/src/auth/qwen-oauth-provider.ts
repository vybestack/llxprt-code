/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250823-AUTHFIXES.P05
 * Qwen OAuth Provider Implementation
 */

import type { OAuthProvider } from './types.js';
import {
  type OAuthToken,
  QwenDeviceFlow,
  type DeviceFlowConfig,
  openBrowserSecurely,
  shouldLaunchBrowser,
  type TokenStore,
  OAuthError,
  OAuthErrorFactory,
  GracefulErrorHandler,
  RetryHandler,
  DebugLogger,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import { ClipboardService } from '../services/ClipboardService.js';
import type { HistoryItemWithoutId, HistoryItemOAuthURL } from '../ui/types.js';
import { globalOAuthUI } from './global-oauth-ui.js';
import { InitializationGuard, isTokenExpired } from './oauth-provider-base.js';

export class QwenOAuthProvider implements OAuthProvider {
  /**
   * @plan PLAN-20250823-AUTHFIXES.P05
   * @requirement REQ-001.1
   * @pseudocode line 5
   */
  name = 'qwen';
  private deviceFlow: QwenDeviceFlow;
  private initGuard: InitializationGuard;
  private errorHandler: GracefulErrorHandler;
  private retryHandler: RetryHandler;
  private logger: DebugLogger;
  private addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp?: number,
  ) => number;

  /**
   * @plan PLAN-20250823-AUTHFIXES.P05
   * @requirement REQ-001.1
   * @pseudocode lines 6-15
   *
   * Constructor completes synchronously - no async calls
   */
  constructor(
    private tokenStore?: TokenStore,
    addItem?: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp?: number,
    ) => number,
  ) {
    // Line 7: SET this.tokenStore = tokenStore
    this.tokenStore = tokenStore;
    this.retryHandler = new RetryHandler();
    this.errorHandler = new GracefulErrorHandler(this.retryHandler);
    this.logger = new DebugLogger('llxprt:auth:qwen');
    this.addItem = addItem;
    this.initGuard = new InitializationGuard('wrap', this.name);

    /**
     * @plan PLAN-20250823-AUTHFIXES.P16
     * @requirement REQ-004.2
     * Deprecation warning for missing TokenStore
     */
    if (!tokenStore) {
      debugLogger.warn(
        `DEPRECATION: ${this.name} OAuth provider created without TokenStore. ` +
          `Token persistence will not work. Please update your code.`,
      );
    }

    // Lines 8-13: SET config
    const config: DeviceFlowConfig = {
      clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
      authorizationEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
      tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
      scopes: ['openid', 'profile', 'email', 'model.completion'],
    };

    // Line 14: SET this.deviceFlow = new QwenDeviceFlow(config)
    this.deviceFlow = new QwenDeviceFlow(config);

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

  private async ensureInitialized(): Promise<void> {
    return this.initGuard.ensureInitialized(() => this.initializeToken());
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P05
   * @requirement REQ-001.1
   * @pseudocode lines 17-26
   */
  private async initializeToken(): Promise<void> {
    return this.errorHandler.handleGracefully(
      async () => {
        // Line 19: SET savedToken = AWAIT this.tokenStore.getToken('qwen')
        const savedToken = await this.tokenStore?.getToken('qwen');

        // Line 20: IF savedToken AND NOT this.isTokenExpired(savedToken)
        if (savedToken && !isTokenExpired(savedToken)) {
          // Line 21: RETURN
          return;
        }
      },
      undefined, // No fallback needed - graceful failure is acceptable
      this.name,
      'initializeToken',
    );
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P05
   * @requirement REQ-001.1
   * @pseudocode lines 32-57
   */
  async initiateAuth(): Promise<OAuthToken> {
    await this.ensureInitialized();

    return this.errorHandler.wrapMethod(
      async () => {
        const deviceCodeResponse = await this.deviceFlow.initiateDeviceFlow();

        const authUrl =
          deviceCodeResponse.verification_uri_complete ||
          `${deviceCodeResponse.verification_uri}?user_code=${deviceCodeResponse.user_code}`;

        await this.displayQwenAuthUrl(authUrl);
        await this.openQwenBrowserIfInteractive(authUrl);

        this.emitUIMessage(
          { type: 'info', text: 'Waiting for authorization...' },
          Date.now(),
        );

        const token = await this.deviceFlow.pollForToken(
          deviceCodeResponse.device_code,
        );

        this.emitUIMessage(
          { type: 'info', text: 'Authentication successful!' },
          Date.now(),
        );

        return token;
      },
      this.name,
      'initiateAuth',
    )();
  }

  /**
   * Display the Qwen auth URL in TUI and copy to clipboard.
   * Returns the addItem callback for subsequent messages.
   */
  private async displayQwenAuthUrl(
    authUrl: string,
  ): Promise<
    | ((item: Omit<HistoryItemWithoutId, 'id'>, ts?: number) => number)
    | undefined
  > {
    const historyItem: HistoryItemOAuthURL = {
      type: 'oauth_url',
      text: `Please visit the following URL to authorize with Qwen:\n${authUrl}`,
      url: authUrl,
    };

    if (this.addItem) {
      this.addItem(historyItem);
    } else {
      const delivered = globalOAuthUI.callAddItem(historyItem);
      if (delivered === undefined) {
        debugLogger.log('\nQwen OAuth Authentication');
        debugLogger.log('─'.repeat(40));
        debugLogger.log('Please visit the following URL to authorize:');
        debugLogger.log(authUrl);
      }
    }

    try {
      await ClipboardService.copyToClipboard(authUrl);
    } catch (error) {
      this.logger.debug(
        () =>
          `Failed to copy URL to clipboard: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }

    return this.addItem ?? undefined;
  }

  /**
   * Emit a UI message via the instance addItem or the global buffer.
   */
  private emitUIMessage(
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp?: number,
  ): void {
    if (this.addItem) {
      this.addItem(itemData, baseTimestamp);
    } else {
      const delivered = globalOAuthUI.callAddItem(itemData, baseTimestamp);
      if (delivered === undefined) {
        debugLogger.log(
          'text' in itemData ? (itemData.text as string) : 'OAuth event',
        );
      }
    }
  }

  /**
   * Optionally open the browser for Qwen auth if interactive mode is enabled.
   */
  private async openQwenBrowserIfInteractive(authUrl: string): Promise<void> {
    let noBrowser = false;
    try {
      const { getEphemeralSetting } = await import(
        '../runtime/runtimeSettings.js'
      );
      noBrowser = (getEphemeralSetting('auth.noBrowser') as boolean) ?? false;
    } catch {
      // Runtime not initialized (e.g., tests) — use default
    }

    if (!shouldLaunchBrowser({ forceManual: noBrowser })) {
      return;
    }

    this.emitUIMessage(
      { type: 'info', text: 'Opening browser for authentication...' },
      Date.now(),
    );

    try {
      await openBrowserSecurely(authUrl);
    } catch (error) {
      this.emitUIMessage(
        { type: 'warning', text: 'Failed to open browser automatically.' },
        Date.now(),
      );
      this.logger.debug(
        () =>
          `Browser launch error: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P05
   * @requirement REQ-001.1
   * @pseudocode lines 58-59
   */
  async getToken(): Promise<OAuthToken | null> {
    await this.ensureInitialized();

    return this.errorHandler.handleGracefully(
      async () =>
        // Line 59: RETURN AWAIT this.tokenStore.getToken('qwen')
        // Read-only - OAuthManager owns all refresh operations
        (await this.tokenStore?.getToken('qwen')) || null,
      null, // Return null on error
      this.name,
      'getToken',
    );
  }

  async refreshToken(currentToken: OAuthToken): Promise<OAuthToken | null> {
    await this.ensureInitialized();

    if (!currentToken.refresh_token) {
      return null;
    }

    try {
      // Skip actual refresh in test environment to avoid network calls
      if (process.env.NODE_ENV === 'test') {
        throw new Error('Simulated refresh failure in test environment');
      }

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

  /**
   * @plan PLAN-20250823-AUTHFIXES.P05
   * @requirement REQ-001.1
   * @pseudocode lines 87-89
   */
  async logout(token?: OAuthToken): Promise<void> {
    await this.ensureInitialized();

    return this.errorHandler.handleGracefully(
      async () => {
        // Line 88: AWAIT this.tokenStore.removeToken('qwen')
        if (this.tokenStore && !token) {
          try {
            await this.tokenStore.removeToken('qwen');
          } catch (error) {
            throw OAuthErrorFactory.storageError(
              this.name,
              error instanceof Error ? error : undefined,
              {
                operation: 'removeToken',
              },
            );
          }
        }

        // Line 89: PRINT "Successfully logged out from Qwen"
        if (!token) {
          if (this.addItem) {
            this.addItem(
              { type: 'info', text: 'Successfully logged out from Qwen' },
              Date.now(),
            );
          } else {
            const delivered = globalOAuthUI.callAddItem(
              { type: 'info', text: 'Successfully logged out from Qwen' },
              Date.now(),
            );
            if (delivered === undefined) {
              debugLogger.log('Successfully logged out from Qwen');
            }
          }
        }
      },
      undefined, // Always complete logout even if some steps fail
      this.name,
      'logout',
    );
  }
}
