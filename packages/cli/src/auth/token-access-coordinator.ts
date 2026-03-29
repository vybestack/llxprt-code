/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TokenAccessCoordinator – Phase 5 extraction from OAuthManager.
 *
 * Owns token retrieval, TOCTOU locking, refresh coordination, and
 * profile-aware bucket resolution. Authentication flows are triggered
 * via the injected AuthenticatorInterface to avoid a circular import cycle.
 */

import {
  DebugLogger,
  type Config,
  type OAuthTokenRequestMetadata,
} from '@vybestack/llxprt-code-core';
import type {
  OAuthToken,
  TokenStore,
  AuthenticatorInterface,
  BucketFailoverOAuthManagerLike,
} from './types.js';
import { ensureFailoverHandler } from './token-bucket-failover-helper.js';
import {
  handleRefreshLockMiss,
  executeTokenRefresh,
  performDiskCheckUnderLock,
} from './token-refresh-helper.js';
import {
  resolveProfileBuckets,
  resolveCurrentProfileSessionMetadata,
} from './token-profile-resolver.js';
import type { ProviderRegistry } from './provider-registry.js';
import type { ProactiveRenewalManager } from './proactive-renewal-manager.js';
import type { OAuthBucketManager } from './OAuthBucketManager.js';
import type { LoadedSettings } from '../config/settings.js';

const logger = new DebugLogger('llxprt:oauth:token');

/**
 * Coordinates token retrieval for all registered OAuth providers.
 *
 * Responsibilities:
 * - getToken / getOAuthToken / peekStoredToken
 * - Bucket resolution lock (withBucketResolutionLock)
 * - Profile-aware bucket/session resolution
 * - TOCTOU double-check pattern around refresh
 * - Delegates auth flows to injected AuthenticatorInterface
 */
export class TokenAccessCoordinator {
  private bucketResolutionLocks: Map<string, Promise<void>> = new Map();
  private authenticator?: AuthenticatorInterface;

