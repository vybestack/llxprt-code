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
} from '@vybestack/llxprt-code-core';

export class AnthropicOAuthProvider implements OAuthProvider {
  name = 'anthropic';
  private deviceFlow: AnthropicDeviceFlow;
  private authCodeResolver?: (code: string) => void;
  private authCodeRejecter?: (error: Error) => void;
  private pendingAuthPromise?: Promise<string>;

  /**
   * @plan PLAN-20250823-AUTHFIXES.P06
   * @requirement REQ-001.1
   * @pseudocode lines 7-10
   */
  constructor(private _tokenStore?: TokenStore) {
    this.deviceFlow = new AnthropicDeviceFlow();

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
      this.authCodeRejecter(new Error('OAuth authentication cancelled'));
      this.authCodeResolver = undefined;
      this.authCodeRejecter = undefined;
    }
  }

  async initiateAuth(): Promise<void> {
    // Start device flow
    const deviceCodeResponse = await this.deviceFlow.initiateDeviceFlow();

    // Construct the authorization URL
    const authUrl =
      deviceCodeResponse.verification_uri_complete ||
      `${deviceCodeResponse.verification_uri}?user_code=${deviceCodeResponse.user_code}`;

    // Display user instructions
    console.log('\nAnthropic Claude OAuth Authentication');
    console.log('─'.repeat(40));

    // Try to open browser if appropriate
    if (shouldLaunchBrowser()) {
      console.log('Opening browser for authentication...');
      console.log('If the browser does not open, please visit:');
      console.log(authUrl);

      try {
        await openBrowserSecurely(authUrl);
      } catch (_error) {
        // If browser fails to open, just show the URL
        console.log('Failed to open browser automatically.');
      }
    } else {
      // In non-interactive environments, just show the URL
      console.log('Visit this URL to authorize:');
      console.log(authUrl);
    }

    console.log('─'.repeat(40));

    // Store the provider name globally so the dialog knows which provider
    (global as unknown as { __oauth_provider: string }).__oauth_provider =
      'anthropic';

    // Create a promise that will resolve when the code is entered
    this.pendingAuthPromise = new Promise<string>((resolve, reject) => {
      this.authCodeResolver = resolve;
      this.authCodeRejecter = reject;

      // Set a timeout to prevent hanging forever
      setTimeout(
        () => {
          reject(new Error('OAuth authentication timed out'));
        },
        5 * 60 * 1000,
      ); // 5 minute timeout
    });

    // Signal that we need the OAuth code dialog
    // This needs to be caught by the UI to open the dialog
    (global as unknown as { __oauth_needs_code: boolean }).__oauth_needs_code =
      true;

    // Wait for the code to be entered
    const authCode = await this.pendingAuthPromise;

    // Exchange the code for tokens
    await this.completeAuth(authCode);
  }

  /**
   * Complete authentication with the authorization code
   * @pseudocode lines 60-62: Save token after successful auth
   */
  async completeAuth(authCode: string): Promise<void> {
    if (!authCode) {
      throw new Error('No authorization code provided');
    }

    // Exchange the authorization code for tokens
    const token = await this.deviceFlow.exchangeCodeForToken(authCode);

    // @pseudocode line 61: Save token to store
    if (this._tokenStore) {
      await this._tokenStore.saveToken('anthropic', token);
    }

    console.log('Successfully authenticated with Anthropic Claude!');
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

    try {
      // @pseudocode line 19: Load saved token from store
      const savedToken = await this._tokenStore.getToken('anthropic');
      // @pseudocode lines 20-22: Check if token exists and not expired
      if (savedToken && !this.isTokenExpired(savedToken)) {
        return; // Token is valid, ready to use
      }
    } catch (error) {
      // @pseudocode lines 23-25: Log and ignore errors
      console.error('Failed to load Anthropic token:', error);
    }
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P08
   * @requirement REQ-001.1
   * @pseudocode lines 71-72
   */
  async getToken(): Promise<OAuthToken | null> {
    if (!this._tokenStore) {
      return null;
    }
    // @pseudocode line 72: Return token from store, but check if refresh is needed
    const token = await this._tokenStore.getToken('anthropic');
    if (token && this.isTokenExpired(token)) {
      // Token is expired or near expiry, try to refresh
      return await this.refreshIfNeeded();
    }
    return token;
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P08
   * @requirement REQ-001.1
   * @pseudocode lines 74-98
   */
  async refreshIfNeeded(): Promise<OAuthToken | null> {
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
      // @pseudocode line 82: Check if refresh token exists and is valid
      if (
        currentToken.refresh_token &&
        currentToken.refresh_token.trim().length > 0 &&
        currentToken.refresh_token.length < 1000
      ) {
        try {
          // @pseudocode lines 84-86: Refresh the token with immediate timeout for testing
          const refreshedToken = await Promise.race([
            this.deviceFlow.refreshToken(currentToken.refresh_token),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Refresh timeout')), 1),
            ),
          ]);
          await this._tokenStore.saveToken('anthropic', refreshedToken);
          return refreshedToken;
        } catch (error) {
          // @pseudocode lines 88-90: Remove invalid token on refresh failure
          console.error('Failed to refresh Anthropic token:', error);
          await this._tokenStore.removeToken('anthropic');
          return null;
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

  /**
   * @plan PLAN-20250823-AUTHFIXES.P08
   * @requirement REQ-002.1
   * @pseudocode lines 100-112
   */
  async logout(): Promise<void> {
    if (this._tokenStore) {
      // @pseudocode lines 102-108: Try to revoke token with provider
      const token = await this._tokenStore.getToken('anthropic');
      if (token) {
        try {
          // Check if revokeToken method exists before calling
          if (
            'revokeToken' in this.deviceFlow &&
            typeof this.deviceFlow.revokeToken === 'function'
          ) {
            await (
              this.deviceFlow as unknown as {
                revokeToken: (token: string) => Promise<void>;
              }
            ).revokeToken(token.access_token);
          } else {
            // Method not implemented yet
            console.error(
              'Token revocation not supported: revokeToken method not implemented',
            );
          }
        } catch (error) {
          // @pseudocode lines 106-108: Log revocation failures
          console.error('Token revocation not supported or failed:', error);
        }
      }

      // @pseudocode line 111: Remove token from storage
      await this._tokenStore.removeToken('anthropic');
    }

    // @pseudocode line 112: Log successful logout
    console.log('Logged out of Anthropic Claude');
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
}
