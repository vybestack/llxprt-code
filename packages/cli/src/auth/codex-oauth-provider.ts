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
import { z } from 'zod';

/**
 * Port configuration for Codex OAuth callback
 * Use 1455 for compatibility with Codex CLI, fallback to range if busy
 */
const CODEX_PRIMARY_PORT = 1455;
const CODEX_FALLBACK_RANGE: readonly [number, number] = [1456, 1485];
const CALLBACK_TIMEOUT_MS = 120000; // 2 minutes

/**
 * Codex CLI token schema for fallback reading from ~/.codex/auth.json
 */
const CodexCliTokenSchema = z.object({
  tokens: z.object({
    access_token: z.string(),
    account_id: z.string(),
    refresh_token: z.string().optional(),
    id_token: z.string().optional(),
  }),
});

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
   * Initiate Codex OAuth authentication flow
   * Starts local callback server and opens browser for authentication
   */
  async initiateAuth(): Promise<void> {
    this.logger.debug(() => 'Initiating Codex OAuth flow');

    const state = crypto.randomUUID();

    // Try primary port first (Codex CLI compatible), fallback to range
    const localCallback = await startLocalOAuthCallback({
      state,
      portRange: [CODEX_PRIMARY_PORT, CODEX_FALLBACK_RANGE[1]],
      timeoutMs: CALLBACK_TIMEOUT_MS,
    });

    const port = parseInt(
      localCallback.redirectUri.match(/:(\d+)\//)?.[1] || '0',
      10,
    );
    const waitForCallback = localCallback.waitForCallback;

    if (port === CODEX_PRIMARY_PORT) {
      this.logger.debug(
        () => `Started callback server on primary port ${CODEX_PRIMARY_PORT}`,
      );
    } else {
      this.logger.debug(() => `Primary port busy, using fallback port ${port}`);
    }

    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const authUrl = this.deviceFlow.buildAuthorizationUrl(redirectUri, state);

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
    if (interactive) {
      this.logger.debug(() => 'Opening browser for authentication');
      await openBrowserSecurely(authUrl);
    }

    // Wait for callback
    this.logger.debug(() => 'Waiting for OAuth callback');
    const { code } = await waitForCallback();

    // Exchange code for tokens
    await this.completeAuth(code, redirectUri);
  }

  /**
   * Complete authentication by exchanging authorization code for tokens
   * @param authCode Authorization code from OAuth callback
   * @param redirectUri Callback URL used in the flow
   */
  async completeAuth(authCode: string, redirectUri: string): Promise<void> {
    this.logger.debug(() => 'Exchanging auth code for tokens');

    const token = await this.deviceFlow.exchangeCodeForToken(
      authCode,
      redirectUri,
    );

    // Save to MultiProviderTokenStore location (~/.llxprt/oauth/codex.json)
    await this.tokenStore.saveToken('codex', token);

    this.logger.debug(() => 'Codex OAuth authentication complete');
  }

  /**
   * Get OAuth token for Codex
   * Tries primary location first, then falls back to reading from Codex CLI's auth file
   * @returns CodexOAuthToken if available, null otherwise
   */
  async getToken(): Promise<CodexOAuthToken | null> {
    // Try primary location first (~/.llxprt/oauth/codex.json)
    let token = await this.tokenStore.getToken('codex');

    if (!token) {
      // Fallback: Try reading from Codex CLI's auth file (read-only)
      token = await this.readCodexCliToken();
    }

    if (!token) {
      return null;
    }

    // Validate with Zod schema
    try {
      return CodexOAuthTokenSchema.parse(token);
    } catch (_error) {
      this.logger.debug(() => 'Token validation failed');
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
    // Only remove from llxprt storage - never touch ~/.codex/
    await this.tokenStore.removeToken('codex');
  }

  /**
   * Read-only fallback from ~/.codex/auth.json
   * This allows compatibility with Codex CLI's token storage
   * @returns CodexOAuthToken if found and valid, null otherwise
   */
  private async readCodexCliToken(): Promise<CodexOAuthToken | null> {
    const codexAuthPath = `${process.env.HOME}/.codex/auth.json`;
    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(codexAuthPath, 'utf-8');
      const data: unknown = JSON.parse(content);

      // Validate and parse Codex CLI token format
      const parsed = CodexCliTokenSchema.parse(data);

      // Convert to our format - use Unix timestamp in SECONDS
      return CodexOAuthTokenSchema.parse({
        access_token: parsed.tokens.access_token,
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600, // Unknown expiry, assume 1 hour
        account_id: parsed.tokens.account_id,
        refresh_token: parsed.tokens.refresh_token,
        id_token: parsed.tokens.id_token,
      });
    } catch (_error) {
      this.logger.debug(() => 'No valid token found in ~/.codex/auth.json');
      return null;
    }
  }
}
