/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuthToken, AuthStatus, TokenStore } from './types.js';
import { LoadedSettings, SettingScope } from '../config/settings.js';

/**
 * Interface for OAuth provider abstraction
 * Each provider (e.g., Google, Qwen) implements this interface
 */
export interface OAuthProvider {
  /** Provider name (e.g., 'gemini', 'qwen') */
  name: string;

  /**
   * Initiate OAuth authentication flow
   * This starts the device flow or opens browser for auth
   */
  initiateAuth(): Promise<void>;

  /**
   * Get current OAuth token for this provider
   * @returns OAuth token if available, null otherwise
   */
  getToken(): Promise<OAuthToken | null>;

  /**
   * Refresh token if it's expired or about to expire
   * @returns Refreshed token or null if refresh failed
   */
  refreshIfNeeded(): Promise<OAuthToken | null>;
}

/**
 * OAuth Manager coordinates multiple OAuth providers
 * Provides unified interface for authentication across providers
 */
export class OAuthManager {
  private providers: Map<string, OAuthProvider>;
  private tokenStore: TokenStore;
  private settings?: LoadedSettings;
  // In-memory OAuth enablement state for when settings aren't available
  private inMemoryOAuthState: Map<string, boolean>;

  constructor(tokenStore: TokenStore, settings?: LoadedSettings) {
    this.providers = new Map();
    this.tokenStore = tokenStore;
    this.settings = settings;
    this.inMemoryOAuthState = new Map();
  }

  /**
   * Register an OAuth provider with the manager
   * @param provider - The OAuth provider to register
   */
  registerProvider(provider: OAuthProvider): void {
    if (!provider) {
      throw new Error('Provider cannot be null or undefined');
    }

    if (!provider.name || typeof provider.name !== 'string') {
      throw new Error('Provider must have a valid name');
    }

    // Validate provider has required methods
    if (typeof provider.initiateAuth !== 'function') {
      throw new Error('Provider must implement initiateAuth method');
    }

    if (typeof provider.getToken !== 'function') {
      throw new Error('Provider must implement getToken method');
    }

    if (typeof provider.refreshIfNeeded !== 'function') {
      throw new Error('Provider must implement refreshIfNeeded method');
    }

    this.providers.set(provider.name, provider);
  }

  /**
   * Get a registered OAuth provider
   * @param name - Provider name
   * @returns OAuth provider or undefined if not registered
   */
  getProvider(name: string): OAuthProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Authenticate with a specific provider
   * @param providerName - Name of the provider to authenticate with
   */
  async authenticate(providerName: string): Promise<void> {
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    try {
      // 1. Initiate authentication with the provider
      await provider.initiateAuth();

      // 2. Get token from provider after successful auth
      const providerToken = await provider.getToken();
      if (!providerToken) {
        throw new Error('Authentication completed but no token was returned');
      }

      // 3. Store token using tokenStore
      await this.tokenStore.saveToken(providerName, providerToken);
    } catch (error) {
      // Propagate provider authentication errors
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(
        `Authentication failed for provider ${providerName}: ${String(error)}`,
      );
    }
  }

  /**
   * Get authentication status for all registered providers
   * @returns Array of authentication status for each provider
   */
  async getAuthStatus(): Promise<AuthStatus[]> {
    const statuses: AuthStatus[] = [];

    // Get all registered providers and check their status
    for (const [providerName, _provider] of this.providers) {
      try {
        const token = await this.tokenStore.getToken(providerName);
        const oauthEnabled = this.isOAuthEnabled(providerName);

        if (token) {
          // Provider is authenticated, calculate time until expiry
          const now = Date.now();
          const expiresIn = Math.max(
            0,
            Math.floor((token.expiry - now) / 1000),
          ); // seconds

          statuses.push({
            provider: providerName,
            authenticated: true,
            authType: 'oauth',
            expiresIn,
            oauthEnabled,
          });
        } else {
          // Provider is not authenticated
          statuses.push({
            provider: providerName,
            authenticated: false,
            authType: 'none',
            oauthEnabled,
          });
        }
      } catch (_error) {
        // If we can't get token status, consider it unauthenticated
        const oauthEnabled = this.isOAuthEnabled(providerName);
        statuses.push({
          provider: providerName,
          authenticated: false,
          authType: 'none',
          oauthEnabled,
        });
      }
    }

    return statuses;
  }

  /**
   * Check if authenticated with a specific provider (required by precedence resolver)
   * @param providerName - Name of the provider
   * @returns True if authenticated, false otherwise
   */
  async isAuthenticated(providerName: string): Promise<boolean> {
    // Special handling for Gemini - check if OAuth is enabled and working
    if (providerName === 'gemini' && this.isOAuthEnabled('gemini')) {
      // For Gemini, if OAuth is enabled, we assume it's authenticated
      // since the actual auth is handled by LOGIN_WITH_GOOGLE
      return true;
    }

    const token = await this.getOAuthToken(providerName);
    return token !== null;
  }