  /**
   * Optional override for getProfileBuckets resolution.
   * Set by OAuthManager so that test spies on manager.getProfileBuckets
   * correctly intercept all internal calls made by this coordinator.
   */
  private _getProfileBucketsDelegate?: (
    providerName: string,
    metadata?: OAuthTokenRequestMetadata,
  ) => Promise<string[]>;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly providerRegistry: ProviderRegistry,
    private readonly proactiveRenewalManager: ProactiveRenewalManager,
    private readonly bucketManager: OAuthBucketManager,
    private readonly facadeRef: BucketFailoverOAuthManagerLike,
    private readonly settings?: LoadedSettings,
    /**
     * Config accessor function rather than a snapshot so that callers
     * (e.g., tests that mutate manager.config after construction) always
     * see the current Config instance.
     */
    private readonly getConfigFn: () => Config | undefined = () => undefined,
  ) {}

  // --------------------------------------------------------------------------
  // Authenticator injection (set after construction to avoid cycles)
  // --------------------------------------------------------------------------

  setAuthenticator(auth: AuthenticatorInterface): void {
    this.authenticator = auth;
  }

  private requireAuthenticator(): AuthenticatorInterface {
    if (!this.authenticator) {
      throw new Error(
        'TokenAccessCoordinator: authenticator not wired — call setAuthenticator() first',
      );
    }
    return this.authenticator;
  }

  /**
   * Register an optional delegate for getProfileBuckets resolution.
   * When set, the coordinator calls this instead of its own implementation.
   * Used by OAuthManager so that test spies on the facade method intercept
   * internal bucket-resolution calls made by this coordinator.
   */
  setGetProfileBucketsDelegate(
    fn: (
      providerName: string,
      metadata?: OAuthTokenRequestMetadata,
    ) => Promise<string[]>,
  ): void {
    this._getProfileBucketsDelegate = fn;
  }

  // --------------------------------------------------------------------------
  // Bucket resolution lock — serialises concurrent getOAuthToken calls
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // peekStoredToken
  // --------------------------------------------------------------------------

  /**
   * Retrieve the stored OAuth token without refreshing it.
   * Throws if the provider name is invalid or unknown.
   * Returns null if no token exists or the token store read fails.
   */
  async peekStoredToken(providerName: string): Promise<OAuthToken | null> {
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    if (!this.providerRegistry.getProvider(providerName)) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    try {
      return await this.tokenStore.getToken(providerName);
    } catch (error) {
      logger.debug(`Failed to load stored token for ${providerName}:`, error);
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // getOAuthToken — full token retrieval with refresh and TOCTOU lock
  // --------------------------------------------------------------------------

  /**
   * Get OAuth token object for a specific provider.
   * @param providerName - Name of the provider
   * @param bucket - Optional bucket name (string) or OAuthTokenRequestMetadata object
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

    if (!this.providerRegistry.getProvider(providerName)) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    const explicitBucket = typeof bucket === 'string';
    const requestMetadata =
      !explicitBucket && bucket && typeof bucket === 'object'
        ? (bucket as OAuthTokenRequestMetadata)
        : undefined;

    const bucketToUse = explicitBucket
      ? bucket
      : await this.resolveImplicitBucket(providerName, requestMetadata);

    try {
      return await this.readAndValidateToken(providerName, bucketToUse);
    } catch (error) {
      logger.debug(
        () =>
          `[FLOW] getOAuthToken() ERROR for ${providerName}: ${error instanceof Error ? error.message : error}`,
      );
      if (
        error instanceof Error &&
        error.message.includes('Unknown provider')
      ) {
        throw error;
      }
      return null;
    }
  }

  /**
   * Read a token from the store and either return it (if valid), refresh it
   * (if expired), or return null (if absent).
   */
  private async readAndValidateToken(
    providerName: string,
    bucketToUse: string | undefined,
  ): Promise<OAuthToken | null> {
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

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const thirtySecondsFromNow = nowInSeconds + 30;
    logger.debug(
      () =>
        `[FLOW] Token expiry check: now=${nowInSeconds}, expiry=${token.expiry}, isExpired=${token.expiry <= thirtySecondsFromNow}`,
    );

    if (token.expiry <= thirtySecondsFromNow) {
      return this.refreshExpiredToken(
        providerName,
        bucketToUse,
        token,
        thirtySecondsFromNow,
      );
    }

    logger.debug(() => `[FLOW] Returning valid token for ${providerName}`);
    this.proactiveRenewalManager.scheduleProactiveRenewal(
      providerName,
      bucketToUse,
      token,
    );
    return token;
  }

  /**
   * Resolve the bucket to use when no explicit bucket string is provided.
   * Runs inside a bucket-resolution lock to serialise concurrent lookups.
   */
  private async resolveImplicitBucket(
    providerName: string,
    requestMetadata: OAuthTokenRequestMetadata | undefined,
  ): Promise<string | undefined> {
    let bucketToUse: string | undefined;
    await this.withBucketResolutionLock(providerName, async () => {
      bucketToUse = await this.resolveBucketWithFailover(
        providerName,
        requestMetadata,
      );
    });
    return bucketToUse;
  }

  /**
   * Inner bucket resolution — must be called inside withBucketResolutionLock.
   * Reads the session bucket, builds/reuses the failover handler, and returns
   * the resolved bucket string (or undefined).
   */
  private async resolveBucketWithFailover(
    providerName: string,
    requestMetadata: OAuthTokenRequestMetadata | undefined,
  ): Promise<string | undefined> {
    let bucketToUse: string | undefined;

    const sessionBucket = this.facadeRef.getSessionBucket(
      providerName,
      requestMetadata,
    );
    if (sessionBucket) {
      bucketToUse = sessionBucket;
    }

    const profileBuckets = await this.getProfileBuckets(
      providerName,
      requestMetadata,
    );

    const config = this.getConfigFn();
    logger.debug(
      () =>
        `[issue1029] getOAuthToken: provider=${providerName}, buckets=${JSON.stringify(profileBuckets)}, hasConfig=${!!config}`,
    );

    const failoverHandler = ensureFailoverHandler(
      providerName,
      profileBuckets,
      requestMetadata,
      config,
      this.bucketManager,
      this.facadeRef,
    );

    if (!bucketToUse) {
      const handlerBucket = failoverHandler?.getCurrentBucket?.();
      if (typeof handlerBucket === 'string' && handlerBucket.trim() !== '') {
        bucketToUse = handlerBucket;
      } else if (profileBuckets.length > 0) {
        bucketToUse = profileBuckets[0];
      }

      if (!sessionBucket && bucketToUse) {
        this.facadeRef.setSessionBucket(
          providerName,
          bucketToUse,
          requestMetadata,
        );
      }
    }

    return bucketToUse;
  }

  /**
   * Handle token refresh when token is expired or expiring soon.
   * Acquires refresh lock with TOCTOU double-check.
   * Lock parameters: waitMs:10000, staleMs:30000 (hot path, not on user-facing single-bucket flow).
   */
  private async refreshExpiredToken(
    providerName: string,
    bucketToUse: string | undefined,
    token: OAuthToken,
    thirtySecondsFromNow: number,
  ): Promise<OAuthToken | null> {
    logger.debug(
      () =>
        `[FLOW] Token expired or expiring soon for ${providerName}, attempting refresh with lock...`,
    );

    const lockAcquired = await this.tokenStore.acquireRefreshLock(
      providerName,
      { waitMs: 10000, staleMs: 30000, bucket: bucketToUse },
    );

    if (!lockAcquired) {
      return handleRefreshLockMiss(
        providerName,
        bucketToUse,
        thirtySecondsFromNow,
        this.tokenStore,
        this.proactiveRenewalManager,
      );
    }

    try {
      return await executeTokenRefresh(
        providerName,
        bucketToUse,
        token,
        thirtySecondsFromNow,
        this.tokenStore,
        this.providerRegistry,
        this.proactiveRenewalManager,
      );
    } finally {
      await this.tokenStore.releaseRefreshLock(providerName, bucketToUse);
    }
  }

  // --------------------------------------------------------------------------
  // getToken — main public entry point used by consumers
  // --------------------------------------------------------------------------

  /**
   * Get access token string for a specific provider.
   * Triggers OAuth flows when necessary (via injected authenticator).
   */
  async getToken(
    providerName: string,
    bucket?: string | unknown,
  ): Promise<string | null> {
    logger.debug(
      () => `[FLOW] getToken() called for provider: ${providerName}`,
    );

    if (!this.providerRegistry.getProvider(providerName)) {
      logger.debug(
        () => `[FLOW] Unknown provider for getToken(): ${providerName}`,
      );
      return null;
    }

    const hasExplicitInMemoryOAuthState =
      this.providerRegistry.hasExplicitInMemoryOAuthState(providerName);

    if (
      this.isOAuthDisabledForProvider(
        providerName,
        hasExplicitInMemoryOAuthState,
      )
    ) {
      return null;
    }

    logger.debug(
      () => `[FLOW] Attempting to get existing token for ${providerName}...`,
    );
    const explicitBucket = typeof bucket === 'string';
    const requestMetadata =
      !explicitBucket && bucket && typeof bucket === 'object'
        ? (bucket as OAuthTokenRequestMetadata)
        : undefined;

    const token = await this.getOAuthToken(providerName, bucket);

    if (token) {
      logger.debug(
        () =>
          `[FLOW] Returning existing token for ${providerName} (expiry=${token.expiry})`,
      );
      return token.access_token;
    }

    // @fix issue1616: Peek other profile buckets before triggering full re-auth.
    // Only for implicit (session-resolved) requests — explicit bucket requests
    // must stay pinned to the requested bucket.
    if (!explicitBucket) {
      const peekResult = await this.peekOtherProfileBuckets(
        providerName,
        requestMetadata,
      );
      if (peekResult !== null) {
        return peekResult;
      }
    }

    // Check if we should require OAuth to be enabled for new auth
    const shouldRequireOAuthEnabled =
      this.settings !== undefined || hasExplicitInMemoryOAuthState;
    if (
      shouldRequireOAuthEnabled &&
      !this.providerRegistry.isOAuthEnabled(providerName)
    ) {
      logger.debug(
        () =>
          `[FLOW] OAuth is NOT enabled for ${providerName}, cannot trigger new auth`,
      );
      return null;
    }

    return this.getTokenTriggerAuthIfNeeded(
      providerName,
      bucket,
      explicitBucket,
      requestMetadata,
    );
  }

  /**
   * Returns true if OAuth is currently disabled for a provider,
   * based on settings or explicit in-memory state.
   */
  private isOAuthDisabledForProvider(
    providerName: string,
    hasExplicitInMemoryOAuthState: boolean,
  ): boolean {
    // Respect explicit user settings when available.
    if (this.settings && !this.providerRegistry.isOAuthEnabled(providerName)) {
      logger.debug(
        () =>
          `[FLOW] OAuth is disabled by settings for ${providerName}, returning null`,
      );
      return true;
    }

    // In runtimes without LoadedSettings, only block when explicit in-memory state says disabled.
    if (
      !this.settings &&
      hasExplicitInMemoryOAuthState &&
      !this.providerRegistry.isOAuthEnabled(providerName)
    ) {
      logger.debug(
        () =>
          `[FLOW] OAuth is disabled in-memory for ${providerName}, returning null`,
      );
      return true;
    }

    return false;
  }

  /**
   * After all fast-path checks, resolve bucket parameters and either perform
   * a disk-check or trigger a full auth flow.
   */
  private async getTokenTriggerAuthIfNeeded(
    providerName: string,
    bucket: string | unknown,
    explicitBucket: boolean,
    requestMetadata: OAuthTokenRequestMetadata | undefined,
  ): Promise<string | null> {
    logger.debug(
      () =>
        `[FLOW] No existing token for ${providerName}, triggering OAuth flow...`,
    );

    const resolvedProfileBuckets = await this.getProfileBuckets(
      providerName,
      requestMetadata,
    );
    const scopedSessionBucket = explicitBucket
      ? undefined
      : this.facadeRef.getSessionBucket(providerName, requestMetadata);
    const bucketToCheck = explicitBucket
      ? (bucket as string)
      : (scopedSessionBucket ??
        (resolvedProfileBuckets.length === 1
          ? resolvedProfileBuckets[0]
          : undefined));

    // @fix issue1262 & issue1195: Before triggering OAuth, check disk with lock
    const diskCheckResult = await this.performDiskCheck(
      providerName,
      bucketToCheck,
    );
    if (diskCheckResult !== undefined) {
      return diskCheckResult;
    }

    // @fix issue1616: For multi-bucket profiles, getToken() is a pure lookup.
    if (resolvedProfileBuckets.length > 1) {
      return null;
    }

    // Single-bucket or no-bucket: trigger auth
    return this.triggerAuthFlow(
      providerName,
      bucketToCheck,
      requestMetadata,
      explicitBucket,
    );
  }

  /**
   * Peek other profile buckets for a valid token (issue1616 path).
   * Returns access_token string if found, null if none found.
   */
  private async peekOtherProfileBuckets(
    providerName: string,
    requestMetadata: OAuthTokenRequestMetadata | undefined,
  ): Promise<string | null> {
    const profileBuckets = await this.getProfileBuckets(
      providerName,
      requestMetadata,
    );
    if (profileBuckets.length <= 1) {
      return null;
    }

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const thirtySecondsFromNow = nowInSeconds + 30;
    const alreadyTriedBucket = this.facadeRef.getSessionBucket(
      providerName,
      requestMetadata,
    );

    for (const peekBucket of profileBuckets) {
      if (peekBucket === alreadyTriedBucket) continue;
      try {
        const peekToken = await this.tokenStore.getToken(
          providerName,
          peekBucket,
        );
        if (peekToken && peekToken.expiry > thirtySecondsFromNow) {
          logger.debug(
            () =>
              `[issue1616] Found valid token in bucket '${peekBucket}' for ${providerName}, switching session`,
          );
          this.facadeRef.setSessionBucket(
            providerName,
            peekBucket,
            requestMetadata,
          );
          this.proactiveRenewalManager.scheduleProactiveRenewal(
            providerName,
            peekBucket,
            peekToken,
          );
          return peekToken.access_token;
        }
      } catch (peekError) {
        logger.debug(
          `[issue1616] Token peek failed for ${providerName}/${peekBucket}:`,
          peekError,
        );
      }
    }
    logger.debug(
      () =>
        `[issue1616] No valid token found in any bucket for ${providerName}, falling through to OAuth`,
    );
    return null;
  }

  /**
   * Disk-check with refresh lock before triggering OAuth (issue1262/1195/1317).
   * Returns:
   *  - string  → valid token found, return it
   *  - null    → no valid token and refresh attempted/failed, caller should NOT trigger auth
   *  - undefined → lock missed or no useful disk token; caller continues to auth
   */
  private async performDiskCheck(
    providerName: string,
    bucketToCheck: string | undefined,
  ): Promise<string | null | undefined> {
    const lockAcquired = await this.tokenStore.acquireRefreshLock(
      providerName,
      { waitMs: 5000, staleMs: 30000, bucket: bucketToCheck },
    );

    if (lockAcquired) {
      try {
        return await performDiskCheckUnderLock(
          providerName,
          bucketToCheck,
          this.tokenStore,
          this.providerRegistry,
        );
      } finally {
        await this.tokenStore.releaseRefreshLock(providerName, bucketToCheck);
      }
    }

    // Couldn't acquire lock — check disk anyway (best-effort, treat failures as cache miss)
    let diskToken: OAuthToken | null = null;
    try {
      diskToken = await this.tokenStore.getToken(providerName, bucketToCheck);
    } catch (error) {
      logger.debug(
        `[issue1262/1195] Disk fallback read failed for ${providerName}:`,
        error,
      );
      return undefined;
    }
    const thirtySecondsFromNow = Math.floor(Date.now() / 1000) + 30;
    if (diskToken && diskToken.expiry > thirtySecondsFromNow) {
      logger.debug(
        () =>
          `[issue1262/1195] Found valid token on disk after lock timeout for ${providerName}`,
      );
      this.proactiveRenewalManager.scheduleProactiveRenewal(
        providerName,
        bucketToCheck,
        diskToken,
      );
      return diskToken.access_token;
    }

    return undefined; // continue to auth
  }

  private async triggerAuthFlow(
    providerName: string,
    bucketToCheck: string | undefined,
    requestMetadata: OAuthTokenRequestMetadata | undefined,
    explicitBucket: boolean,
  ): Promise<string | null> {
    let showPrompt = false;
    try {
      const { getEphemeralSetting: getRuntimeEphemeralSetting } = await import(
        '../runtime/runtimeSettings.js'
      );
      showPrompt =
        (getRuntimeEphemeralSetting('auth-bucket-prompt') as boolean) ?? false;
    } catch (runtimeError) {
      logger.debug(
        'Could not get ephemeral setting (runtime not initialized), using default',
        runtimeError,
      );
    }

    // Use requireAuthenticator to validate the authenticator is wired, but
    // route all calls through facadeRef so that spies on manager.authenticate
    // intercept them (preserving the pre-refactor behaviour).
    this.requireAuthenticator();

    if (showPrompt) {
      const effectiveBuckets = bucketToCheck ? [bucketToCheck] : ['default'];
      logger.debug(
        `Single-bucket auth with prompt mode for ${providerName}, bucket: ${effectiveBuckets[0]}`,
      );
      await this.facadeRef.authenticateMultipleBuckets(
        providerName,
        effectiveBuckets,
        requestMetadata,
      );
      const authenticatedBucket = effectiveBuckets[0];
      if (authenticatedBucket) {
        this.facadeRef.setSessionBucket(
          providerName,
          authenticatedBucket,
          requestMetadata,
        );
      }
    } else {
      const authenticatedBucket = bucketToCheck ?? 'default';
      await this.facadeRef.authenticate(providerName, authenticatedBucket);
      if (authenticatedBucket) {
        this.facadeRef.setSessionBucket(
          providerName,
          authenticatedBucket,
          requestMetadata,
        );
      }
    }

    const newToken = await this.getOAuthToken(
      providerName,
      explicitBucket ? bucketToCheck : requestMetadata,
    );
    return newToken ? newToken.access_token : null;
  }

  // --------------------------------------------------------------------------
  // Profile resolution helpers
  // --------------------------------------------------------------------------

  async getCurrentProfileSessionMetadata(
    providerName: string,
  ): Promise<OAuthTokenRequestMetadata | undefined> {
    return resolveCurrentProfileSessionMetadata(providerName);
  }

  async getCurrentProfileSessionBucket(
    provider: string,
    metadata?: OAuthTokenRequestMetadata,
  ): Promise<string | undefined> {
    const scopedSessionBucket = this.facadeRef.getSessionBucket(
      provider,
      metadata,
    );
    if (scopedSessionBucket) {
      return scopedSessionBucket;
    }

    const profileBuckets = await this.getProfileBuckets(provider, metadata);
    if (profileBuckets.length === 1) {
      return profileBuckets[0];
    }

    const unscopedSessionBucket = this.facadeRef.getSessionBucket(provider);
    if (
      unscopedSessionBucket &&
      (profileBuckets.length === 0 ||
        profileBuckets.includes(unscopedSessionBucket))
    ) {
      return unscopedSessionBucket;
    }

    return undefined;
  }

  async getProfileBuckets(
    providerName: string,
    metadata?: OAuthTokenRequestMetadata,
  ): Promise<string[]> {
    if (this._getProfileBucketsDelegate) {
      return this._getProfileBucketsDelegate(providerName, metadata);
    }
    return this.doGetProfileBuckets(providerName, metadata);
  }

  async doGetProfileBuckets(
    providerName: string,
    metadata?: OAuthTokenRequestMetadata,
  ): Promise<string[]> {
    return resolveProfileBuckets(providerName, metadata);
  }
}
