/**
 * Anthropic OAuth Provider Implementation
 */

import { OAuthProvider } from './oauth-manager.js';
import {
  OAuthToken,
  AnthropicDeviceFlow,
  openBrowserSecurely,
  shouldLaunchBrowser,
} from '@vybestack/llxprt-code-core';

export class AnthropicOAuthProvider implements OAuthProvider {
  name = 'anthropic';
  private deviceFlow: AnthropicDeviceFlow;
  private currentToken: OAuthToken | null = null;
  private authCodeResolver?: (code: string) => void;
  private authCodeRejecter?: (error: Error) => void;

  constructor() {
    this.deviceFlow = new AnthropicDeviceFlow();
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

    // Signal that we need the OAuth code dialog
    // This is handled by the UI hook
    throw new Error('OAUTH_CODE_NEEDED');
  }

  /**
   * Complete authentication with the authorization code
   */
  async completeAuth(authCode: string): Promise<void> {
    if (!authCode) {
      throw new Error('No authorization code provided');
    }

    // Exchange the authorization code for tokens
    this.currentToken = await this.deviceFlow.exchangeCodeForToken(authCode);

    console.log('Successfully authenticated with Anthropic Claude!');
  }

  async getToken(): Promise<OAuthToken | null> {
    return this.currentToken;
  }

  async refreshIfNeeded(): Promise<OAuthToken | null> {
    if (!this.currentToken) {
      return null;
    }

    // Check if token needs refresh (30 second buffer)
    const now = Date.now() / 1000;
    const expiresAt = this.currentToken.expiry;

    if (expiresAt && expiresAt - now < 30) {
      // Token expires soon, refresh it
      if (this.currentToken.refresh_token) {
        try {
          this.currentToken = await this.deviceFlow.refreshToken(
            this.currentToken.refresh_token,
          );
        } catch (error) {
          console.error('Failed to refresh Anthropic token:', error);
          return null;
        }
      }
    }

    return this.currentToken;
  }
}
