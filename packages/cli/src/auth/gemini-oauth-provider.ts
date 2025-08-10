/**
 * Gemini OAuth Provider Implementation
 *
 * Note: This is a placeholder that signals to use the existing Gemini OAuth flow.
 * The actual OAuth is handled by the GeminiProvider itself using LOGIN_WITH_GOOGLE.
 */

import { OAuthProvider } from './oauth-manager.js';
import { OAuthToken } from '@vybestack/llxprt-code-core';

export class GeminiOAuthProvider implements OAuthProvider {
  name = 'gemini';
  private currentToken: OAuthToken | null = null;

  async initiateAuth(): Promise<void> {
    // Signal that the existing LOGIN_WITH_GOOGLE flow should be used
    // The GeminiProvider will handle this through its own OAuth mechanism
    throw new Error('USE_EXISTING_GEMINI_OAUTH');
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
      // TODO: Implement Gemini token refresh
      console.log('Gemini token refresh needed');
    }

    return this.currentToken;
  }
}
