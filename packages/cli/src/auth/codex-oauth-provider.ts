/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DebugLogger,
  CodexDeviceFlow,
  CodexOAuthTokenSchema,
  openBrowserSecurely,
  shouldLaunchBrowser,
} from '@vybestack/llxprt-code-core';
import type {
  CodexOAuthToken,
  OAuthToken,
  TokenStore,
} from '@vybestack/llxprt-code-core';
import { OAuthProvider } from './oauth-manager.js';
import { startLocalOAuthCallback } from './local-oauth-callback.js';
import type { HistoryItemWithoutId, HistoryItemOAuthURL } from '../ui/types.js';
import { globalOAuthUI } from './global-oauth-ui.js';
import { ClipboardService } from '../services/ClipboardService.js';

enum InitializationState {
  NotStarted = 'not-started',
  InProgress = 'in-progress',
  Completed = 'completed',
  Failed = 'failed',
}

/**
 * Port configuration for Codex OAuth callback
 * Use 1455 for compatibility with Codex CLI, fallback to range if busy
 */
const CODEX_PRIMARY_PORT = 1455;
const CODEX_FALLBACK_RANGE: readonly [number, number] = [1456, 1485];
const CALLBACK_TIMEOUT_MS = 120000; // 2 minutes
/**
 * Codex OAuth Provider Implementation
 * Implements OAuth 2.0 PKCE flow for Codex authentication
 */
export class CodexOAuthProvider implements OAuthProvider {
  name = 'codex' as const;

  private deviceFlow: CodexDeviceFlow;
  private logger: DebugLogger;
  private tokenStore: TokenStore;
  private addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number;
  private initializationState = InitializationState.NotStarted;
  private initializationPromise?: Promise<void>;
  private authInProgress: Promise<void> | null = null;

