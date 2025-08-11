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

  constructor() {
    this.deviceFlow = new AnthropicDeviceFlow();
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
    console.log('Waiting for authorization...\n');

    // Poll for token
    this.currentToken = await this.deviceFlow.pollForToken(
      deviceCodeResponse.device_code,
    );

    console.log('✅ Successfully authenticated with Anthropic Claude!');
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