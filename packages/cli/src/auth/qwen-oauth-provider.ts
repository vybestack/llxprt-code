/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250823-AUTHFIXES.P05
 * Qwen OAuth Provider Implementation
 */

import { OAuthProvider } from './oauth-manager.js';
import {
  OAuthToken,
  QwenDeviceFlow,
  DeviceFlowConfig,
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
import { globalOAuthUI } from './global-oauth-ui.js';

enum InitializationState {
  NotStarted = 'not-started',
  InProgress = 'in-progress',
  Completed = 'completed',
  Failed = 'failed',
}

export class QwenOAuthProvider implements OAuthProvider {
  /**
   * @plan PLAN-20250823-AUTHFIXES.P05
   * @requirement REQ-001.1
   * @pseudocode line 5
   */
  name = 'qwen';
  private deviceFlow: QwenDeviceFlow;
  private initializationState = InitializationState.NotStarted;
  private initializationPromise?: Promise<void>;
  private initializationError?: Error;
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
        if (savedToken && !this.isTokenExpired(savedToken)) {
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
        // Line 33: SET deviceCodeResponse = AWAIT this.deviceFlow.initiateDeviceFlow()
        const deviceCodeResponse = await this.deviceFlow.initiateDeviceFlow();

        // Lines 34-35: SET authUrl
        const authUrl =
          deviceCodeResponse.verification_uri_complete ||
          `${deviceCodeResponse.verification_uri}?user_code=${deviceCodeResponse.user_code}`;

        // Try instance addItem first, fallback to global
        const addItem = this.addItem || globalOAuthUI.getAddItem();

        // Always show OAuth URL in the TUI first, before attempting browser (like Gemini does)
        const historyItem: HistoryItemOAuthURL = {
          type: 'oauth_url',
          text: `Please visit the following URL to authorize with Qwen:\\n${authUrl}`,
          url: authUrl,
        };
        if (addItem) {
          addItem(historyItem);
        } else {
          // Lines 37-38: PRINT
          debugLogger.log('\nQwen OAuth Authentication');
          debugLogger.log('─'.repeat(40));

          debugLogger.log('Please visit the following URL to authorize:');
          debugLogger.log(authUrl);
        }

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

        // Line 40: IF shouldLaunchBrowser()
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
        if (shouldLaunchBrowser({ forceManual: noBrowser })) {
          // Line 41: PRINT
          if (addItem) {
            addItem(
              { type: 'info', text: 'Opening browser for authentication...' },
              Date.now(),
            );
          } else {
            debugLogger.log('Opening browser for authentication...');
          }

          // Lines 42-46: TRY
          try {
            await openBrowserSecurely(authUrl);
          } catch (error) {
            // Line 45: PRINT - browser failure is not critical
            if (addItem) {
              addItem(
                {
                  type: 'warning',
                  text: 'Failed to open browser automatically.',
                },
                Date.now(),
              );
            } else {
              debugLogger.log('Failed to open browser automatically.');
            }
            this.logger.debug(
              () =>
                `Browser launch error: ${
                  error instanceof Error ? error.message : String(error)
                }`,
            );
          }
        }

        if (addItem) {
          // Line 52: PRINT
          addItem(
            { type: 'info', text: 'Waiting for authorization...' },
            Date.now(),
          );
        } else {
          debugLogger.log('─'.repeat(40));
          // Line 52: PRINT
          debugLogger.log('Waiting for authorization...\n');
        }

        // Line 54: SET token = AWAIT this.deviceFlow.pollForToken
        const token = await this.deviceFlow.pollForToken(
          deviceCodeResponse.device_code,
        );

        // Line 56: PRINT
        if (addItem) {
          addItem(
            { type: 'info', text: 'Authentication successful!' },
            Date.now(),
          );
        } else {
          debugLogger.log('Authentication successful!');
        }

        return token;
      },
      this.name,
      'initiateAuth',
    )();
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P05
   * @requirement REQ-001.1
   * @pseudocode lines 27-31
   */
  private isTokenExpired(token: OAuthToken): boolean {
    // Line 28: SET now = Date.now() / 1000
    const now = Date.now() / 1000;
    // Line 29: SET buffer = 30
    const buffer = 30;
    // Line 30: RETURN token.expiry <= (now + buffer)
    return token.expiry <= now + buffer;
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P05
   * @requirement REQ-001.1
   * @pseudocode lines 58-59
   */
  async getToken(): Promise<OAuthToken | null> {
    await this.ensureInitialized();

    return this.errorHandler.handleGracefully(
      async () => {
        // Line 59: RETURN AWAIT this.tokenStore.getToken('qwen')
        // Read-only - OAuthManager owns all refresh operations
        const token = (await this.tokenStore?.getToken('qwen')) || null;
        return token;
      },
      null, // Return null on error
      this.name,
      'getToken',
    );
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P05
   * @requirement REQ-001.1
   * @pseudocode lines 61-85
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
          const addItem = this.addItem || globalOAuthUI.getAddItem();
          if (addItem) {
            addItem(
              { type: 'info', text: 'Successfully logged out from Qwen' },
              Date.now(),
            );
          } else {
            debugLogger.log('Successfully logged out from Qwen');
          }
        }
      },
      undefined, // Always complete logout even if some steps fail
      this.name,
      'logout',
    );
  }
}
