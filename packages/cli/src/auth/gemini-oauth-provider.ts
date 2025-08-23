/**
 * Gemini OAuth Provider Implementation
 *
 * Note: This is a placeholder that signals to use the existing Gemini OAuth flow.
 * The actual OAuth is handled by the GeminiProvider itself using LOGIN_WITH_GOOGLE.
 */

import { OAuthProvider } from './oauth-manager.js';
import { OAuthToken, TokenStore } from './types.js';

export class GeminiOAuthProvider implements OAuthProvider {
  name = 'gemini';
  private currentToken: OAuthToken | null = null;
  private tokenStore?: TokenStore;

  constructor(tokenStore?: TokenStore) {
    this.tokenStore = tokenStore;
    
    if (!tokenStore) {
      console.warn(
        `DEPRECATION: ${this.name} OAuth provider created without TokenStore. ` +
        `Token persistence will not work. Please update your code.`
      );
    }
    
    // Initialize token from storage if available
    void this.initializeToken();
  }

  async initializeToken(): Promise<void> {
    if (!this.tokenStore) {
      return;
    }
    
    try {
      const savedToken = await this.tokenStore.getToken('gemini');
      if (savedToken) {
        this.currentToken = savedToken;
      }
    } catch (error) {
      // Failed to load token, that's OK
      console.debug('Failed to load Gemini token from storage:', error);
    }
  }

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
      // Token expires soon, would need refresh
      // But Gemini OAuth refresh is handled by the GeminiProvider itself
      console.debug('Gemini token expires soon, refresh would be handled by GeminiProvider');
    }

    return this.currentToken;
  }

  async logout(): Promise<void> {
    // Clear current token
    this.currentToken = null;
    
    // Remove from storage if available
    if (this.tokenStore) {
      try {
        await this.tokenStore.removeToken('gemini');
      } catch (error) {
        console.debug('Failed to remove Gemini token from storage:', error);
      }
    }
  }
}