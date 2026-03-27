/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AuthStatusService – Phase 7 extraction from OAuthManager.
 *
 * Owns authentication status checking, logout, and provider auth cache
 * invalidation. Delegates proactive-renewal cleanup to ProactiveRenewalManager.
 *
 * Gemini regularization:
 *   G1 – isAuthenticated uses optional provider.isAuthenticated() override when
 *        OAuth is enabled; falls back to token-store validity check.
 *   G2 – logout no longer performs manager-layer Gemini filesystem cleanup;
 *        GeminiOAuthProvider.logout() already handles that.
 *   G3 – clearProviderAuthCaches uses generic duck-typed optional calls with
 *        independent try/catch per call (no provider-name branching).
 */

import {
  DebugLogger,
  flushRuntimeAuthScope,
} from '@vybestack/llxprt-code-core';
import type { AuthStatus, TokenStore } from './types.js';
import type { ProviderRegistry } from './provider-registry.js';
import type { ProactiveRenewalManager } from './proactive-renewal-manager.js';
import type { OAuthBucketManager } from './OAuthBucketManager.js';
import type { TokenAccessCoordinator } from './token-access-coordinator.js';
import { unwrapLoggingProvider } from './auth-utils.js';

const logger = new DebugLogger('llxprt:oauth:status');

export class AuthStatusService {
  constructor(
    private readonly tokenStore: TokenStore,
    private readonly providerRegistry: ProviderRegistry,
    private readonly proactiveRenewalManager: ProactiveRenewalManager,
    private readonly bucketManager: OAuthBucketManager,
    private readonly tokenAccessCoordinator: TokenAccessCoordinator,
  ) {}

  // --------------------------------------------------------------------------
  // getAuthStatus
  // --------------------------------------------------------------------------

  /**
   * Get authentication status for all registered providers.
   */
  async getAuthStatus(): Promise<AuthStatus[]> {
    const statuses: AuthStatus[] = [];
    const providerNames = this.providerRegistry.getSupportedProviders();

    for (const providerName of providerNames) {
      try {
        const oauthEnabled = this.providerRegistry.isOAuthEnabled(providerName);

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
          const now = Date.now() / 1000;
          const expiresIn = Math.max(0, Math.floor(token.expiry - now));
          const authenticated = token.expiry > now;
          statuses.push({
            provider: providerName,
            authenticated,
            expiresIn,
            oauthEnabled,
          });
        } else {
          statuses.push({
            provider: providerName,
            authenticated: false,
            oauthEnabled,
          });
        }
      } catch {
        const oauthEnabled = this.providerRegistry.isOAuthEnabled(providerName);
        statuses.push({
          provider: providerName,
          authenticated: false,
          oauthEnabled,
        });
      }
    }