  constructor(
    tokenStore: TokenStore,
    addItem?: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp: number,
    ) => number,
  ) {
    this.deviceFlow = new CodexDeviceFlow();
    this.logger = new DebugLogger('llxprt:auth:codex');
    this.tokenStore = tokenStore;
    this.addItem = addItem;
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
   * Lazy initialization pattern
   * Ensures initialization only happens once and handles concurrent calls
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initializationState === InitializationState.Completed) {
      return;
    }

    if (this.initializationState === InitializationState.Failed) {
      this.initializationState = InitializationState.NotStarted;
      this.initializationPromise = undefined;
    }

    if (this.initializationState === InitializationState.NotStarted) {
      this.initializationState = InitializationState.InProgress;
      this.initializationPromise = this.initializeToken();
    }

    if (this.initializationPromise) {
      try {
        await this.initializationPromise;
        this.initializationState = InitializationState.Completed;
      } catch (error) {
        this.initializationState = InitializationState.Failed;
        throw error;
      }
    }
  }

  /**
   * Initialize token from storage if available
   */
  private async initializeToken(): Promise<void> {
    try {
      const savedToken = await this.tokenStore.getToken('codex');
      if (savedToken) {
        this.logger.debug(() => 'Loaded existing Codex token from storage');
      }
    } catch (error) {
      this.logger.debug(() => `Token initialization failed: ${error}`);
    }
  }

  /**
   * Initiate Codex OAuth authentication flow
   * Starts local callback server and opens browser for authentication
   */
  async initiateAuth(): Promise<void> {
    this.logger.debug(
      () =>
        `[FLOW] initiateAuth() called, authInProgress=${!!this.authInProgress}`,
    );
    if (this.authInProgress) {
      this.logger.debug(() => '[FLOW] OAuth already in progress, waiting...');
      await this.authInProgress;
      this.logger.debug(() => '[FLOW] Finished waiting for existing auth flow');
      return;
    }

    this.logger.debug(() => '[FLOW] Starting new auth flow via performAuth()');
    this.authInProgress = this.performAuth();
    try {
      await this.authInProgress;
      this.logger.debug(() => '[FLOW] performAuth() completed successfully');
    } catch (error) {
      this.logger.debug(
        () =>
          `[FLOW] performAuth() failed: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    } finally {
      this.authInProgress = null;
      this.logger.debug(() => '[FLOW] authInProgress reset to null');
    }
  }

  /**
   * Perform the actual OAuth authentication flow
   */
  private async performAuth(): Promise<void> {
    this.logger.debug(() => '[FLOW] performAuth() starting');

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
    this.logger.debug(() => `[FLOW] Interactive mode: ${interactive}`);

    // Check if we should use device flow (browserless mode)
    if (!interactive) {
      this.logger.debug(
        () => '[FLOW] Using device flow for browserless authentication',
      );
      await this.performDeviceAuth();
      return;
    }

    const state = crypto.randomUUID();
    this.logger.debug(
      () => `[FLOW] Generated state: ${state.substring(0, 8)}...`,
    );

    // Try primary port first (Codex CLI compatible), fallback to range
    this.logger.debug(() => '[FLOW] Starting local callback server...');
    const localCallback = await startLocalOAuthCallback({
      state,
      portRange: [CODEX_PRIMARY_PORT, CODEX_FALLBACK_RANGE[1]],
      timeoutMs: CALLBACK_TIMEOUT_MS,
      provider: 'codex',
    });

    const port = parseInt(
      localCallback.redirectUri.match(/:(\d+)\//)?.[1] || '0',
      10,
    );
    const waitForCallback = localCallback.waitForCallback;

    this.logger.debug(
      () =>
        `[FLOW] Callback server started on port ${port}, redirectUri: ${localCallback.redirectUri}`,
    );

    // Use the server's redirectUri - it already includes the correct path
    const redirectUri = localCallback.redirectUri;
    const authUrl = this.deviceFlow.buildAuthorizationUrl(redirectUri, state);
    this.logger.debug(
      () => `[FLOW] Built auth URL: ${authUrl.substring(0, 80)}...`,
    );

    // Display URL in TUI (clickable) if available
    console.log('\nCodex OAuth Authentication');
    console.log('─'.repeat(40));

    const historyItem: HistoryItemOAuthURL = {
      type: 'oauth_url',
      text: `Please visit the following URL to authenticate with Codex:\n${authUrl}`,
      url: authUrl,
    };
    const addItem = this.addItem || globalOAuthUI.getAddItem();
    if (addItem) {
      addItem(historyItem, Date.now());
    }

    // Also show plain URL for copying (pastable)
    console.log('Please visit the following URL to authenticate:');
    console.log(authUrl);

    // Copy URL to clipboard with error handling
    try {
      await ClipboardService.copyToClipboard(authUrl);
    } catch (error) {
      // Clipboard copy is non-critical, continue without it
      this.logger.debug(() => `Failed to copy URL to clipboard: ${error}`);
    }

    // Open browser (we already know we're in interactive mode from the check at the start)
    this.logger.debug(() => '[FLOW] Opening browser for authentication');
    await openBrowserSecurely(authUrl);
    this.logger.debug(() => '[FLOW] Browser opened');

    // Wait for callback — fall back to device auth if it fails
    this.logger.debug(() => '[FLOW] Waiting for OAuth callback...');
    try {
      const { code, state: callbackState } = await waitForCallback();
      this.logger.debug(
        () =>
          `[FLOW] Callback received! code: ${code.substring(0, 10)}..., state: ${callbackState.substring(0, 8)}...`,
      );

      await localCallback.shutdown().catch(() => undefined);

      // Exchange code for tokens with state
      this.logger.debug(() => '[FLOW] Calling completeAuth()...');
      await this.completeAuth(code, redirectUri, callbackState);
      this.logger.debug(() => '[FLOW] completeAuth() finished');
    } catch (error) {
      await localCallback.shutdown().catch(() => undefined);
      this.logger.debug(
        () =>
          `[FLOW] Callback failed, falling back to device auth: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      await this.performDeviceAuth();
    }
  }

  /**
   * Complete authentication by exchanging authorization code for tokens
   * @param authCode Authorization code from OAuth callback
   * @param redirectUri Callback URL used in the flow
   * @param state State parameter from OAuth callback
   */
  async completeAuth(
    authCode: string,
    redirectUri: string,
    state: string,
  ): Promise<void> {
    this.logger.debug(
      () =>
        `[FLOW] completeAuth() called with code: ${authCode.substring(0, 10)}..., redirectUri: ${redirectUri}`,
    );

    this.logger.debug(
      () => '[FLOW] Calling deviceFlow.exchangeCodeForToken()...',
    );
    const token = await this.deviceFlow.exchangeCodeForToken(
      authCode,
      redirectUri,
      state,
    );
    this.logger.debug(
      () =>
        `[FLOW] Token received: access_token=${token.access_token.substring(0, 10)}..., account_id=${token.account_id?.substring(0, 8) ?? 'MISSING'}..., expiry=${token.expiry}`,
    );

    // Save to KeyringTokenStore (keyring or encrypted fallback)
    this.logger.debug(() => '[FLOW] Saving token to tokenStore...');
    await this.tokenStore.saveToken('codex', token);
    this.logger.debug(() => '[FLOW] Token saved to tokenStore');

    this.logger.debug(() => '[FLOW] completeAuth() completed successfully');
  }

  /**
   * Perform device authorization flow (browserless authentication)
   * For Codex, the user code is generated by OpenAI and displayed in the terminal.
   * User copies this code FROM the terminal TO the browser at auth.openai.com/codex/device
   */
  private async performDeviceAuth(): Promise<void> {
    this.logger.debug(() => '[DEVICE-FLOW] Starting device authorization flow');

    try {
      // Request device code from OpenAI
      this.logger.debug(
        () => '[DEVICE-FLOW] Requesting device code from OpenAI...',
      );
      const deviceCodeResponse = await this.deviceFlow.requestDeviceCode();
      this.logger.debug(
        () => `[DEVICE-FLOW] requestDeviceCode() returned successfully`,
      );

      this.logger.debug(
        () =>
          `[DEVICE-FLOW] Received user code: ${deviceCodeResponse.user_code}`,
      );

      // Display the auth URL and user code in TUI history
      const authUrl = 'https://auth.openai.com/codex/device';
      const userCode = deviceCodeResponse.user_code;

      // First show the clickable URL
      const urlHistoryItem: HistoryItemOAuthURL = {
        type: 'oauth_url',
        text: `Please visit the following URL to authorize with Codex:\n${authUrl}`,
        url: authUrl,
      };

      // Try instance addItem first, fallback to global
      const addItem = this.addItem || globalOAuthUI.getAddItem();
      if (addItem) {
        addItem(urlHistoryItem, Date.now());

        // Show the user code prominently - this is what the user needs to copy!
        const codeMessage: HistoryItemWithoutId = {
          type: 'info',
          text: `Enter this code in your browser:\n\n    ${userCode}\n\n(Code expires in 15 minutes)`,
        };
        addItem(codeMessage, Date.now());
      } else {
        // Fallback for non-interactive mode - write to stdout
        process.stdout.write('\nCodex Device Authorization\n');
        process.stdout.write('─'.repeat(40) + '\n');
        process.stdout.write(`Visit: ${authUrl}\n`);
        process.stdout.write(`Code:  ${userCode}\n`);
        process.stdout.write('(Code expires in 15 minutes)\n\n');
      }

      // Copy the user code to clipboard (this is what users need to paste in browser)
      try {
        await ClipboardService.copyToClipboard(userCode);
        if (addItem) {
          addItem(
            { type: 'info', text: 'Code copied to clipboard!' },
            Date.now(),
          );
        } else {
          process.stdout.write('Code copied to clipboard!\n');
        }
      } catch (error) {
        this.logger.debug(() => `Failed to copy code to clipboard: ${error}`);
      }

      // Start polling for device token - waits for user to complete auth in browser
      const pollResult = await this.deviceFlow.pollForDeviceToken(
        deviceCodeResponse.device_auth_id,
        deviceCodeResponse.user_code,
        deviceCodeResponse.interval,
      );

      this.logger.debug(
        () => '[DEVICE-FLOW] Device authorization polling completed',
      );
      this.logger.debug(
        () =>
          `[DEVICE-FLOW] Got authorization_code: ${pollResult.authorization_code.substring(0, 10)}...`,
      );

      // Complete the device auth flow by exchanging authorization code for tokens
      // This redirect_uri matches what OpenAI expects for device flow token exchange
      const redirectUri =
        'https://auth.openai.com/api/accounts/deviceauth/callback';
      const token = await this.deviceFlow.completeDeviceAuth(
        pollResult.authorization_code,
        pollResult.code_verifier,
        redirectUri,
      );

      // Save the token
      await this.tokenStore.saveToken('codex', token);
      this.logger.debug(() => '[DEVICE-FLOW] Token saved successfully');

      // Show success message
      const successMessage: HistoryItemWithoutId = {
        type: 'info',
        text: 'Successfully authenticated with Codex!',
      };
      if (addItem) {
        addItem(successMessage, Date.now());
      } else {
        process.stdout.write('Successfully authenticated with Codex!\n');
      }
    } catch (error) {
      this.logger.debug(
        () =>
          `[DEVICE-FLOW] Device auth failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get OAuth token for Codex
   * Tries primary location first, then falls back to reading from Codex CLI's auth file
   * @returns CodexOAuthToken if available, null otherwise
   */
  async getToken(): Promise<CodexOAuthToken | null> {
    this.logger.debug(() => '[FLOW] getToken() called');
    await this.ensureInitialized();

    // Get token from KeyringTokenStore (keyring or encrypted fallback)
    this.logger.debug(() => '[FLOW] Reading token from tokenStore...');
    const token = await this.tokenStore.getToken('codex');

    if (!token) {
      this.logger.debug(
        () => '[FLOW] No token found in tokenStore, returning null',
      );
      return null;
    }

    const tokenWithAccountId = token as { account_id?: string };
    this.logger.debug(
      () =>
        `[FLOW] Token found in store: access_token=${String(token.access_token).substring(0, 10)}..., has_account_id=${'account_id' in token && !!tokenWithAccountId.account_id}, expiry=${token.expiry}`,
    );

    // Validate with Zod schema
    try {
      const validated = CodexOAuthTokenSchema.parse(token);
      this.logger.debug(
        () =>
          `[FLOW] Token validated successfully, account_id=${validated.account_id.substring(0, 8)}...`,
      );
      return validated;
    } catch (error) {
      this.logger.debug(
        () =>
          `[FLOW] Token validation FAILED: ${error instanceof Error ? error.message : error}`,
      );
      this.logger.debug(
        () => `[FLOW] Token keys present: ${Object.keys(token).join(', ')}`,
      );
      return null;
    }
  }

  /**
   * Refresh token if expired or about to expire
   * @returns Refreshed token or null if refresh failed
   */
  async refreshIfNeeded(): Promise<CodexOAuthToken | null> {
    const token = await this.getToken();
    if (!token) {
      return null;
    }

    // Check if expired (with 30s buffer) - expiry is Unix timestamp in SECONDS
    const now = Math.floor(Date.now() / 1000);
    const isExpired = token.expiry <= now + 30;

    if (!isExpired) {
      return token;
    }

    if (!token.refresh_token) {
      this.logger.debug(() => 'Token expired and no refresh_token available');
      return null;
    }

    this.logger.debug(() => 'Refreshing expired token');
    try {
      const newToken = await this.deviceFlow.refreshToken(token.refresh_token);
      await this.tokenStore.saveToken('codex', newToken);
      return newToken;
    } catch (_error) {
      this.logger.debug(() => `Token refresh failed`);
      return null;
    }
  }

  async refreshToken(currentToken: OAuthToken): Promise<OAuthToken | null> {
    await this.ensureInitialized();

    const refreshToken =
      typeof currentToken.refresh_token === 'string'
        ? currentToken.refresh_token
        : undefined;

    if (!refreshToken) {
      this.logger.debug(
        () => 'Token refresh requested but no refresh_token available',
      );
      return null;
    }

    this.logger.debug(() => 'Refreshing token (bucket-aware)');
    try {
      const refreshedToken = await this.deviceFlow.refreshToken(refreshToken);
      const merged: CodexOAuthToken & Record<string, unknown> = {
        ...(currentToken as CodexOAuthToken & Record<string, unknown>),
        ...(refreshedToken as CodexOAuthToken & Record<string, unknown>),
        refresh_token: refreshedToken.refresh_token ?? refreshToken,
      };

      // Preserve account_id/id_token if refresh response omits them.
      if (!merged.account_id && 'account_id' in currentToken) {
        const accountId = (currentToken as { account_id?: string }).account_id;
        if (accountId) {
          merged.account_id = accountId;
        }
      }
      if (!merged.id_token && 'id_token' in currentToken) {
        const idToken = (currentToken as { id_token?: string }).id_token;
        if (idToken) {
          merged.id_token = idToken;
        }
      }

      return merged;
    } catch (_error) {
      this.logger.debug(() => `Token refresh failed`);
      return null;
    }
  }

  /**
   * Logout from Codex
   * Only removes from llxprt storage - never touches ~/.codex/
   */
  async logout(_token?: OAuthToken): Promise<void> {
    this.logger.debug(() => 'Logging out from Codex');
    if (!_token) {
      await this.tokenStore.removeToken('codex');
    }
  }
}
