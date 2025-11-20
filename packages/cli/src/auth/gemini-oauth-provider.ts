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

import { OAuthProvider } from './oauth-manager.js';
import { OAuthToken, TokenStore } from './types.js';
import {
  OAuthError,
  OAuthErrorFactory,
  GracefulErrorHandler,
  RetryHandler,
} from '@vybestack/llxprt-code-core';
import { HistoryItemWithoutId } from '../ui/types.js';
import { globalOAuthUI } from './global-oauth-ui.js';

enum InitializationState {
  NotStarted = 'not-started',
  InProgress = 'in-progress',
  Completed = 'completed',
  Failed = 'failed',
}

export class GeminiOAuthProvider implements OAuthProvider {
  name = 'gemini';
  private currentToken: OAuthToken | null = null;
  private tokenStore?: TokenStore;
  private initializationState = InitializationState.NotStarted;
  private initializationPromise?: Promise<void>;
  private initializationError?: Error;
  private errorHandler: GracefulErrorHandler;
  private retryHandler: RetryHandler;
  private addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number;
  private authCodeResolver?: (code: string) => void;
  private authCodeRejecter?: (error: Error) => void;
  private pendingAuthPromise?: Promise<string>;

  constructor(
    tokenStore?: TokenStore,
    addItem?: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp: number,
    ) => number,
  ) {
    this.tokenStore = tokenStore;
    this.retryHandler = new RetryHandler();
    this.errorHandler = new GracefulErrorHandler(this.retryHandler);
    this.addItem = addItem;

    if (!tokenStore) {
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
        new Error('OAuth authentication was cancelled by user'),
        'user cancellation',
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

  async initializeToken(): Promise<void> {
    if (!this.tokenStore) {
      return;
    }

    return this.errorHandler.handleGracefully(
      async () => {
        // Try to load from token store
        const savedToken = await this.tokenStore!.getToken('gemini');

        if (savedToken) {
          this.currentToken = savedToken;
        }
      },
      undefined, // No fallback needed - graceful failure is acceptable
      this.name,
      'initializeToken',
    );
  }


  /**
   * Fallback auth flow when browser cannot be opened
   * Displays URL and waits for user to paste authorization code
   */
  private async fallbackAuthFlow(): Promise<void> {
    await this.errorHandler.wrapMethod(
      async () => {
        const { OAuth2Client, CodeChallengeMethod } = await import('google-auth-library');
        const crypto = await import('crypto');
        
        // Generate PKCE parameters
        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        const codeChallenge = crypto
          .createHash('sha256')
          .update(codeVerifier)
          .digest('base64url');
        const state = crypto.randomBytes(32).toString('hex');

        // Create OAuth2 client with redirect URI for manual flow
        const redirectUri = 'http://localhost:8765/oauth2callback';
        const client = new OAuth2Client({
          clientId: process.env.GOOGLE_CLIENT_ID || '1087459693054-kh5t5o33ocq7ik2h62puk0q6lruqcuvj.apps.googleusercontent.com',
          clientSecret: process.env.GOOGLE_CLIENT_SECRET || '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',
          redirectUri,
        });

        // Generate authorization URL
        const authUrl = client.generateAuthUrl({
          access_type: 'offline',
          scope: [
            'https://www.googleapis.com/auth/generative-language.retriever',
            'https://www.googleapis.com/auth/userinfo.email',
          ],
          code_challenge_method: CodeChallengeMethod.S256,
          code_challenge: codeChallenge,
          state,
        });

        // Display URL to user
        const addItem = this.addItem || globalOAuthUI.getAddItem();
        if (addItem) {
          const historyItem: HistoryItemWithoutId = {
            type: 'oauth_url',
            text: `Please authorize with Gemini:\n1. Visit the URL below\n2. Complete authorization\n3. Paste the full callback URL (starting with http://localhost:8765/oauth2callback?...)`,
            url: authUrl,
          };
          addItem(historyItem, Date.now());
        }

        console.log('Visit the following URL to authorize:');
        console.log(authUrl);
        console.log('\nAfter authorizing, paste the full callback URL here.');

        // Set global flags for UI to detect
        (global as any).__oauth_provider = 'gemini';
        (global as any).__oauth_needs_code = true;

        // Wait for user to submit the callback URL
        this.pendingAuthPromise = new Promise<string>((resolve, reject) => {
          this.authCodeResolver = resolve;
          this.authCodeRejecter = reject;
          setTimeout(() => {
            const timeoutError = OAuthErrorFactory.fromUnknown(
              this.name,
              new Error('OAuth authentication timed out after 5 minutes'),
              'authentication timeout',
            );
            reject(timeoutError);
          }, 5 * 60 * 1000);
        });

        const callbackUrl = await this.pendingAuthPromise;

        // Parse the callback URL
        const urlObj = new URL(callbackUrl);
        const code = urlObj.searchParams.get('code');
        const returnedState = urlObj.searchParams.get('state');

        if (!code) {
          throw OAuthErrorFactory.fromUnknown(
            this.name,
            new Error('No authorization code in callback URL'),
            'invalid callback',
          );
        }

        if (returnedState !== state) {
          throw OAuthErrorFactory.fromUnknown(
            this.name,
            new Error('State mismatch in OAuth callback'),
            'security error',
          );
        }

        // Exchange code for tokens
        const { tokens } = await client.getToken({
          code,
          codeVerifier,
        });

        if (!tokens.access_token) {
          throw OAuthErrorFactory.fromUnknown(
            this.name,
            new Error('No access token received'),
            'token exchange failed',
          );
        }

        // Save the token
        const token: OAuthToken = {
          token_type: 'Bearer',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? undefined,
          expiry: tokens.expiry_date
            ? tokens.expiry_date
            : Date.now() + 3600 * 1000,
        };

        if (this.tokenStore) {
          await this.tokenStore.saveToken('gemini', token);
          this.currentToken = token;

          const addItem = this.addItem || globalOAuthUI.getAddItem();
          if (addItem) {
            addItem(
              {
                type: 'info',
                text: 'Successfully authenticated with Google Gemini!',
              },
              Date.now(),
            );
          }
        }
      },
      this.name,
      'fallbackAuthFlow',
    );
  }


  async initiateAuth(): Promise<void> {
    await this.ensureInitialized();

    return this.errorHandler.handleGracefully(
      async () => {
        // ALWAYS use fallback flow to show dialog box like Anthropic does
        // The core oauth2.ts getOauthClient uses readline which doesn't work in this UI
        await this.fallbackAuthFlow();
      },
      undefined,
      this.name,
      'initiateAuth',
    );
  }


  async getToken(): Promise<OAuthToken | null> {
    await this.ensureInitialized();
    return this.currentToken;
  }

  async refreshIfNeeded(): Promise<OAuthToken | null> {
    await this.ensureInitialized();
    return this.currentToken;
  }

}
