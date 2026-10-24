import type { OAuthFetch } from '@vybestack/llxprt-code-auth/types.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Anthropic OAuth Provider Implementation
 */

import type { OAuthProvider } from './types.js';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-auth';
import {
  type OAuthUICallback,
  type OAuthUIEvent,
} from '@vybestack/llxprt-code-auth';
import { AnthropicDeviceFlow } from '@vybestack/llxprt-code-auth';
import {
  OAuthError,
  OAuthErrorFactory,
  OAuthErrorType,
  GracefulErrorHandler,
  RetryHandler,
} from '@vybestack/llxprt-code-auth/oauth-errors.js';
import { oauthUIBridge } from '@vybestack/llxprt-code-auth/oauth-ui-bridge.js';
import {
  openBrowserSecurely,
  shouldLaunchBrowser,
  type BrowserLaunchOptions,
} from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';
import { ClipboardService } from './ClipboardService.js';
import type { LocalOAuthCallbackServer } from './local-oauth-callback.js';
import { startLocalOAuthCallback } from './local-oauth-callback.js';
import {
  InitializationGuard,
  AuthCodeDialog,
  hasValidRefreshToken,
  isTokenExpired,
} from './oauth-provider-base.js';
import type { BrowserProfileAssociation } from './browser-profile-association-store.js';

const CALLBACK_PORT_RANGE: [number, number] = [8765, 8795];
const CALLBACK_TIMEOUT_MS = 3 * 60 * 1000;

class AuthAttemptCancelledError extends OAuthError {
  constructor() {
    super(
      OAuthErrorType.USER_CANCELLED,
      'claudecode',
      'Auth attempt cancelled',
      {
        userMessage: 'Claude Code authentication was cancelled.',
        actionRequired:
          'Complete the Claude Code authentication process to continue.',
      },
    );
    this.name = 'AuthAttemptCancelledError';
  }
}

/**
 * Runtime fail-fast: JavaScript callers can bypass the required-parameter
 * type contract, so the constructor re-checks the store before any work.
 */
function assertTokenStore(
  store: TokenStore | undefined | null,
): asserts store is TokenStore {
  if (store === undefined || store === null) {
    throw new Error(
      `AnthropicOAuthProvider (claudecode) requires a TokenStore for token ` +
        `persistence. Please provide a valid TokenStore instance.`,
    );
  }
}

export class AnthropicOAuthProvider implements OAuthProvider {
  name = 'claudecode';
  private deviceFlow: AnthropicDeviceFlow;
  private pendingAuthPromise?: Promise<string>;
  private initGuard: InitializationGuard;
  private dialog: AuthCodeDialog;
  private errorHandler: GracefulErrorHandler;
  private retryHandler: RetryHandler;
  private logger: DebugLogger;
  private tokenStore: TokenStore;
  private currentAuthAttemptId?: string;
  private addItem?: OAuthUICallback;
  private currentAuthBucket?: string;
  private dialogAttemptId?: string;

  /**
   * @plan PLAN-20250823-AUTHFIXES.P06
   * @requirement REQ-001.1
   * @pseudocode lines 7-10
   *
   * Constructor completes synchronously - no async calls
   */
  constructor(
    requestFetch: OAuthFetch,
    tokenStore: TokenStore,
    addItem?: OAuthUICallback,
    private readonly isBrowserDisabled: () => boolean = () => false,
    private readonly getBrowserProfileAssociation: (
      provider: string,
      bucket?: string,
    ) => BrowserProfileAssociation | undefined = () => undefined,
  ) {
    assertTokenStore(tokenStore);
    this.deviceFlow = new AnthropicDeviceFlow(requestFetch);
    this.retryHandler = new RetryHandler();
    this.errorHandler = new GracefulErrorHandler(this.retryHandler);
    this.logger = new DebugLogger('llxprt:auth:claudecode');
    this.tokenStore = tokenStore;
    this.addItem = addItem;
    this.initGuard = new InitializationGuard('wrap', this.name);
    this.dialog = new AuthCodeDialog();

    // DO NOT call initializeToken() - lazy initialization pattern
  }

  /**
   * Set the addItem callback for displaying messages in the UI
   */
  setAddItem(addItem: OAuthUICallback): void {
    this.addItem = addItem;
  }

