/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuthToken, AuthStatus, TokenStore } from './types.js';
import { LoadedSettings, SettingScope } from '../config/settings.js';
import {
  getSettingsService,
  flushRuntimeAuthScope,
  DebugLogger,
} from '@vybestack/llxprt-code-core';

const logger = new DebugLogger('llxprt:oauth:manager');

function isAuthOnlyEnabled(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return false;
}

function isLoggingWrapperCandidate(
  provider: unknown,
): provider is { wrappedProvider?: unknown } {
  return (
    !!provider &&
    typeof provider === 'object' &&
    Object.prototype.hasOwnProperty.call(provider, 'wrappedProvider')
  );
}

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P12
 * @requirement REQ-SP3-003
 * @pseudocode oauth-safety.md lines 1-17
 */
export function unwrapLoggingProvider<T extends OAuthProvider | undefined>(
  provider: T,
): T {
  if (!provider) {
    return provider;
  }

  const visited = new Set<unknown>();
  let current: unknown = provider;

  while (isLoggingWrapperCandidate(current)) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    const next = current.wrappedProvider;
    if (!next) {
      break;
    }
    current = next;
  }

  return current as T;
}

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
  // Session bucket overrides (in-memory only)
  private sessionBuckets: Map<string, string>;

  constructor(tokenStore: TokenStore, settings?: LoadedSettings) {
    this.providers = new Map();
    this.tokenStore = tokenStore;
    this.settings = settings;
    this.inMemoryOAuthState = new Map();
    this.sessionBuckets = new Map();
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

    // CRITICAL FIX: Remove automatic OAuth provider initialization
    // OAuth providers should only initialize when actually needed
    // The "lazy initialization pattern" should be controlled by usage, not registration
    // This fixes issue 308 where OAuth was being initialized during MCP operations
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
   * @param bucket - Optional bucket name for multi-account support
   */
  async authenticate(providerName: string, bucket?: string): Promise<void> {
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

      // 3. Store token using tokenStore with bucket parameter
      await this.tokenStore.saveToken(providerName, providerToken, bucket);

      // 4. Ensure provider marked as OAuth enabled after successful auth
      if (!this.isOAuthEnabled(providerName)) {
        this.setOAuthEnabledState(providerName, true);
      }
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
        const oauthEnabled = this.isOAuthEnabled(providerName);

        if (!oauthEnabled) {
          statuses.push({
            provider: providerName,
            authenticated: false,
            authType: 'none',
            oauthEnabled,
          });
          continue;
        }

        const token = await this.tokenStore.getToken(providerName);

        if (token) {
          // Provider is authenticated, calculate time until expiry
          const now = Date.now() / 1000; // Convert to seconds to match token.expiry
          const expiresIn = Math.max(0, Math.floor(token.expiry - now)); // seconds

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
   * @plan PLAN-20250823-AUTHFIXES.P14
   * @requirement REQ-002
   * @pseudocode lines 51-68
   * Check if authenticated with a specific provider (required by precedence resolver)
   * @param providerName - Name of the provider
   * @param bucket - Optional bucket name
   * @returns True if authenticated, false otherwise
   */
  async isAuthenticated(
    providerName: string,
    bucket?: string,
  ): Promise<boolean> {
    // Lines 52-55: VALIDATE providerName
    if (!providerName || typeof providerName !== 'string') {
      return false;
    }

    // Special handling for Gemini - if OAuth is enabled, assume authenticated
    // since the actual auth is handled by LOGIN_WITH_GOOGLE
    if (providerName === 'gemini' && this.isOAuthEnabled('gemini')) {
      return true;
    }

    // Lines 57-60: SET token = AWAIT this.tokenStore.getToken(providerName, bucket)
    const token = await this.tokenStore.getToken(providerName, bucket);
    if (!token) {
      return false;
    }

    // Lines 62-66: Check if token is expired
    const now = Date.now() / 1000;
    if (token.expiry <= now) {
      return false;
    }

    // Line 68: RETURN true
    return true;
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P14
   * @requirement REQ-002.1
   * @pseudocode lines 4-37
   * Logout from a specific provider by clearing stored tokens
   * @param providerName - Name of the provider to logout from
   * @param bucket - Optional bucket name for multi-account support
   */
  async logout(providerName: string, bucket?: string): Promise<void> {
    // Line 5-8: VALIDATE providerName
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    // Line 10-13: Get provider
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    // Lines 16-26: Call provider logout if exists
    if ('logout' in provider && typeof provider.logout === 'function') {
      try {
        await provider.logout();
      } catch (error) {
        logger.warn(`Provider logout failed:`, error);
      }
    } else {
      await this.tokenStore.removeToken(providerName, bucket);
    }

    // CRITICAL FIX: Clear all provider auth caches after logout
    // This ensures BaseProvider and specific provider caches are invalidated
    await this.clearProviderAuthCaches(providerName);

    // Special handling for Gemini - clear all Google OAuth related files
    if (providerName === 'gemini') {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const os = await import('os');
        const llxprtDir = path.join(os.homedir(), '.llxprt');

        // Clear the OAuth credentials
        const legacyCredsPath = path.join(llxprtDir, 'oauth_creds.json');
        try {
          await fs.unlink(legacyCredsPath);
          logger.debug('Cleared Gemini OAuth credentials');
        } catch {
          // File might not exist
        }

        // Clear the Google accounts file
        const googleAccountsPath = path.join(llxprtDir, 'google_accounts.json');
        try {
          await fs.unlink(googleAccountsPath);
          logger.debug('Cleared Google account info');
        } catch {
          // File might not exist
        }

        // Force the OAuth client to re-authenticate by clearing any cached state
        // The next request will need to re-authenticate
      } catch (error) {
        logger.debug('Error clearing Gemini credentials:', error);
      }
    }
  }

  /**
   * @plan PLAN-20250823-AUTHFIXES.P14
   * @requirement REQ-002
   * @pseudocode lines 39-49
   * Logout from all providers by clearing all stored tokens
   */
  async logoutAll(): Promise<void> {
    // Line 40: SET providers = AWAIT this.tokenStore.listProviders()
    const providers = await this.tokenStore.listProviders();

    // Lines 42-49: FOR EACH provider IN providers DO
    for (const provider of providers) {
      try {
        // Line 44: AWAIT this.logout(provider)
        await this.logout(provider);
      } catch (error) {
        // Lines 45-47: LOG "Failed to logout from " + provider + ": " + error
        logger.warn(`Failed to logout from ${provider}: ${error}`);
        // Continue with other providers even if one fails
      }
    }
  }

  /**
   * Get OAuth token for a specific provider
   * Compatible with precedence resolver - returns access token string
   * @param providerName - Name of the provider
   * @param _metadata - Optional metadata for token request (unused in CLI implementation)
   * @returns Access token string if available, null otherwise
   */
  async getToken(
    providerName: string,
    bucket?: string | unknown,
  ): Promise<string | null> {
    // Check if OAuth is enabled for this provider
    if (!this.isOAuthEnabled(providerName)) {
      return null;
    }

    const token = await this.getOAuthToken(providerName, bucket);

    // Special handling for different providers
    // @plan:PLAN-20250823-AUTHFIXES.P15
    // @requirement:REQ-004
    // Removed magic string handling for Gemini - now uses standard OAuth flow

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
      // Special handling for Gemini - USE_EXISTING_GEMINI_OAUTH is not an error
      // It's a signal to use the existing LOGIN_WITH_GOOGLE flow
      if (
        providerName === 'gemini' &&
        error instanceof Error &&
        error.message === 'USE_EXISTING_GEMINI_OAUTH'
      ) {
        // Return null to signal that OAuth should be handled by GeminiProvider
        return null;
      }

      // Re-throw the error so it's not silently swallowed
      logger.error(`OAuth authentication failed for ${providerName}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve the stored OAuth token without refreshing it.
   * Returns null if the provider is unknown or no token exists.
   */
  async peekStoredToken(providerName: string): Promise<OAuthToken | null> {
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    if (!this.providers.has(providerName)) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    try {
      return await this.tokenStore.getToken(providerName);
    } catch (error) {
      logger.debug(`Failed to load stored token for ${providerName}:`, error);
      return null;
    }
  }

  /**
   * Get OAuth token object for a specific provider
   * @param providerName - Name of the provider
   * @param bucket - Optional bucket name for multi-account support (if string), or metadata (for backward compatibility)
   * @returns OAuth token if available, null otherwise
   */
  async getOAuthToken(
    providerName: string,
    bucket?: string | unknown,
  ): Promise<OAuthToken | null> {
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    // Determine the bucket to use: explicit bucket parameter or session bucket override
    let bucketToUse: string | undefined;
    if (typeof bucket === 'string') {
      bucketToUse = bucket;
    } else if (this.sessionBuckets.has(providerName)) {
      bucketToUse = this.sessionBuckets.get(providerName);
    }

    try {
      // 1. Try to get token from store with bucket parameter
      const token = await this.tokenStore.getToken(providerName, bucketToUse);
      if (!token) {
        return null;
      }

      // 2. Check if token expires within 30 seconds
      const nowInSeconds = Math.floor(Date.now() / 1000);
      const thirtySecondsFromNow = nowInSeconds + 30;

      if (token.expiry <= thirtySecondsFromNow) {
        // 3. Token is expired or about to expire, try refresh
        try {
          const refreshedToken = await provider.refreshIfNeeded();
          if (refreshedToken) {
            // 4. Update stored token if refreshed
            await this.tokenStore.saveToken(
              providerName,
              refreshedToken,
              bucketToUse,
            );
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

    this.setOAuthEnabledState(providerName, newState);

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

  private setOAuthEnabledState(providerName: string, enabled: boolean): void {
    if (this.settings) {
      const oauthEnabledProviders =
        this.settings.merged.oauthEnabledProviders || {};
      oauthEnabledProviders[providerName] = enabled;
      this.settings.setValue(
        SettingScope.User,
        'oauthEnabledProviders',
        oauthEnabledProviders,
      );
    } else {
      this.inMemoryOAuthState.set(providerName, enabled);
    }
  }

  getTokenStore(): TokenStore {
    return this.tokenStore;
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
    const settingsService = getSettingsService();
    const authOnly = isAuthOnlyEnabled(settingsService.get('authOnly'));

    if (authOnly) {
      return null;
    }

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

  /**
   * CRITICAL FIX: Clear all auth caches for a provider after logout
   * This method finds and clears auth caches from both BaseProvider and provider-specific implementations
   * @param providerName - Name of the provider to clear caches for
   *
   * @plan PLAN-20251020-STATELESSPROVIDER3.P12
   * @requirement REQ-SP3-003
   * @pseudocode oauth-safety.md lines 1-17
   */
  private async clearProviderAuthCaches(providerName: string): Promise<void> {
    try {
      // Import ProviderManager to access active providers
      // Use dynamic import to avoid circular dependencies
      const { getCliProviderManager, getCliRuntimeContext } =
        await import('../runtime/runtimeSettings.js');
      const providerManager = getCliProviderManager();

      // Get the provider instance to clear its auth cache
      const targetProvider = providerManager.getProviderByName(providerName);
      const provider = unwrapLoggingProvider(
        targetProvider as OAuthProvider | undefined,
      );

      if (!provider) {
        logger.debug(
          `Provider ${providerName} is not registered; skipping auth cache clear.`,
        );
        return;
      }

      if (
        'clearAuthCache' in provider &&
        typeof provider.clearAuthCache === 'function'
      ) {
        provider.clearAuthCache();
      }

      if ('_cachedAuthKey' in provider) {
        const providerWithAuthKey = provider as {
          _cachedAuthKey?: string | undefined;
        };
        providerWithAuthKey._cachedAuthKey = undefined;
      }

      if (provider.name === 'gemini') {
        if (
          'clearAuthCache' in provider &&
          typeof provider.clearAuthCache === 'function'
        ) {
          provider.clearAuthCache();
        }
        if (
          'clearAuth' in provider &&
          typeof provider.clearAuth === 'function'
        ) {
          (provider as { clearAuth: () => void }).clearAuth();
        }
      }

      if (
        'clearState' in provider &&
        typeof provider.clearState === 'function'
      ) {
        provider.clearState();
      }

      try {
        const runtimeContext = getCliRuntimeContext();
        if (runtimeContext && typeof runtimeContext.runtimeId === 'string') {
          flushRuntimeAuthScope(runtimeContext.runtimeId);
        }
      } catch (runtimeError) {
        logger.debug(
          `Skipped runtime auth scope flush for ${providerName}:`,
          runtimeError,
        );
      }

      logger.debug(`Cleared auth caches for provider: ${providerName}`);
    } catch (error) {
      // Cache clearing failures should not prevent logout from succeeding
      logger.debug(
        `Failed to clear provider auth caches for ${providerName}:`,
        error,
      );
    }
  }

  /**
   * Set session bucket override for a provider
   * Session state is in-memory only and not persisted
   */
  setSessionBucket(provider: string, bucket: string): void {
    this.sessionBuckets.set(provider, bucket);
  }

  /**
   * Get session bucket override for a provider
   * Returns undefined if no session override set
   */
  getSessionBucket(provider: string): string | undefined {
    return this.sessionBuckets.get(provider);
  }

  /**
   * Clear session bucket override for a provider
   */
  clearSessionBucket(provider: string): void {
    this.sessionBuckets.delete(provider);
  }

  /**
   * List all buckets for a provider
   */
  async listBuckets(provider: string): Promise<string[]> {
    return this.tokenStore.listBuckets(provider);
  }

  /**
   * Logout from all buckets for a provider
   */
  async logoutAllBuckets(provider: string): Promise<void> {
    const buckets = await this.tokenStore.listBuckets(provider);
    for (const bucket of buckets) {
      try {
        await this.logout(provider, bucket);
      } catch (error) {
        logger.warn(`Failed to logout from bucket ${bucket}:`, error);
      }
    }
    this.clearSessionBucket(provider);
  }

  /**
   * Get authentication status with bucket information
   */
  async getAuthStatusWithBuckets(provider: string): Promise<
    Array<{
      bucket: string;
      authenticated: boolean;
      expiry?: number;
      isSessionBucket: boolean;
    }>
  > {
    const buckets = await this.tokenStore.listBuckets(provider);
    const sessionBucket = this.sessionBuckets.get(provider);
    const statuses: Array<{
      bucket: string;
      authenticated: boolean;
      expiry?: number;
      isSessionBucket: boolean;
    }> = [];

    for (const bucket of buckets) {
      const token = await this.tokenStore.getToken(provider, bucket);
      const isSessionBucket = bucket === sessionBucket;

      if (token) {
        statuses.push({
          bucket,
          authenticated: true,
          expiry: token.expiry,
          isSessionBucket,
        });
      } else {
        statuses.push({
          bucket,
          authenticated: false,
          isSessionBucket,
        });
      }
    }

    return statuses;
  }
}
