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
 *        the provider's own logout() handles provider-specific cleanup.
 *   G3 – cache invalidation is supplied by the owning runtime.
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { AuthStatus, TokenStore } from './types.js';
import type { ProviderRegistry } from './provider-registry.js';
import type { ProactiveRenewalManager } from './proactive-renewal-manager.js';
import type { OAuthBucketManager } from './OAuthBucketManager.js';
import type { TokenAccessCoordinator } from './token-access-coordinator.js';

const logger = new DebugLogger('llxprt:oauth:status');

export class AuthStatusService {
  constructor(
    private readonly tokenStore: TokenStore,
    private readonly providerRegistry: ProviderRegistry,
    private readonly proactiveRenewalManager: ProactiveRenewalManager,
    private readonly bucketManager: OAuthBucketManager,
    private readonly tokenAccessCoordinator: TokenAccessCoordinator,
    private readonly invalidateAuthCaches?: (providerName: string) => void,
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

        const metadata =
          await this.tokenAccessCoordinator.getCurrentProfileSessionMetadata(
            providerName,
          );
        const bucket =
          await this.tokenAccessCoordinator.getCurrentProfileSessionBucket(
            providerName,
            metadata,
          );
        const token = await this.tokenStore.getToken(providerName, bucket);

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

    const metadata = bucket
      ? undefined
      : await this.tokenAccessCoordinator.getCurrentProfileSessionMetadata(
          providerName,
        );
    const effectiveBucket =
      bucket ??
      (await this.tokenAccessCoordinator.getCurrentProfileSessionBucket(
        providerName,
        metadata,
      ));
    const token = await this.tokenStore.getToken(providerName, effectiveBucket);
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

  async clearProviderAuthCaches(providerName: string): Promise<void> {
    this.invalidateAuthCaches?.(providerName);
  }
}