  /**
   * Get OAuth token for a specific provider
   * Compatible with precedence resolver - returns access token string
   * @param providerName - Name of the provider
   * @returns Access token string if available, null otherwise
   */
  async getToken(providerName: string): Promise<string | null> {
    // Check if OAuth is enabled for this provider
    if (!this.isOAuthEnabled(providerName)) {
      return null;
    }

    const token = await this.getOAuthToken(providerName);

    // Special handling for different providers
    if (providerName === 'gemini') {
      if (token) {
        return token.access_token;
      }
      // Return a special token that signals to use LOGIN_WITH_GOOGLE
      return 'USE_LOGIN_WITH_GOOGLE';
    }

    // For Qwen, return the OAuth token to be used as API key
    if (providerName === 'qwen' && token) {
      return token.access_token;
    }

    if (token) {
      return token.access_token;
    }

    // For other providers, trigger OAuth flow
    try {
      await this.authenticate(providerName);
      const newToken = await this.getOAuthToken(providerName);
      // Return the access token without any prefix - OAuth Bearer tokens should be used as-is
      return newToken ? newToken.access_token : null;
    } catch (error) {
      // Re-throw the error so it's not silently swallowed
      console.error(`OAuth authentication failed for ${providerName}:`, error);
      throw error;
    }
  }

  /**
   * Get OAuth token object for a specific provider
   * @param providerName - Name of the provider
   * @returns OAuth token if available, null otherwise
   */
  async getOAuthToken(providerName: string): Promise<OAuthToken | null> {
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    try {
      // 1. Try to get token from store
      const token = await this.tokenStore.getToken(providerName);
      if (!token) {
        return null;
      }

      // 2. Check if token expires within 30 seconds (30000ms)
      const now = Date.now();
      const thirtySecondsFromNow = now + 30000;

      if (token.expiry <= thirtySecondsFromNow) {
        // 3. Token is expired or about to expire, try refresh
        try {
          const refreshedToken = await provider.refreshIfNeeded();
          if (refreshedToken) {
            // 4. Update stored token if refreshed
            await this.tokenStore.saveToken(providerName, refreshedToken);
            return refreshedToken;
          } else {
            // Refresh failed, return null
            return null;
          }
        } catch (_error) {
          // Token refresh failure: Return null, no logging
          return null;
        }
      }

      // 5. Return valid token
      return token;
    } catch (error) {
      // For unknown provider or other critical errors, throw
      if (
        error instanceof Error &&
        error.message.includes('Unknown provider')
      ) {
        throw error;
      }
      // For other errors, return null
      return null;
    }
  }

  /**
   * Get list of all registered provider names
   * @returns Array of provider names
   */
  getSupportedProviders(): string[] {
    return Array.from(this.providers.keys()).sort();
  }

  /**
   * Toggle OAuth enablement for a provider
   * @param providerName - Name of the provider
   * @returns New enablement state (true if enabled, false if disabled)
   */
  async toggleOAuthEnabled(providerName: string): Promise<boolean> {
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    const currentlyEnabled = this.isOAuthEnabled(providerName);
    const newState = !currentlyEnabled;

    if (this.settings) {
      // If we have settings, persist the state
      // Get current OAuth enabled providers or initialize empty object
      const oauthEnabledProviders =
        this.settings.merged.oauthEnabledProviders || {};
      oauthEnabledProviders[providerName] = newState;

      // Save the updated configuration
      this.settings.setValue(
        SettingScope.User,
        'oauthEnabledProviders',
        oauthEnabledProviders,
      );
    } else {
      // No settings available, store in memory only
      // This allows OAuth to work even without a settings file
      this.inMemoryOAuthState.set(providerName, newState);
    }

    return newState;
  }

  /**
   * Check if OAuth is enabled for a provider
   * @param providerName - Name of the provider
   * @returns True if OAuth is enabled, false otherwise
   */
  isOAuthEnabled(providerName: string): boolean {
    if (this.settings) {
      // Check settings first if available
      const oauthEnabledProviders =
        this.settings.merged.oauthEnabledProviders || {};
      return oauthEnabledProviders[providerName] ?? false;
    } else {
      // Fall back to in-memory state if no settings
      return this.inMemoryOAuthState.get(providerName) ?? false;
    }
  }

  /**
   * Check for higher priority authentication methods
   * @param providerName - Name of the provider to check
   * @returns String describing higher priority auth method, null if none
   */
  async getHigherPriorityAuth(providerName: string): Promise<string | null> {
    if (!this.settings) {
      return null;
    }

    const merged = this.settings.merged;

    // Check for API keys (highest priority)
    if (merged.providerApiKeys && merged.providerApiKeys[providerName]) {
      return 'API Key';
    }

    // Check for keyfiles (second highest priority)
    if (merged.providerKeyfiles && merged.providerKeyfiles[providerName]) {
      return 'Keyfile';
    }

    // Check for environment variables
    const envKeyName = `${providerName.toUpperCase()}_API_KEY`;
    if (process.env[envKeyName]) {
      return 'Environment Variable';
    }

    // For OpenAI-based providers, check if baseURL is compatible
    if (providerName === 'qwen') {
      const baseUrls = merged.providerBaseUrls || {};
      const openaiBaseUrl = baseUrls['openai'];
      if (openaiBaseUrl && !this.isQwenCompatibleUrl(openaiBaseUrl)) {
        return 'OpenAI BaseURL Mismatch';
      }
    }

    return null;
  }

  /**
   * Check if a URL is compatible with Qwen OAuth
   * @param url - The base URL to check
   * @returns True if compatible, false otherwise
   */
  private isQwenCompatibleUrl(url: string): boolean {
    if (!url) return true; // Default OpenAI endpoint is compatible

    // Qwen-compatible URLs
    const qwenDomains = ['dashscope.aliyuncs.com', 'qwen.com', 'api.qwen.com'];

    try {
      const urlObj = new URL(url);
      return qwenDomains.some((domain) => urlObj.hostname.includes(domain));
    } catch {
      return false; // Invalid URL format
    }
  }
}
