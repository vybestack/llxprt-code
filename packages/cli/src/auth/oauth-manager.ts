/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuthToken, AuthStatus, TokenStore } from './types.js';
import { LoadedSettings, SettingScope } from '../config/settings.js';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import {
  getSettingsService,
  flushRuntimeAuthScope,
  DebugLogger,
  MessageBus,
  Config,
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

type OAuthTokenWithExtras = OAuthToken & Record<string, unknown>;

function mergeRefreshedToken(
  currentToken: OAuthTokenWithExtras,
  refreshedToken: OAuthTokenWithExtras,
): OAuthTokenWithExtras {
  const merged: OAuthTokenWithExtras = { ...currentToken, ...refreshedToken };

  for (const key of Object.keys(refreshedToken)) {
    if (refreshedToken[key] === undefined && currentToken[key] !== undefined) {
      merged[key] = currentToken[key];
    }
  }

  if (
    (typeof merged.refresh_token !== 'string' || merged.refresh_token === '') &&
    typeof currentToken.refresh_token === 'string' &&
    currentToken.refresh_token !== ''
  ) {
    merged.refresh_token = currentToken.refresh_token;
  }

  return merged;
}

type ProfileManagerCtor =
  (typeof import('@vybestack/llxprt-code-core'))['ProfileManager'];

let profileManagerCtorPromise: Promise<ProfileManagerCtor> | undefined;

async function getProfileManagerCtor(): Promise<ProfileManagerCtor> {
  if (!profileManagerCtorPromise) {
    profileManagerCtorPromise = import('@vybestack/llxprt-code-core')
      .then((mod) => mod.ProfileManager)
      .catch((error) => {
        profileManagerCtorPromise = undefined;
        throw error;
      });
  }
  return profileManagerCtorPromise;
}

async function createProfileManager(): Promise<
  InstanceType<ProfileManagerCtor>
> {
  const ProfileManager = await getProfileManagerCtor();
  return new ProfileManager();
}

function isLoadBalancerProfileLike(
  profile: unknown,
): profile is { type: 'loadbalancer'; profiles: string[] } {
  return (
    !!profile &&
    typeof profile === 'object' &&
    'type' in profile &&
    (profile as { type?: unknown }).type === 'loadbalancer' &&
    'profiles' in profile &&
    Array.isArray((profile as { profiles?: unknown }).profiles) &&
    (profile as { profiles: unknown[] }).profiles.every(
      (name) => typeof name === 'string' && name.trim() !== '',
    )
  );
}

function getOAuthBucketsFromProfile(
  profile: unknown,
): { providerName: string; buckets: string[] } | null {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const providerName =
    'provider' in profile && typeof profile.provider === 'string'
      ? profile.provider
      : null;
  if (!providerName || providerName.trim() === '') {
    return null;
  }

  const auth = 'auth' in profile ? profile.auth : undefined;
  if (!auth || typeof auth !== 'object') {
    return null;
  }

  if (!('type' in auth) || auth.type !== 'oauth') {
    return null;
  }

  const buckets = (() => {
    if ('buckets' in auth && Array.isArray(auth.buckets)) {
      const bucketNames = auth.buckets
        .filter((bucket) => typeof bucket === 'string')
        .map((bucket) => bucket.trim())
        .filter((bucket) => bucket !== '');
      if (bucketNames.length > 0) {
        return bucketNames;
      }
    }
    return ['default'];
  })();

  return { providerName: providerName.trim(), buckets };
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
   * Refresh a specific token (bucket-aware via the passed token).
   * Implementations must NOT persist; OAuthManager owns persistence.
   * @returns Refreshed token or null if refresh failed
   */
  refreshToken(currentToken: OAuthToken): Promise<OAuthToken | null>;

  /**
   * Optional provider-side logout/revoke for a specific token.
   * OAuthManager always clears local storage for the selected bucket.
   */
  logout?(token?: OAuthToken): Promise<void>;
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
  private bucketResolutionLocks: Map<string, Promise<void>>;
  private proactiveRenewals: Map<
    string,
    { timer: ReturnType<typeof setTimeout>; expiry: number }
  >;
  private proactiveRenewalFailures: Map<string, number>;
  private proactiveRenewalInFlight: Set<string>;
  // Getter function for message bus (lazy resolution for TUI prompts)
  private getMessageBus?: () => MessageBus | undefined;
  // Getter function for config (lazy resolution for bucket failover handler)
  private getConfig?: () => Config | undefined;
  // Session-scoped flag: user dismissed the BucketAuthConfirmation dialog.
  // When true, subsequent auth attempts skip the dialog and proceed directly
  // (i.e. "don't bother me again" rather than "block auth").
  private userDismissedAuthPrompt = false;

  constructor(tokenStore: TokenStore, settings?: LoadedSettings) {
    this.providers = new Map();
    this.tokenStore = tokenStore;
    this.settings = settings;
    this.inMemoryOAuthState = new Map();
    this.sessionBuckets = new Map();
    this.bucketResolutionLocks = new Map();
    this.proactiveRenewals = new Map();
    this.proactiveRenewalFailures = new Map();
    this.proactiveRenewalInFlight = new Set();
  }

  private async withBucketResolutionLock<T>(
    providerName: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const currentTail = this.bucketResolutionLocks.get(providerName);
    const safeTail = currentTail?.catch(() => undefined) ?? Promise.resolve();

    let release: (() => void) | undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    const nextTail = safeTail.then(() => next);
    this.bucketResolutionLocks.set(providerName, nextTail);

    await safeTail;
    try {
      return await fn();
    } finally {
      release?.();
      if (this.bucketResolutionLocks.get(providerName) === nextTail) {
        this.bucketResolutionLocks.delete(providerName);
      }
    }
  }

  /**
   * Set the message bus getter for interactive TUI prompts
   * Uses a getter function to enable lazy resolution after TUI is initialized
   * @param getter - Function that returns the message bus instance from Config
   */
  setMessageBus(getter: () => MessageBus | undefined): void {
    this.getMessageBus = getter;
  }

  /**
   * Set the config getter for bucket failover handler setup
   * Uses a getter function to enable lazy resolution
   * @plan PLAN-20251213issue490
   * @param getter - Function that returns the Config instance
   */
  setConfigGetter(getter: () => Config | undefined): void {
    this.getConfig = getter;
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

    if (typeof provider.refreshToken !== 'function') {
      throw new Error('Provider must implement refreshToken method');
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
    logger.debug(
      () => `[FLOW] authenticate() called for provider: ${providerName}`,
    );
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    try {
      // 1. Initiate authentication with the provider
      logger.debug(
        () => `[FLOW] Calling provider.initiateAuth() for ${providerName}...`,
      );
      await provider.initiateAuth();
      logger.debug(
        () => `[FLOW] provider.initiateAuth() completed for ${providerName}`,
      );

      // 2. Get token from provider after successful auth
      logger.debug(
        () => `[FLOW] Calling provider.getToken() for ${providerName}...`,
      );
      const providerToken = await provider.getToken();
      if (!providerToken) {
        logger.debug(
          () => `[FLOW] provider.getToken() returned null for ${providerName}!`,
        );
        throw new Error('Authentication completed but no token was returned');
      }
      logger.debug(
        () =>
          `[FLOW] provider.getToken() returned token for ${providerName}: access_token=${String(providerToken.access_token).substring(0, 10)}...`,
      );

      // 3. Store token using tokenStore with bucket parameter
      logger.debug(
        () => `[FLOW] Saving token to tokenStore for ${providerName}...`,
      );
      await this.tokenStore.saveToken(providerName, providerToken, bucket);
      logger.debug(
        () => `[FLOW] Token saved to tokenStore for ${providerName}`,
      );

      // 4. Ensure provider marked as OAuth enabled after successful auth
      if (!this.isOAuthEnabled(providerName)) {
        logger.debug(() => `[FLOW] Enabling OAuth for ${providerName}`);
        this.setOAuthEnabledState(providerName, true);
      }
      logger.debug(
        () =>
          `[FLOW] authenticate() completed successfully for ${providerName}`,
      );
    } catch (error) {
      logger.debug(
        () =>
          `[FLOW] authenticate() FAILED for ${providerName}: ${error instanceof Error ? error.message : error}`,
      );
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
            expiresIn,
            oauthEnabled,
          });
        } else {
          // Provider is not authenticated
          statuses.push({
            provider: providerName,
            authenticated: false,
            oauthEnabled,
          });
        }
      } catch (_error) {
        // If we can't get token status, consider it unauthenticated
        const oauthEnabled = this.isOAuthEnabled(providerName);
        statuses.push({
          provider: providerName,
          authenticated: false,
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

    // Resolve which bucket to act on (explicit bucket > session bucket > default)
    const bucketToUse =
      bucket ?? this.sessionBuckets.get(providerName) ?? 'default';

    const tokenForLogout = await this.tokenStore.getToken(
      providerName,
      bucketToUse,
    );

    // Call provider logout if exists (best-effort remote revoke), but ALWAYS clear local token
    if ('logout' in provider && typeof provider.logout === 'function') {
      try {
        if (tokenForLogout) {
          await provider.logout(tokenForLogout);
        }
      } catch (error) {
        logger.warn(`Provider logout failed:`, error);
      }
    }

    await this.tokenStore.removeToken(providerName, bucketToUse);

    // If we just logged out the active session bucket, clear the in-memory override.
    if (this.sessionBuckets.get(providerName) === bucketToUse) {
      this.clearSessionBucket(providerName);
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
    logger.debug(
      () => `[FLOW] getToken() called for provider: ${providerName}`,
    );
    // Check if OAuth is enabled for this provider
    if (!this.isOAuthEnabled(providerName)) {
      logger.debug(
        () => `[FLOW] OAuth is NOT enabled for ${providerName}, returning null`,
      );
      return null;
    }

    logger.debug(
      () =>
        `[FLOW] OAuth is enabled for ${providerName}, calling getOAuthToken()...`,
    );
    const token = await this.getOAuthToken(providerName, bucket);

    // Special handling for different providers
    // @plan:PLAN-20250823-AUTHFIXES.P15
    // @requirement:REQ-004
    // Removed magic string handling for Gemini - now uses standard OAuth flow

    // For Qwen, return the OAuth token to be used as API key
    if (providerName === 'qwen' && token) {
      logger.debug(
        () =>
          `[FLOW] Returning Qwen token: ${token.access_token.substring(0, 10)}...`,
      );
      return token.access_token;
    }

    if (token) {
      logger.debug(
        () =>
          `[FLOW] Returning existing token for ${providerName}: ${token.access_token.substring(0, 10)}...`,
      );
      return token.access_token;
    }

    // @fix issue1191: Try bucket failover before triggering full OAuth re-authentication
    const failoverConfig = this.getConfig?.();
    const failoverHandler = failoverConfig?.getBucketFailoverHandler?.();
    if (failoverHandler?.isEnabled()) {
      logger.debug(
        () =>
          `[issue1191] Session bucket has no token for ${providerName}, attempting bucket failover before OAuth`,
      );
      const failoverResult = await failoverHandler.tryFailover();
      if (failoverResult) {
        const failoverToken = await this.getOAuthToken(providerName);
        if (failoverToken) {
          logger.debug(
            () =>
              `[issue1191] Bucket failover succeeded for ${providerName}, returning token`,
          );
          return failoverToken.access_token;
        }
      }
      logger.debug(
        () =>
          `[issue1191] Bucket failover did not yield a token for ${providerName}, falling through to OAuth`,
      );
    }

    // For other providers, trigger OAuth flow
    // Check if the current profile has multiple buckets - if so, use MultiBucketAuthenticator
    // Issue 913: Also check if auth-bucket-prompt is enabled for single/default buckets
    logger.debug(
      () =>
        `[FLOW] No existing token for ${providerName}, triggering OAuth flow...`,
    );

    // @fix issue1262 & issue1195: Before triggering OAuth, check disk with lock
    // Another process or earlier run may have written a valid token that we missed
    // Use the same locking pattern as PR #1258 to prevent race conditions
    const bucketToCheck = typeof bucket === 'string' ? bucket : undefined;
    const lockAcquired = await this.tokenStore.acquireRefreshLock(
      providerName,
      {
        waitMs: 5000, // Wait up to 5 seconds for lock
        staleMs: 30000,
        bucket: bucketToCheck,
      },
    );

    if (lockAcquired) {
      try {
        // Double-check disk for token written by another process
        const diskToken = await this.tokenStore.getToken(
          providerName,
          bucketToCheck,
        );
        const nowInSeconds = Math.floor(Date.now() / 1000);
        const thirtySecondsFromNow = nowInSeconds + 30;

        if (diskToken && diskToken.expiry > thirtySecondsFromNow) {
          // Valid token found on disk! Use it instead of triggering OAuth
          logger.debug(
            () =>
              `[issue1262/1195] Found valid token on disk for ${providerName}, skipping OAuth`,
          );
          return diskToken.access_token;
        }

        // @fix issue1317: Expired disk token with refresh_token — attempt refresh
        // before falling through to full OAuth re-authentication
        if (
          diskToken &&
          typeof diskToken.refresh_token === 'string' &&
          diskToken.refresh_token !== ''
        ) {
          const provider = this.providers.get(providerName);
          if (provider) {
            try {
              const refreshedToken = await provider.refreshToken(diskToken);
              if (refreshedToken) {
                const mergedToken = mergeRefreshedToken(
                  diskToken as OAuthTokenWithExtras,
                  refreshedToken as OAuthTokenWithExtras,
                );
                await this.tokenStore.saveToken(
                  providerName,
                  mergedToken,
                  bucketToCheck,
                );
                logger.debug(
                  () =>
                    `[issue1317] Refreshed expired disk token for ${providerName}, skipping OAuth`,
                );
                return mergedToken.access_token;
              }
            } catch (refreshError) {
              logger.debug(
                () =>
                  `[issue1317] Disk token refresh failed for ${providerName}: ${refreshError instanceof Error ? refreshError.message : refreshError}`,
              );
            }
          }
        }
      } finally {
        await this.tokenStore.releaseRefreshLock(providerName, bucketToCheck);
      }
    } else {
      // Couldn't acquire lock - check disk anyway, another process may have just written a token
      const diskToken = await this.tokenStore.getToken(
        providerName,
        bucketToCheck,
      );
      const nowInSeconds = Math.floor(Date.now() / 1000);
      const thirtySecondsFromNow = nowInSeconds + 30;

      if (diskToken && diskToken.expiry > thirtySecondsFromNow) {
        logger.debug(
          () =>
            `[issue1262/1195] Found valid token on disk after lock timeout for ${providerName}`,
        );
        return diskToken.access_token;
      }
    }

    // No valid token on disk (or refresh failed), proceed with OAuth flow
    try {
      const buckets = await this.getProfileBuckets(providerName);

      // Issue 913 FIX: When auth-bucket-prompt is enabled, route ALL profiles through
      // MultiBucketAuthenticator to ensure the confirmation dialog is shown
      // Import getEphemeralSetting dynamically to avoid circular dependencies
      // Wrap in try-catch to handle cases where runtime context is not available (e.g., tests)
      let showPrompt = false;
      try {
        const { getEphemeralSetting: getRuntimeEphemeralSetting } =
          await import('../runtime/runtimeSettings.js');
        showPrompt =
          (getRuntimeEphemeralSetting('auth-bucket-prompt') as boolean) ??
          false;
      } catch (runtimeError) {
        // Runtime context not available (e.g., in tests) - fall back to non-prompt mode
        logger.debug(
          'Could not get ephemeral setting (runtime not initialized), using default',
          runtimeError,
        );
      }

      if (buckets.length > 1) {
        logger.debug(
          `Multi-bucket lazy auth triggered for ${providerName} with ${buckets.length} buckets`,
        );
        await this.authenticateMultipleBuckets(providerName, buckets);
      } else if (showPrompt) {
        // Issue 913: Single/default bucket with prompt mode - use MultiBucketAuthenticator
        // to ensure the confirmation dialog is shown before opening browser
        const effectiveBuckets = buckets.length === 1 ? buckets : ['default'];
        logger.debug(
          `Single-bucket auth with prompt mode for ${providerName}, bucket: ${effectiveBuckets[0]}`,
        );
        await this.authenticateMultipleBuckets(providerName, effectiveBuckets);
      } else {
        await this.authenticate(providerName);
      }
      logger.debug(
        () =>
          `[FLOW] authenticate() completed for ${providerName}, fetching new token...`,
      );
      const newToken = await this.getOAuthToken(providerName);
      // Return the access token without any prefix - OAuth Bearer tokens should be used as-is
      if (newToken) {
        logger.debug(
          () =>
            `[FLOW] Returning new token for ${providerName}: ${newToken.access_token.substring(0, 10)}...`,
        );
      } else {
        logger.debug(
          () =>
            `[FLOW] getOAuthToken() returned null after authenticate() for ${providerName}`,
        );
      }
      return newToken ? newToken.access_token : null;
    } catch (error) {
      logger.debug(
        () =>
          `[FLOW] getToken() OAuth flow FAILED for ${providerName}: ${error instanceof Error ? error.message : error}`,
      );
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
    logger.debug(
      () => `[FLOW] getOAuthToken() called for provider: ${providerName}`,
    );
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    const explicitBucket = typeof bucket === 'string';

    // Determine the bucket to use: explicit bucket parameter or session bucket override
    let bucketToUse: string | undefined;
    if (explicitBucket) {
      bucketToUse = bucket;
    }

    // If no explicit/session bucket is set, fall back to the first bucket in the active profile.
    // This enables multi-bucket profiles to work without requiring an explicit /auth <provider> switch.
    let profileBuckets: string[] = [];
    let failoverHandler:
      | {
          getBuckets: () => string[];
          getCurrentBucket: () => string | undefined;
          isEnabled: () => boolean;
        }
      | undefined;

    if (!explicitBucket) {
      await this.withBucketResolutionLock(providerName, async () => {
        if (this.sessionBuckets.has(providerName)) {
          bucketToUse = this.sessionBuckets.get(providerName);
        }

        profileBuckets = await this.getProfileBuckets(providerName);

        const config = this.getConfig?.();
        // @fix issue1029 - Enhanced debug logging for failover handler setup
        logger.debug(
          () =>
            `[issue1029] getOAuthToken: provider=${providerName}, buckets=${JSON.stringify(profileBuckets)}, hasConfig=${!!config}`,
        );

        if (config && profileBuckets.length > 1) {
          failoverHandler = config.getBucketFailoverHandler?.();

          const existingBuckets = failoverHandler?.getBuckets?.() ?? [];
          const sameBuckets =
            existingBuckets.length === profileBuckets.length &&
            existingBuckets.every(
              (value, index) => value === profileBuckets[index],
            );

          logger.debug(
            () =>
              `[issue1029] Failover handler check: hasExisting=${!!failoverHandler}, sameBuckets=${sameBuckets}, existingBuckets=${JSON.stringify(existingBuckets)}`,
          );

          if (!failoverHandler || !sameBuckets) {
            const handler = new BucketFailoverHandlerImpl(
              profileBuckets,
              providerName,
              this,
            );
            config.setBucketFailoverHandler(handler);
            failoverHandler = handler;
            logger.debug(
              () =>
                `[issue1029] Created and set new BucketFailoverHandlerImpl on config for ${providerName} with buckets: ${JSON.stringify(profileBuckets)}`,
            );
          }
        } else if (profileBuckets.length > 1 && !config) {
          // @fix issue1029 - This is the bug! We have multiple buckets but no config to set handler on
          logger.warn(
            `[issue1029] CRITICAL: Profile has ${profileBuckets.length} buckets but no Config available to set failover handler! ` +
              `Bucket failover will NOT work. Ensure OAuthManager.setConfigGetter is called with the active Config instance.`,
          );
        }

        if (!bucketToUse) {
          const handlerBucket = failoverHandler?.getCurrentBucket?.();
          if (
            typeof handlerBucket === 'string' &&
            handlerBucket.trim() !== ''
          ) {
            bucketToUse = handlerBucket;
          } else if (profileBuckets.length > 0) {
            bucketToUse = profileBuckets[0];
          }

          // Establish a default session bucket for the duration of this CLI session.
          if (bucketToUse && !this.sessionBuckets.has(providerName)) {
            this.sessionBuckets.set(providerName, bucketToUse);
          }
        }
      });
    }

    try {
      // 1. Try to get token from store with bucket parameter
      logger.debug(
        () => `[FLOW] Reading token from tokenStore for ${providerName}...`,
      );
      const token = await this.tokenStore.getToken(providerName, bucketToUse);
      if (!token) {
        logger.debug(() => `[FLOW] No token in tokenStore for ${providerName}`);
        return null;
      }
      logger.debug(
        () =>
          `[FLOW] Token found in tokenStore for ${providerName}: expiry=${token.expiry}, keys=${Object.keys(token).join(',')}`,
      );

      // 2. Check if token expires within 30 seconds
      const nowInSeconds = Math.floor(Date.now() / 1000);
      const thirtySecondsFromNow = nowInSeconds + 30;

      logger.debug(
        () =>
          `[FLOW] Token expiry check: now=${nowInSeconds}, expiry=${token.expiry}, isExpired=${token.expiry <= thirtySecondsFromNow}`,
      );

      if (token.expiry <= thirtySecondsFromNow) {
        // 3. Token is expired or about to expire, try refresh with locking
        logger.debug(
          () =>
            `[FLOW] Token expired or expiring soon for ${providerName}, attempting refresh with lock...`,
        );

        // Issue #1159: Acquire lock before refreshing to prevent concurrent refreshes
        const lockAcquired = await this.tokenStore.acquireRefreshLock(
          providerName,
          { waitMs: 10000, staleMs: 30000, bucket: bucketToUse },
        );

        if (!lockAcquired) {
          logger.debug(
            () =>
              `[FLOW] Failed to acquire refresh lock for ${providerName}, checking disk...`,
          );
          // Lock timeout - check disk again in case another process refreshed
          const reloadedToken = await this.tokenStore.getToken(
            providerName,
            bucketToUse,
          );
          if (reloadedToken && reloadedToken.expiry > thirtySecondsFromNow) {
            logger.debug(
              () =>
                `[FLOW] Token was refreshed by another process for ${providerName}`,
            );
            this.scheduleProactiveRenewal(
              providerName,
              bucketToUse,
              reloadedToken,
            );
            return reloadedToken;
          }
          // Still expired after lock timeout - return null
          return null;
        }

        try {
          // Issue #1159: Double-check pattern - re-read token after acquiring lock
          const recheckToken = await this.tokenStore.getToken(
            providerName,
            bucketToUse,
          );
          if (recheckToken && recheckToken.expiry > thirtySecondsFromNow) {
            logger.debug(
              () =>
                `[FLOW] Token was refreshed by another process while waiting for lock for ${providerName}`,
            );
            this.scheduleProactiveRenewal(
              providerName,
              bucketToUse,
              recheckToken,
            );
            return recheckToken;
          }

          // Token is still expired, proceed with refresh
          const refreshedToken = await provider.refreshToken(
            recheckToken || token,
          );
          if (refreshedToken) {
            const mergedToken = mergeRefreshedToken(
              (recheckToken || token) as OAuthTokenWithExtras,
              refreshedToken as OAuthTokenWithExtras,
            );
            // 4. Update stored token if refreshed
            logger.debug(
              () =>
                `[FLOW] Token refreshed for ${providerName}, saving to store...`,
            );
            await this.tokenStore.saveToken(
              providerName,
              mergedToken,
              bucketToUse,
            );
            this.scheduleProactiveRenewal(
              providerName,
              bucketToUse,
              mergedToken,
            );
            return mergedToken;
          } else {
            // Refresh failed, return null
            logger.debug(
              () => `[FLOW] Token refresh returned null for ${providerName}`,
            );
            return null;
          }
        } catch (refreshError) {
          // Token refresh failure: Return null, no logging
          logger.debug(
            () =>
              `[FLOW] Token refresh FAILED for ${providerName}: ${refreshError instanceof Error ? refreshError.message : refreshError}`,
          );
          return null;
        } finally {
          // Always release lock
          await this.tokenStore.releaseRefreshLock(providerName, bucketToUse);
        }
      }

      // 5. Return valid token
      logger.debug(() => `[FLOW] Returning valid token for ${providerName}`);
      this.scheduleProactiveRenewal(providerName, bucketToUse, token);
      return token;
    } catch (error) {
      logger.debug(
        () =>
          `[FLOW] getOAuthToken() ERROR for ${providerName}: ${error instanceof Error ? error.message : error}`,
      );
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

  private normalizeBucket(bucket?: string): string {
    if (typeof bucket === 'string' && bucket.trim() !== '') {
      return bucket;
    }
    return 'default';
  }

  private getProactiveRenewalKey(providerName: string, bucket: string): string {
    return `${providerName}:${bucket}`;
  }

  private clearProactiveRenewal(key: string): void {
    const entry = this.proactiveRenewals.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      this.proactiveRenewals.delete(key);
    }
    this.proactiveRenewalFailures.delete(key);
    this.proactiveRenewalInFlight.delete(key);
  }

  private setProactiveTimer(
    providerName: string,
    bucket: string,
    delayMs: number,
    expiry: number,
  ): void {
    const key = this.getProactiveRenewalKey(providerName, bucket);
    const existing = this.proactiveRenewals.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const MAX_DELAY_MS = 2 ** 31 - 1;
    const safeDelay = Math.min(Math.max(0, delayMs), MAX_DELAY_MS);

    const timer = setTimeout(() => {
      void this.runProactiveRenewal(providerName, bucket).catch((error) => {
        logger.debug(
          () =>
            `[OAUTH] Proactive renewal error for ${providerName}:${bucket}: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      });
    }, safeDelay);

    // Don't keep the process alive solely for renewals.
    if (
      typeof (timer as unknown as { unref?: () => void }).unref === 'function'
    ) {
      (timer as unknown as { unref: () => void }).unref();
    }

    this.proactiveRenewals.set(key, { timer, expiry });
  }

  private scheduleProactiveRetry(providerName: string, bucket: string): void {
    const normalizedBucket = this.normalizeBucket(bucket);
    const key = this.getProactiveRenewalKey(providerName, normalizedBucket);
    const failures = (this.proactiveRenewalFailures.get(key) ?? 0) + 1;
    this.proactiveRenewalFailures.set(key, failures);

    const cappedFailures = Math.min(failures, 10);
    const baseMs = 30_000;
    const delayMs = Math.min(baseMs * 2 ** cappedFailures, 30 * 60_000);
    const jitterMs = Math.floor(Math.random() * 5_000);

    const expiry = this.proactiveRenewals.get(key)?.expiry ?? 0;
    this.setProactiveTimer(
      providerName,
      normalizedBucket,
      delayMs + jitterMs,
      expiry,
    );
  }

  private scheduleProactiveRenewal(
    providerName: string,
    bucket: string | undefined,
    token: OAuthToken,
  ): void {
    if (!this.isOAuthEnabled(providerName)) {
      return;
    }

    if (!token.refresh_token || token.refresh_token.trim() === '') {
      return;
    }

    const normalizedBucket = this.normalizeBucket(bucket);
    const key = this.getProactiveRenewalKey(providerName, normalizedBucket);

    const nowSec = Date.now() / 1000;
    const remainingSec = token.expiry - nowSec;
    if (remainingSec <= 0) {
      return;
    }

    const leadSec = Math.max(300, Math.floor(remainingSec * 0.1));
    const jitterSec = Math.floor(Math.random() * 30);
    const refreshAtSec = token.expiry - leadSec - jitterSec;
    const delayMs = Math.floor(Math.max(0, (refreshAtSec - nowSec) * 1000));

    const existing = this.proactiveRenewals.get(key);
    if (existing && existing.expiry === token.expiry) {
      return;
    }

    this.proactiveRenewalFailures.delete(key);
    this.setProactiveTimer(
      providerName,
      normalizedBucket,
      delayMs,
      token.expiry,
    );
  }

  private async runProactiveRenewal(
    providerName: string,
    bucket: string,
  ): Promise<void> {
    const normalizedBucket = this.normalizeBucket(bucket);
    const key = this.getProactiveRenewalKey(providerName, normalizedBucket);

    if (this.proactiveRenewalInFlight.has(key)) {
      return;
    }
    this.proactiveRenewalInFlight.add(key);

    try {
      if (!this.isOAuthEnabled(providerName)) {
        this.clearProactiveRenewal(key);
        return;
      }

      const provider = this.providers.get(providerName);
      if (!provider) {
        // Provider might not be registered in this runtime; keep the timer but back off.
        this.scheduleProactiveRetry(providerName, normalizedBucket);
        return;
      }

      const currentToken = await this.tokenStore.getToken(
        providerName,
        normalizedBucket,
      );
      if (!currentToken || !currentToken.refresh_token) {
        this.clearProactiveRenewal(key);
        return;
      }

      // Issue #1159: Acquire lock before refreshing
      const lockAcquired = await this.tokenStore.acquireRefreshLock(
        providerName,
        { waitMs: 10000, staleMs: 30000, bucket: normalizedBucket },
      );

      if (!lockAcquired) {
        // Lock timeout - retry later
        this.scheduleProactiveRetry(providerName, normalizedBucket);
        return;
      }

      try {
        // Issue #1159: Double-check pattern - re-read token after acquiring lock
        const recheckToken = await this.tokenStore.getToken(
          providerName,
          normalizedBucket,
        );

        if (!recheckToken || !recheckToken.refresh_token) {
          this.clearProactiveRenewal(key);
          return;
        }

        // Check if token is still expired/expiring
        const nowInSeconds = Math.floor(Date.now() / 1000);
        const thirtySecondsFromNow = nowInSeconds + 30;
        if (recheckToken.expiry > thirtySecondsFromNow) {
          // Token was already refreshed by another process
          logger.debug(
            () =>
              `[OAUTH] Token was already refreshed for ${providerName}:${normalizedBucket}, rescheduling`,
          );
          this.proactiveRenewalFailures.delete(key);
          this.scheduleProactiveRenewal(
            providerName,
            normalizedBucket,
            recheckToken,
          );
          return;
        }

        // Proceed with refresh
        const refreshedToken = await provider.refreshToken(recheckToken);
        if (!refreshedToken) {
          this.scheduleProactiveRetry(providerName, normalizedBucket);
          return;
        }

        const mergedToken = mergeRefreshedToken(
          recheckToken as OAuthTokenWithExtras,
          refreshedToken as OAuthTokenWithExtras,
        );

        await this.tokenStore.saveToken(
          providerName,
          mergedToken,
          normalizedBucket,
        );
        this.proactiveRenewalFailures.delete(key);
        this.scheduleProactiveRenewal(
          providerName,
          normalizedBucket,
          mergedToken,
        );
      } finally {
        // Always release lock
        await this.tokenStore.releaseRefreshLock(
          providerName,
          normalizedBucket,
        );
      }
    } finally {
      this.proactiveRenewalInFlight.delete(key);
    }
  }

  async configureProactiveRenewalsForProfile(profile: unknown): Promise<void> {
    const desiredKeys = new Set<string>();
    const targets: Array<{ providerName: string; bucket: string }> = [];

    const direct = getOAuthBucketsFromProfile(profile);
    if (direct) {
      for (const bucket of direct.buckets) {
        targets.push({ providerName: direct.providerName, bucket });
      }
    }

    if (isLoadBalancerProfileLike(profile)) {
      const profileManager = await createProfileManager();
      const visited = new Set<string>();

      const visit = async (profileName: string): Promise<void> => {
        if (visited.has(profileName)) {
          return;
        }
        visited.add(profileName);

        let loaded: unknown;
        try {
          loaded = await profileManager.loadProfile(profileName);
        } catch (error) {
          logger.debug(
            () =>
              `[OAUTH] Failed to load profile '${profileName}' for proactive renewals: ${
                error instanceof Error ? error.message : String(error)
              }`,
          );
          return;
        }
        const oauth = getOAuthBucketsFromProfile(loaded);
        if (oauth) {
          for (const bucket of oauth.buckets) {
            targets.push({ providerName: oauth.providerName, bucket });
          }
        }

        if (isLoadBalancerProfileLike(loaded)) {
          for (const child of loaded.profiles) {
            await visit(child);
          }
        }
      };

      for (const name of profile.profiles) {
        await visit(name);
      }
    }

    for (const target of targets) {
      const bucket = this.normalizeBucket(target.bucket);
      desiredKeys.add(this.getProactiveRenewalKey(target.providerName, bucket));
    }

    for (const existingKey of Array.from(this.proactiveRenewals.keys())) {
      if (!desiredKeys.has(existingKey)) {
        this.clearProactiveRenewal(existingKey);
      }
    }

    for (const target of targets) {
      if (!this.isOAuthEnabled(target.providerName)) {
        continue;
      }

      const bucket = this.normalizeBucket(target.bucket);
      const token = await this.tokenStore.getToken(target.providerName, bucket);
      if (!token) {
        continue;
      }
      this.scheduleProactiveRenewal(target.providerName, bucket, token);
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
      const { getCliProviderManager, getCliRuntimeContext } = await import(
        '../runtime/runtimeSettings.js'
      );
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

      // Flush all known runtime scopes to ensure cached tokens are invalidated
      // This fixes Issue #975 where logout didn't invalidate in-memory cached tokens
      const knownRuntimeIds = [
        'legacy-singleton',
        'provider-manager-singleton',
      ];
      try {
        const runtimeContext = getCliRuntimeContext();
        if (runtimeContext && typeof runtimeContext.runtimeId === 'string') {
          if (!knownRuntimeIds.includes(runtimeContext.runtimeId)) {
            knownRuntimeIds.push(runtimeContext.runtimeId);
          }
        }
      } catch (runtimeError) {
        logger.debug(
          `Could not get CLI runtime context for ${providerName}:`,
          runtimeError,
        );
      }

      // Flush all known runtime scopes
      for (const runtimeId of knownRuntimeIds) {
        try {
          flushRuntimeAuthScope(runtimeId);
          logger.debug(`Flushed runtime auth scope: ${runtimeId}`);
        } catch (flushError) {
          logger.debug(`Skipped flush for runtime ${runtimeId}:`, flushError);
        }
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

  /**
   * Get the list of buckets for the current profile for a given provider
   * If the current profile has auth.buckets configured, return those.
   * Otherwise, return empty array (single-bucket or non-OAuth profile)
   */

  /**
   * Get Anthropic usage information from OAuth endpoint for a specific bucket
   * Returns full usage data for Claude Code/Max plans
   * Only works with OAuth tokens (sk-ant-oat01-...), not API keys
   * @param bucket - Optional bucket name, defaults to current session bucket or 'default'
   */
  async getAnthropicUsageInfo(
    bucket?: string,
  ): Promise<Record<string, unknown> | null> {
    const provider = this.providers.get('anthropic');
    if (!provider) {
      return null;
    }

    // Get the token for the specified bucket
    const bucketToUse =
      bucket ?? this.sessionBuckets.get('anthropic') ?? 'default';
    const token = await this.tokenStore.getToken('anthropic', bucketToUse);

    if (!token) {
      return null;
    }

    try {
      const { fetchAnthropicUsage } = await import(
        '@vybestack/llxprt-code-core'
      );
      return await fetchAnthropicUsage(token.access_token);
    } catch (error) {
      logger.debug(
        `Error fetching Anthropic usage info for bucket ${bucketToUse}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Get Anthropic usage information for all authenticated buckets
   * Returns a map of bucket name to usage info for all buckets that have valid OAuth tokens
   */
  async getAllAnthropicUsageInfo(): Promise<
    Map<string, Record<string, unknown>>
  > {
    const result = new Map<string, Record<string, unknown>>();

    // Get all buckets for anthropic
    const buckets = await this.tokenStore.listBuckets('anthropic');

    // If no buckets, try 'default'
    const bucketsToCheck = buckets.length > 0 ? buckets : ['default'];

    // Import once before the loop
    const { fetchAnthropicUsage } = await import('@vybestack/llxprt-code-core');

    for (const bucket of bucketsToCheck) {
      // Check if this bucket has a valid OAuth token
      const token = await this.tokenStore.getToken('anthropic', bucket);
      if (!token) {
        continue;
      }

      // Check if token is expired
      const nowInSeconds = Math.floor(Date.now() / 1000);
      if (token.expiry <= nowInSeconds) {
        continue;
      }

      // Check if it's an OAuth token (sk-ant-oat01-...)
      if (!token.access_token.startsWith('sk-ant-oat01-')) {
        continue;
      }

      try {
        const usageInfo = await fetchAnthropicUsage(token.access_token);
        if (usageInfo) {
          result.set(bucket, usageInfo);
        }
      } catch (error) {
        logger.debug(
          `Error fetching Anthropic usage info for bucket ${bucket}:`,
          error,
        );
      }
    }

    return result;
  }

  /**
   * Get Codex usage information for all authenticated buckets
   * Returns a map of bucket name to usage info for all buckets that have valid OAuth tokens with account_id
   */
  async getAllCodexUsageInfo(): Promise<Map<string, Record<string, unknown>>> {
    const result = new Map<string, Record<string, unknown>>();

    // Get all buckets for codex
    const buckets = await this.tokenStore.listBuckets('codex');

    // If no buckets, try 'default'
    const bucketsToCheck = buckets.length > 0 ? buckets : ['default'];

    // Import once before the loop
    const { fetchCodexUsage } = await import('@vybestack/llxprt-code-core');

    for (const bucket of bucketsToCheck) {
      // Check if this bucket has a valid OAuth token
      const token = await this.tokenStore.getToken('codex', bucket);
      if (!token) {
        continue;
      }

      // Check if token is expired
      const nowInSeconds = Math.floor(Date.now() / 1000);
      if (token.expiry <= nowInSeconds) {
        continue;
      }

      // Extract account_id from token (Codex tokens have this field)
      // Use runtime property access without narrowing type assertion
      const tokenObj = token as Record<string, unknown>;
      const accountId =
        typeof tokenObj['account_id'] === 'string'
          ? tokenObj['account_id']
          : undefined;
      if (!accountId) {
        logger.debug(
          `Codex token for bucket ${bucket} does not have account_id, skipping`,
        );
        continue;
      }

      // Fetch usage info for this bucket
      try {
        const config = this.getConfig?.();
        const runtimeBaseUrl = config?.getEphemeralSetting('base-url');
        const codexBaseUrl =
          typeof runtimeBaseUrl === 'string' && runtimeBaseUrl.trim() !== ''
            ? runtimeBaseUrl
            : undefined;

        const usageInfo = await fetchCodexUsage(
          token.access_token,
          accountId,
          codexBaseUrl,
        );
        if (usageInfo) {
          result.set(bucket, usageInfo);
        }
      } catch (error) {
        logger.debug(
          `Error fetching Codex usage info for bucket ${bucket}:`,
          error,
        );
      }
    }

    return result;
  }

  private async getProfileBuckets(providerName: string): Promise<string[]> {
    try {
      // Try to get profile from runtime settings
      const { getCliRuntimeServices } = await import(
        '../runtime/runtimeSettings.js'
      );
      const { settingsService } = getCliRuntimeServices();

      // Get current profile name
      const currentProfileName =
        typeof settingsService.getCurrentProfileName === 'function'
          ? settingsService.getCurrentProfileName()
          : (settingsService.get('currentProfile') as string | null);

      if (!currentProfileName) {
        return [];
      }

      // Load the profile to check for auth.buckets
      const profileManager = await createProfileManager();
      const profile = await profileManager.loadProfile(currentProfileName);

      // Check if profile has auth.buckets for this provider
      if (
        'auth' in profile &&
        profile.auth &&
        typeof profile.auth === 'object' &&
        'type' in profile.auth &&
        profile.auth.type === 'oauth' &&
        'buckets' in profile.auth &&
        Array.isArray(profile.auth.buckets)
      ) {
        return profile.auth.buckets;
      }

      return [];
    } catch (error) {
      logger.debug(
        `Could not load profile buckets for ${providerName}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Authenticate multiple OAuth buckets sequentially using MultiBucketAuthenticator
   * with timing controls (delay/prompt) and browser auto-open settings
   *
   * Issue 913: This method now supports eager authentication of all buckets upfront,
   * filtering out already-authenticated buckets to avoid unnecessary prompts.
   */
  private async authenticateMultipleBuckets(
    providerName: string,
    buckets: string[],
  ): Promise<void> {
    const { MultiBucketAuthenticator } = await import(
      './MultiBucketAuthenticator.js'
    );

    // Get ephemeral settings for timing controls
    const { getEphemeralSetting: getRuntimeEphemeralSetting } = await import(
      '../runtime/runtimeSettings.js'
    );
    const getEphemeralSetting = <T>(key: string): T | undefined =>
      getRuntimeEphemeralSetting(key) as T | undefined;

    // Debug: log the raw setting value
    const rawBucketPrompt = getRuntimeEphemeralSetting('auth-bucket-prompt');
    logger.debug('Checking auth-bucket-prompt setting', {
      rawValue: rawBucketPrompt,
      typeof: typeof rawBucketPrompt,
    });

    // Issue 913 FIX: Filter out already-authenticated buckets for eager auth
    // Only prompt/authenticate buckets that don't have valid tokens
    const unauthenticatedBuckets: string[] = [];
    const nowInSeconds = Math.floor(Date.now() / 1000);

    for (const bucket of buckets) {
      const existingToken = await this.tokenStore.getToken(
        providerName,
        bucket,
      );
      // Check if token exists and is not expired (with 30-second buffer)
      if (existingToken && existingToken.expiry > nowInSeconds + 30) {
        logger.debug(`Bucket ${bucket} already authenticated, skipping`, {
          provider: providerName,
          bucket,
          expiry: existingToken.expiry,
        });
      } else {
        unauthenticatedBuckets.push(bucket);
      }
    }

    // If all buckets are already authenticated, nothing to do
    if (unauthenticatedBuckets.length === 0) {
      logger.debug('All buckets already authenticated', {
        provider: providerName,
        bucketCount: buckets.length,
      });
      return;
    }

    logger.debug('Buckets requiring authentication', {
      provider: providerName,
      total: buckets.length,
      needsAuth: unauthenticatedBuckets.length,
      buckets: unauthenticatedBuckets,
    });

    // Callback to authenticate a single bucket
    const onAuthBucket = async (
      provider: string,
      bucket: string,
      index: number,
      total: number,
    ): Promise<void> => {
      // Show visible console output for user
      console.log(`\n=== Bucket ${index} of ${total}: ${bucket} ===\n`);

      logger.debug(`Authenticating bucket ${index} of ${total}: ${bucket}`);
      await this.authenticate(provider, bucket);
    };

    // Callback for prompting - uses TUI dialog if available, falls back to delay
    const onPrompt = async (
      provider: string,
      bucket: string,
    ): Promise<boolean> => {
      // If user already dismissed in this session, skip the dialog and proceed directly
      if (this.userDismissedAuthPrompt) {
        logger.debug(
          'User previously dismissed auth prompt in this session, proceeding directly',
          { provider, bucket },
        );
        return true;
      }

      // Check if prompt mode is enabled FIRST - this determines timeout behavior
      // Issue 913: When prompt mode is enabled, wait indefinitely for user approval
      const showPrompt = getEphemeralSetting<boolean>('auth-bucket-prompt');

      // Try interactive TUI prompt if message bus getter is available
      // Use lazy resolution to get message bus after TUI is initialized
      const messageBus = this.getMessageBus?.();
      if (messageBus) {
        try {
          logger.debug('Requesting bucket auth confirmation via message bus', {
            provider,
            bucket,
            promptMode: showPrompt,
          });

          // Request confirmation via message bus
          const confirmPromise = messageBus.requestBucketAuthConfirmation(
            provider,
            bucket,
            buckets.indexOf(bucket) + 1,
            buckets.length,
          );

          // Issue 913 FIX: When prompt mode is enabled, wait indefinitely for user approval
          // The MessageBus has its own 5-minute timeout as an emergency safeguard
          if (showPrompt) {
            logger.debug(
              'Prompt mode enabled - waiting indefinitely for user approval',
            );
            const result = await confirmPromise;
            logger.debug('User responded to bucket auth confirmation', {
              result,
            });
            if (!result) {
              this.userDismissedAuthPrompt = true;
            }
            return result;
          }

          // Prompt mode disabled: Race with a 3-second timeout for backward compatibility
          // If TUI is ready, it will respond; otherwise we fall back to delay
          const timeoutPromise = new Promise<'timeout'>((resolve) =>
            setTimeout(() => resolve('timeout'), 3000),
          );

          const result = await Promise.race([confirmPromise, timeoutPromise]);

          if (result !== 'timeout') {
            // TUI responded - return the confirmation result
            logger.debug('TUI responded to bucket auth confirmation', {
              result,
            });
            if (!result) {
              this.userDismissedAuthPrompt = true;
            }
            return result;
          }
          // TUI didn't respond in time - fall back to delay
          logger.debug('TUI not ready, falling back to delay-based prompt');
        } catch (error) {
          logger.debug('Error using message bus, falling back to delay', {
            error,
          });
        }
      } else {
        logger.debug('No message bus available');
      }

      // TUI not available or timed out - try stdin if TTY and prompt enabled
      logger.debug('Checking TTY prompt fallback', {
        showPrompt,
        isTTY: process.stdin.isTTY,
      });
      if (showPrompt && process.stdin.isTTY) {
        // Interactive terminal - wait for keypress
        console.log(`\nReady to authenticate bucket: ${bucket}`);
        console.log('Press ENTER to continue, or Ctrl+C to cancel...\n');
        let rawModeSet = false;
        try {
          await new Promise<void>((resolve, reject) => {
            const cleanup = (): void => {
              process.stdin.removeListener('data', onData);
              process.stdin.removeListener('error', onError);
              if (rawModeSet && process.stdin.isTTY) {
                try {
                  process.stdin.setRawMode(false);
                } catch {
                  // Issue #1020: Ignore EIO errors during cleanup
                }
              }
              process.stdin.pause();
            };
            const onData = (): void => {
              cleanup();
              resolve();
            };
            // Issue #1020: Make error handler defensive against EIO errors
            const onError = (err: Error): void => {
              cleanup();
              // Check if this is a transient I/O error we should ignore
              const nodeError = err as NodeJS.ErrnoException;
              const isEioError =
                nodeError.code === 'EIO' ||
                nodeError.errno === -5 ||
                (typeof nodeError.message === 'string' &&
                  nodeError.message.includes('EIO'));
              if (isEioError) {
                // EIO errors are transient - treat as user cancel instead of crashing
                logger.debug(
                  'Ignoring transient stdin EIO error during prompt',
                );
                reject(new Error('Prompt cancelled due to I/O error'));
              } else {
                reject(err);
              }
            };
            if (process.stdin.isTTY) {
              try {
                // Issue #1020: Wrap setRawMode in try-catch
                process.stdin.setRawMode(true);
                rawModeSet = true;
              } catch (err) {
                // If setRawMode fails, EIO-style errors should not crash
                logger.debug('Failed to set raw mode for prompt:', err);
                cleanup();
                reject(new Error('Failed to set raw mode for prompt'));
                return; // Don't continue setting up listeners
              }
            }
            process.stdin.resume();
            process.stdin.once('data', onData);
            process.stdin.once('error', onError);
          });
        } catch (error) {
          // Issue #1020: Ensure raw mode is reset even on unexpected errors
          if (rawModeSet && process.stdin.isTTY) {
            try {
              process.stdin.setRawMode(false);
            } catch {
              // Ignore cleanup errors (likely EIO)
            }
          }
          throw error;
        }
        return true;
      }

      // Fall back to delay-based prompting (no TTY or prompt disabled)
      const delay = getEphemeralSetting<number>('auth-bucket-delay') ?? 5000;
      console.log(`\nReady to authenticate bucket: ${bucket}`);
      console.log(
        `(waiting ${delay / 1000} seconds - switch browser window if needed...)\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return true;
    };

    // Callback for delay with visible console output
    const onDelay = async (ms: number, bucket: string): Promise<void> => {
      // Show visible console output for user
      console.log(`(waiting ${ms / 1000} seconds before opening browser...)\n`);

      logger.debug(`Waiting ${ms}ms before authenticating bucket: ${bucket}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
    };

    const authenticator = MultiBucketAuthenticator.fromCallbacks({
      onAuthBucket,
      onPrompt,
      onDelay,
      getEphemeralSetting,
    });

    // Issue 913: Use unauthenticatedBuckets for the actual auth flow
    const result = await authenticator.authenticateMultipleBuckets({
      provider: providerName,
      buckets: unauthenticatedBuckets,
    });

    if (result.cancelled) {
      throw new Error(
        `Multi-bucket authentication cancelled after ${result.authenticatedBuckets.length} of ${unauthenticatedBuckets.length} buckets`,
      );
    }

    if (result.failedBuckets.length > 0) {
      throw new Error(
        `Failed to authenticate ${result.failedBuckets.length} bucket(s): ${result.failedBuckets.join(', ')}`,
      );
    }

    logger.debug(
      `Successfully authenticated ${result.authenticatedBuckets.length} buckets for ${providerName}`,
    );

    // Set up bucket failover handler if we have multiple buckets and config is available
    // @plan PLAN-20251213issue490
    if (buckets.length > 1) {
      const config = this.getConfig?.();
      if (config) {
        const handler = new BucketFailoverHandlerImpl(
          buckets,
          providerName,
          this,
        );
        config.setBucketFailoverHandler(handler);
        logger.debug('Bucket failover handler configured', {
          provider: providerName,
          bucketCount: buckets.length,
        });
      } else {
        logger.debug(
          'Config not available, bucket failover handler not configured',
        );
      }
    }
  }
}