  /**
   * Set the authentication context so the provider knows which bucket
   * it is authenticating for. Used to look up browser profile associations.
   */
  setAuthContext(ctx: { bucket?: string; attemptId?: string }): void {
    this.currentAuthBucket = ctx.bucket;
    this.dialogAttemptId = ctx.attemptId;
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

  async initiateAuth(signal?: AbortSignal): Promise<OAuthToken> {
    signal?.throwIfAborted();
    try {
      return await this.errorHandler.wrapMethod(
        async () => this.runAuthAttempt(signal),
        this.name,
        'initiateAuth',
      )();
    } catch (error) {
      // The wrapper classifies every failure as an OAuth error; the caller
      // that aborted must see its own reason.
      if (signal?.aborted === true) throw signal.reason;
      throw error;
    }
  }

  private async runAuthAttempt(
    signal: AbortSignal | undefined,
  ): Promise<OAuthToken> {
    if (signal?.aborted === true) throw new AuthAttemptCancelledError();
    // Cancel any previous auth attempt's pending dialog
    const attemptId = crypto.randomUUID();
    if (this.currentAuthAttemptId) {
      this.cancelAuth();
    }
    this.currentAuthAttemptId = attemptId;
    const onAbort = (): void => {
      if (this.currentAuthAttemptId === attemptId) {
        this.dialog.rejectWithError(new AuthAttemptCancelledError());
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await this.ensureInitialized();
      const { localCallback } = await this.setupDeviceFlowAndDisplay(
        attemptId,
        signal,
      );

      if (localCallback) {
        return await this.raceCallbackVsManualEntry(attemptId, localCallback);
      }

      const authCode = await this.pendingAuthPromise!;
      if (this.currentAuthAttemptId !== attemptId) {
        throw new AuthAttemptCancelledError();
      }
      return await this.completeAuth(authCode);
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (this.currentAuthAttemptId === attemptId) {
        this.dialog.cancelAuth(this.name);
        this.pendingAuthPromise = undefined;
        this.currentAuthAttemptId = undefined;
      }
    }
  }

  /**
   * Start the device flow, optionally start a local callback server,
   * display the auth URL to the user, copy to clipboard, and open browser.
   * Returns the URLs and callback handle needed by the calling flow.
   */
  private async setupDeviceFlowAndDisplay(
    attemptId: string,
    signal: AbortSignal | undefined,
  ): Promise<{
    localCallback: LocalOAuthCallbackServer | null;
  }> {
    const deviceCodeResponse = await this.deviceFlow.initiateDeviceFlow();
    const noBrowser = this.isBrowserDisabled();
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
      deviceCodeResponse.verification_uri_complete ??
      `${deviceCodeResponse.verification_uri}?user_code=${deviceCodeResponse.user_code}`;
    const callbackUrl = localCallback
      ? this.deviceFlow.buildAuthorizationUrl(localCallback.redirectUri)
      : null;

    if (this.currentAuthAttemptId !== attemptId || signal?.aborted === true) {
      await localCallback?.shutdown();
      throw new AuthAttemptCancelledError();
    }
    this.armPendingAuthDialog();

    const historyItem: OAuthUIEvent = {
      type: 'oauth_url',
      text: `Please visit the following URL to authorize with Claude Code:\n${deviceCodeUrl}`,
      url: deviceCodeUrl,
    };
    if (this.addItem) {
      this.addItem(historyItem);
    } else {
      oauthUIBridge.emit(historyItem);
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
      void this.openAuthBrowser(callbackUrl ?? deviceCodeUrl, attemptId);
    }

    return { localCallback };
  }

  /**
   * Open the OAuth URL in the browser, using the bucket's associated browser
   * profile when one is configured. Falls back to the default browser when no
   * association exists or the lookup fails.
   */
  private async openAuthBrowser(
    browserUrl: string,
    attemptId: string,
  ): Promise<void> {
    let browserOpts: BrowserLaunchOptions | undefined;
    try {
      const assoc = this.getBrowserProfileAssociation(
        this.name,
        this.currentAuthBucket,
      );
      if (assoc) {
        browserOpts = {
          browser: assoc.browser,
          profileDirectory: assoc.profileDirectory,
        };
      }
    } catch (error) {
      this.logger.debug(
        () =>
          `Browser profile association lookup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
    try {
      await openBrowserSecurely(browserUrl, browserOpts);
    } catch (error) {
      this.logger.debug(() => `Browser launch error: ${error}`);
      if (this.currentAuthAttemptId !== attemptId) return;
      const warning: OAuthUIEvent = {
        type: 'warning',
        text: `Could not open a browser for Claude Code authentication. Open the authorization URL above manually and paste the code here.`,
      };
      if (this.addItem) {
        this.addItem(warning);
      } else {
        oauthUIBridge.emit(warning);
      }
    }
  }

  /**
   * Set up the manual code entry dialog with a 5-minute timeout.
   * Assigns this.pendingAuthPromise and this.dialog, and marks global auth state.
   */
  private armPendingAuthDialog(): void {
    if (this.dialogAttemptId) {
      oauthUIBridge.beginDialog(this.dialogAttemptId, this.name);
    }
    (global as unknown as { __oauth_provider: string }).__oauth_provider =
      'claudecode';

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

    void this.pendingAuthPromise.catch(() => undefined);
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
    const manualEntryPromise = this.pendingAuthPromise!;
    const dialog = this.dialog;
    const callbackPromise = localCallback
      .waitForCallback()
      .then(({ code, state }) => ({
        authCode: `${code}#${state}`,
        redirectUri: localCallback.redirectUri,
      }));
    const manualCodePromise = manualEntryPromise.then((authCode) => ({
      authCode,
      redirectUri: undefined,
    }));

    let committedToComplete = false;
    try {
      const { authCode, redirectUri } = await Promise.race([
        callbackPromise,
        manualCodePromise,
      ]);

      manualEntryPromise.catch(() => {});
      callbackPromise.catch(() => {});

      await localCallback.shutdown().catch(() => undefined);
      if (this.currentAuthAttemptId === attemptId) {
        committedToComplete = true;
        dialog.cancelAuth(this.name);
        return await this.completeAuth(authCode, redirectUri);
      }

      throw new AuthAttemptCancelledError();
    } catch (error) {
      callbackPromise.catch(() => {});
      manualEntryPromise.catch(() => {});

      await localCallback.shutdown().catch(() => undefined);
      if (error instanceof AuthAttemptCancelledError || committedToComplete) {
        throw error;
      }
      this.logger.debug(
        () =>
          `Local OAuth callback failed, falling back to manual entry: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );

      if (dialog.hasPendingPromise()) {
        const authCode = await manualEntryPromise;
        if (this.currentAuthAttemptId === attemptId) {
          return this.completeAuth(authCode);
        }
        throw new AuthAttemptCancelledError();
      }
      throw error;
    }
  }

  /**
   * Complete authentication with the authorization code
   * Returns the token for OAuthManager to persist with correct bucket
   */
  async completeAuth(
    authCode: string,
    redirectUri?: string,
  ): Promise<OAuthToken> {
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
        const token = await this.deviceFlow.exchangeCodeForToken(
          authCode,
          redirectUri,
        );

        // Clear the dialog flag on successful auth
        (
          global as unknown as { __oauth_needs_code: boolean }
        ).__oauth_needs_code = false;

        this.logger.debug(() => 'Successfully authenticated with Claude Code!');

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
    await this.errorHandler.handleGracefully(
      async () => {
        // @pseudocode line 19: Load saved token from store
        const savedToken = await this.tokenStore.getToken('claudecode');
        // @pseudocode lines 20-22: Check if token exists and not expired
        if (savedToken && !isTokenExpired(savedToken)) {
          return undefined; // Token is valid, ready to use
        }
        return undefined;
      },
      undefined, // No fallback needed - graceful failure is acceptable
      this.name,
      'initializeToken',
    );
    return;
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P08
   * @requirement REQ-001.1
   * @pseudocode lines 71-72
   */
  async getToken(): Promise<OAuthToken | null> {
    await this.ensureInitialized();

    return this.errorHandler.handleGracefully(
      // Issue #1378: Return token as-is; OAuthManager owns all refresh operations
      async () => this.tokenStore.getToken('claudecode'),
      null, // Return null on error
      this.name,
      'getToken',
    );
  }

  async refreshToken(
    currentToken: OAuthToken,
    signal?: AbortSignal,
  ): Promise<OAuthToken | null> {
    await this.ensureInitialized();
    signal?.throwIfAborted();

    if (hasValidRefreshToken(currentToken)) {
      try {
        const refreshedToken = await this.deviceFlow.refreshToken(
          currentToken.refresh_token,
          signal,
        );

        return {
          ...currentToken,
          ...refreshedToken,
          refresh_token:
            refreshedToken.refresh_token ?? currentToken.refresh_token,
        };
      } catch (error) {
        signal?.throwIfAborted();
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
    this.logger.debug(() => 'Logged out of Claude Code');
  }
}
