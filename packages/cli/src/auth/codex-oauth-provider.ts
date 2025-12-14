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
import type { CodexOAuthToken, TokenStore } from '@vybestack/llxprt-code-core';
import { OAuthProvider } from './oauth-manager.js';
import { startLocalOAuthCallback } from './local-oauth-callback.js';
import type { HistoryItemWithoutId } from '../ui/types.js';
import { globalOAuthUI } from './global-oauth-ui.js';

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

    // Display URL in TUI if available
    const addItem = this.addItem || globalOAuthUI.getAddItem();
    if (addItem) {
      addItem(
        {
          type: 'info',
          text: `Please visit this URL to authenticate:\n${authUrl}`,
        },
        Date.now(),
      );
    }

    // Open browser if in interactive mode
    const interactive = shouldLaunchBrowser();
    this.logger.debug(() => `[FLOW] Interactive mode: ${interactive}`);
    if (interactive) {
      this.logger.debug(() => '[FLOW] Opening browser for authentication');
      await openBrowserSecurely(authUrl);
      this.logger.debug(() => '[FLOW] Browser opened');
    }

    // Wait for callback
    this.logger.debug(() => '[FLOW] Waiting for OAuth callback...');
    const { code, state: callbackState } = await waitForCallback();
    this.logger.debug(
      () =>
        `[FLOW] Callback received! code: ${code.substring(0, 10)}..., state: ${callbackState.substring(0, 8)}...`,
    );

    // Exchange code for tokens with state
    this.logger.debug(() => '[FLOW] Calling completeAuth()...');
    await this.completeAuth(code, redirectUri, callbackState);
    this.logger.debug(() => '[FLOW] completeAuth() finished');
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

    // Save to MultiProviderTokenStore location (~/.llxprt/oauth/codex.json)
    this.logger.debug(() => '[FLOW] Saving token to tokenStore...');
    await this.tokenStore.saveToken('codex', token);
    this.logger.debug(() => '[FLOW] Token saved to tokenStore');

    this.logger.debug(() => '[FLOW] completeAuth() completed successfully');
  }

  /**
   * Get OAuth token for Codex
   * Tries primary location first, then falls back to reading from Codex CLI's auth file
   * @returns CodexOAuthToken if available, null otherwise
   */
  async getToken(): Promise<CodexOAuthToken | null> {
    this.logger.debug(() => '[FLOW] getToken() called');
    await this.ensureInitialized();

    // Get token from ~/.llxprt/oauth/codex.json
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

  /**
   * Logout from Codex
   * Only removes from llxprt storage - never touches ~/.codex/
   */
  async logout(): Promise<void> {
    this.logger.debug(() => 'Logging out from Codex');
    await this.tokenStore.removeToken('codex');
  }
}