    return statuses;
  }

  // --------------------------------------------------------------------------
  // isAuthenticated  (G1: generic provider override)
  // --------------------------------------------------------------------------

  /**
   * Check if authenticated with a specific provider.
   *
   * When OAuth is enabled and the provider implements the optional
   * `isAuthenticated()` method, that override is consulted first.
   * If the override throws or returns false we fall back to the standard
   * token-store + expiry check so callers always get a usable answer.
   *
   * When OAuth is disabled, the override is never consulted.
   */
  async isAuthenticated(
    providerName: string,
    bucket?: string,
  ): Promise<boolean> {
    if (!providerName || typeof providerName !== 'string') {
      return false;
    }

    const oauthEnabled = this.providerRegistry.isOAuthEnabled(providerName);

    if (!oauthEnabled) {
      return false;
    }

    // G1: consult provider override only when OAuth is enabled
    const provider = this.providerRegistry.getProvider(providerName);
    if (provider?.isAuthenticated) {
      try {
        const overrideResult = await provider.isAuthenticated();
        if (overrideResult) {
          return true;
        }
        // Override returned false → fall through to token-store check
      } catch (err) {
        logger.debug(
          `provider.isAuthenticated() threw for ${providerName}, falling back to token store:`,
          err,
        );
        // Fall through to token-store check
      }
    }

    const token = await this.tokenStore.getToken(providerName, bucket);
    if (!token) return false;

    const now = Date.now() / 1000;
    return token.expiry > now;
  }

  // --------------------------------------------------------------------------
  // logout  (G2: no manager-layer Gemini filesystem cleanup)
  // --------------------------------------------------------------------------

  /**
   * Logout from a specific provider by clearing stored tokens.
   *
   * Provider.logout() is called best-effort for remote revocation.
   * The manager never performs provider-specific filesystem operations —
   * those are the provider's responsibility (G2).
   *
   * After removing the token, proactive renewal timers for the bucket are
   * cancelled (behavioral improvement over the original).
   */
  async logout(providerName: string, bucket?: string): Promise<void> {
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    const provider = this.providerRegistry.getProvider(providerName);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    const sessionMetadata =
      await this.tokenAccessCoordinator.getCurrentProfileSessionMetadata(
        providerName,
      );

    const bucketToUse =
      bucket ??
      (await this.tokenAccessCoordinator.getCurrentProfileSessionBucket(
        providerName,
        sessionMetadata,
      )) ??
      'default';

    const tokenForLogout = await this.tokenStore.getToken(
      providerName,
      bucketToUse,
    );

    // Best-effort provider-side revoke
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

    // Clear in-memory session bucket if it matches the logged-out bucket
    const currentSessionBucket =
      await this.tokenAccessCoordinator.getCurrentProfileSessionBucket(
        providerName,
        sessionMetadata,
      );
    if (currentSessionBucket === bucketToUse) {
      if (
        this.bucketManager.getSessionBucket(providerName, sessionMetadata) ===
        bucketToUse
      ) {
        this.bucketManager.clearSessionBucket(providerName, sessionMetadata);
      }
      if (this.bucketManager.getSessionBucket(providerName) === bucketToUse) {
        this.bucketManager.clearSessionBucket(providerName);
      }
    }

    // Cancel proactive renewal timers for this provider/bucket
    this.proactiveRenewalManager.clearRenewalsForProvider(
      providerName,
      bucketToUse,
    );

    // Invalidate all in-memory auth caches (best-effort)
    await this.clearProviderAuthCaches(providerName);
  }

  // --------------------------------------------------------------------------
  // logoutAll / logoutAllBuckets
  // --------------------------------------------------------------------------

  /** Logout from all known providers. */
  async logoutAll(): Promise<void> {
    const providers = await this.tokenStore.listProviders();
    for (const provider of providers) {
      try {
        await this.logoutAllBuckets(provider);
      } catch (error) {
        logger.warn(`Failed to logout from ${provider}: ${error}`);
      }
    }
  }

  /** Logout from all buckets for a single provider. */
  async logoutAllBuckets(provider: string): Promise<void> {
    const buckets = await this.tokenStore.listBuckets(provider);
    for (const bucket of buckets) {
      try {
        await this.logout(provider, bucket);
      } catch (error) {
        logger.warn(`Failed to logout from bucket ${bucket}: ${error}`);
      }
    }
    this.bucketManager.clearAllSessionBuckets(provider);
  }

  // --------------------------------------------------------------------------
  // listBuckets / getAuthStatusWithBuckets
  // --------------------------------------------------------------------------

  /** List all buckets for a provider. */
  async listBuckets(provider: string): Promise<string[]> {
    return this.tokenStore.listBuckets(provider);
  }

  /** Get per-bucket authentication status for a provider. */
  async getAuthStatusWithBuckets(provider: string): Promise<
    Array<{
      bucket: string;
      authenticated: boolean;
      expiry?: number;
      isSessionBucket: boolean;
    }>
  > {
    const buckets = await this.tokenStore.listBuckets(provider);
    const sessionMetadata =
      await this.tokenAccessCoordinator.getCurrentProfileSessionMetadata(
        provider,
      );
    const sessionBucket =
      await this.tokenAccessCoordinator.getCurrentProfileSessionBucket(
        provider,
        sessionMetadata,
      );

    const statuses: Array<{
      bucket: string;
      authenticated: boolean;
      expiry?: number;
      isSessionBucket: boolean;
    }> = [];

    const now = Date.now() / 1000;

    for (const bucket of buckets) {
      const token = await this.tokenStore.getToken(provider, bucket);
      const isSessionBucket = bucket === sessionBucket;

      if (token) {
        const authenticated = token.expiry > now;
        statuses.push({
          bucket,
          authenticated,
          expiry: token.expiry,
          isSessionBucket,
        });
      } else {
        statuses.push({ bucket, authenticated: false, isSessionBucket });
      }
    }

    return statuses;
  }

  // --------------------------------------------------------------------------
  // clearProviderAuthCaches  (G3: no provider-name branching)
  // --------------------------------------------------------------------------

  /**
   * Clear all auth caches for a provider after logout.
   *
   * Operates on the core BaseProvider instance resolved via the runtime
   * provider manager. Uses duck-typed optional calls with an independent
   * try/catch per call so one failure does not skip the next (G3).
   *
   * The runtime scope flush always executes in a finally block (G4/E).
   *
   * This method is non-throwing on provider-resolution/dynamic-import
   * failures (E).
   */
  async clearProviderAuthCaches(providerName: string): Promise<void> {
    let providerManager:
      | { getProviderByName: (name: string) => unknown }
      | undefined;
    let runtimeContext: { runtimeId?: string } | undefined;

    try {
      const { getCliProviderManager, getCliRuntimeContext } = await import(
        '../runtime/runtimeSettings.js'
      );
      providerManager = getCliProviderManager();

      try {
        runtimeContext = getCliRuntimeContext();
      } catch (rctxErr) {
        logger.debug(
          `Could not get CLI runtime context for ${providerName}:`,
          rctxErr,
        );
      }
    } catch (importErr) {
      logger.debug(
        `Failed to import runtimeSettings for ${providerName} cache clear:`,
        importErr,
      );
      // Still attempt scope flush below
    }

    if (providerManager) {
      const rawProvider = providerManager.getProviderByName(providerName);
      const provider = unwrapLoggingProvider(
        rawProvider as { name: string } | undefined,
      );

      if (!provider) {
        logger.debug(
          `Provider ${providerName} not found in runtime manager; skipping cache clear.`,
        );
      } else {
        this.clearCoreProviderCaches(providerName, provider);
      }
    }

    this.flushKnownRuntimeScopes(providerName, runtimeContext);
    logger.debug(`Cleared auth caches for provider: ${providerName}`);
  }

  /**
   * Duck-typed independent cache clearing for a resolved core provider instance.
   * G3: each method call is wrapped in its own try/catch so one failure does
   * not prevent the remaining cleanup steps from executing.
   */
  private clearCoreProviderCaches(
    providerName: string,
    provider: { name: string },
  ): void {
    const p = provider as Record<string, unknown>;

    if (
      'clearAuthCache' in provider &&
      typeof p['clearAuthCache'] === 'function'
    ) {
      try {
        (provider as { clearAuthCache: () => void }).clearAuthCache();
      } catch (e) {
        logger.debug(`clearAuthCache failed for ${providerName}:`, e);
      }
    }

    if ('clearAuth' in provider && typeof p['clearAuth'] === 'function') {
      try {
        (provider as { clearAuth: () => void }).clearAuth();
      } catch (e) {
        logger.debug(`clearAuth failed for ${providerName}:`, e);
      }
    }

    if ('clearState' in provider && typeof p['clearState'] === 'function') {
      try {
        (provider as { clearState: () => void }).clearState();
      } catch (e) {
        logger.debug(`clearState failed for ${providerName}:`, e);
      }
    }
  }

  /**
   * Flush all known runtime auth scopes. Always executes regardless of
   * prior cleanup failures (G4/E pattern).
   */
  private flushKnownRuntimeScopes(
    providerName: string,
    runtimeContext: { runtimeId?: string } | undefined,
  ): void {
    const knownRuntimeIds = ['legacy-singleton', 'provider-manager-singleton'];
    if (runtimeContext && typeof runtimeContext.runtimeId === 'string') {
      if (!knownRuntimeIds.includes(runtimeContext.runtimeId)) {
        knownRuntimeIds.push(runtimeContext.runtimeId);
      }
    }

    for (const runtimeId of knownRuntimeIds) {
      try {
        flushRuntimeAuthScope(runtimeId);
        logger.debug(`Flushed runtime auth scope: ${runtimeId}`);
      } catch (flushError) {
        logger.debug(`Skipped flush for runtime ${runtimeId}:`, flushError);
      }
    }
  }
}
