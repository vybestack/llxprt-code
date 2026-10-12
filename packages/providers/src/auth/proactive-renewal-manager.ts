/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ProactiveRenewalManager handles scheduling and executing proactive token
 * renewals. It owns all timer state, backoff logic, and profile-based
 * scheduling configuration.
 */

import { type OAuthTokenWithExtras } from '@vybestack/llxprt-code-auth';
import { mergeRefreshedToken } from '@vybestack/llxprt-code-auth/token-merge.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { OAuthToken, TokenStore, OAuthProvider } from './types.js';
import {
  isLoadBalancerProfileLike,
  getOAuthBucketsFromProfile,
} from './profile-utils.js';

const logger = new DebugLogger('llxprt:oauth:renewal');

/** Maximum consecutive proactive renewal failures before stopping retries. */
export const MAX_PROACTIVE_RENEWAL_FAILURES = 3;

export class ProactiveRenewalManager {
  private proactiveRenewals: Map<
    string,
    { timer: ReturnType<typeof setTimeout>; expiry: number }
  > = new Map();
  private proactiveRenewalFailures: Map<string, number> = new Map();
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private proactiveRenewalInFlight = new Map<
    string,
    {
      controller: AbortController;
      promise: Promise<void>;
    }
  >();
  private proactiveRenewalTokens: Map<
    string,
    { accessToken: string; refreshToken: string }
  > = new Map();

  constructor(
    private tokenStore: TokenStore,
    private getProvider: (name: string) => OAuthProvider | undefined,
    private isOAuthEnabled: (name: string) => boolean,
    signal?: AbortSignal,
  ) {
    this.signal = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal;
    this.signal.addEventListener('abort', () => this.clearAllTimers(), {
      once: true,
    });
  }

  async cancelAndJoin(): Promise<void> {
    this.controller.abort(new Error('Profile renewal lifetime retired'));
    const results = await Promise.allSettled(
      [...this.proactiveRenewalInFlight.values()].map((entry) => entry.promise),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Profile renewal retirement failed');
  }

  normalizeBucket(bucket?: string): string {
    if (typeof bucket === 'string' && bucket.trim() !== '') {
      return bucket;
    }
    return 'default';
  }

  getProactiveRenewalKey(providerName: string, bucket: string): string {
    return `${providerName}:${bucket}`;
  }

  clearProactiveRenewal(key: string): void {
    const entry = this.proactiveRenewals.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      this.proactiveRenewals.delete(key);
    }
    this.proactiveRenewalFailures.delete(key);
    this.proactiveRenewalInFlight
      .get(key)
      ?.controller.abort(new Error('OAuth renewal superseded'));
    this.proactiveRenewalTokens.delete(key);
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

    // @plan PLAN-20260223-ISSUE1598.P14
    // @requirement REQ-1598-PR05
    // Stop retrying after MAX_PROACTIVE_RENEWAL_FAILURES consecutive failures
    if (failures >= MAX_PROACTIVE_RENEWAL_FAILURES) {
      logger.debug(
        () =>
          `[OAUTH] Stopping proactive renewal after ${failures} failures for ${providerName}:${normalizedBucket}`,
      );
      this.clearProactiveRenewal(key);
      return;
    }

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

  /**
   * @plan:PLAN-20250214-CREDPROXY.P33
   * @requirement R16.8
   * @plan PLAN-20260223-ISSUE1598.P14
   * @requirement REQ-1598-PR01
   * @pseudocode proactive-renewal.md lines 15-49
   */
  scheduleProactiveRenewal(
    providerName: string,
    bucket: string | undefined,
    token: OAuthToken,
  ): void {
    if (this.signal.aborted) return;
    // R16.8: Skip proactive renewal scheduling in proxy mode
    // The host process handles token refresh, not the sandbox
    if (process.env.LLXPRT_CREDENTIAL_SOCKET) {
      return;
    }

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

    // @plan PLAN-20260223-ISSUE1598.P14
    // @requirement REQ-1598-PR01
    // Fix: Don't schedule proactive renewal for expired or short-lived tokens
    // Clear any stale timer so a prior schedule doesn't fire unexpectedly
    if (remainingSec < 300) {
      this.clearProactiveRenewal(key);
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
    this.proactiveRenewalTokens.set(key, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? '',
    });
    this.setProactiveTimer(
      providerName,
      normalizedBucket,
      delayMs,
      token.expiry,
    );
  }

  /**
   * @plan PLAN-20260223-ISSUE1598.P14
   * @requirement REQ-1598-PR02, REQ-1598-PR03, REQ-1598-PR04
   * @pseudocode proactive-renewal.md lines 51-91
   */
  runProactiveRenewal(providerName: string, bucket: string): Promise<void> {
    const normalizedBucket = this.normalizeBucket(bucket);
    const key = this.getProactiveRenewalKey(providerName, normalizedBucket);
    const existing = this.proactiveRenewalInFlight.get(key);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const signal = AbortSignal.any([this.signal, controller.signal]);
    const promise = this.executeProactiveRenewal(
      providerName,
      normalizedBucket,
      key,
      signal,
    )
      .catch((error: unknown) => {
        if (!signal.aborted || error !== signal.reason) throw error;
      })
      .finally(() => {
        if (this.proactiveRenewalInFlight.get(key)?.promise === promise)
          this.proactiveRenewalInFlight.delete(key);
      });
    this.proactiveRenewalInFlight.set(key, { controller, promise });
    return promise;
  }

  private async executeProactiveRenewal(
    providerName: string,
    normalizedBucket: string,
    key: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    if (!this.isOAuthEnabled(providerName)) {
      this.clearProactiveRenewal(key);
      return;
    }
    const provider = this.getProvider(providerName);
    if (!provider) {
      this.scheduleProactiveRetry(providerName, normalizedBucket);
      return;
    }
    await this.acquireAndRefresh(
      providerName,
      normalizedBucket,
      key,
      provider,
      signal,
    );
  }

  /**
   * Acquires the refresh lock and performs the token refresh under lock.
   */
  private async acquireAndRefresh(
    providerName: string,
    normalizedBucket: string,
    key: string,
    provider: OAuthProvider,
    signal: AbortSignal,
  ): Promise<void> {
    // Issue #1159: Acquire lock before refreshing
    const lockAcquired = await this.tokenStore.acquireRefreshLock(
      providerName,
      { waitMs: 10000, bucket: normalizedBucket },
    );

    if (!lockAcquired) {
      // Issue #1781: Before retrying, check if another process already
      // refreshed the token while holding the lock. If the on-disk token
      // differs from the one we scheduled this renewal for, the other
      // process handled it — reschedule based on the new token instead of
      // incrementing the failure counter.
      const diskToken = await this.tokenStore.getToken(
        providerName,
        normalizedBucket,
      );
      signal.throwIfAborted();
      if (diskToken && this.isTokenRefreshed(key, diskToken)) {
        this.proactiveRenewals.delete(key);
        this.scheduleProactiveRenewal(
          providerName,
          normalizedBucket,
          diskToken,
        );
      } else {
        this.scheduleProactiveRetry(providerName, normalizedBucket);
      }
      return;
    }

    try {
      signal.throwIfAborted();
      await this.performTokenRefresh(
        providerName,
        normalizedBucket,
        key,
        provider,
        signal,
      );
    } finally {
      // Always release lock
      await this.tokenStore.releaseRefreshLock(providerName, normalizedBucket);
    }
  }

  /**
   * Performs the double-check and token refresh under the acquired lock.
   */
  private async performTokenRefresh(
    providerName: string,
    normalizedBucket: string,
    key: string,
    provider: OAuthProvider,
    signal: AbortSignal,
  ): Promise<void> {
    // Issue #1159: Double-check pattern - re-read token after acquiring lock
    const currentToken = await this.tokenStore.getToken(
      providerName,
      normalizedBucket,
    );

    signal.throwIfAborted();
    if (!currentToken?.refresh_token) {
      this.clearProactiveRenewal(key);
      return;
    }

    // @plan PLAN-20260223-ISSUE1598.P14
    // @requirement REQ-1598-PR02
    // Check if another process already refreshed the token
    if (this.hasTokenBeenRefreshedExternally(key, currentToken)) {
      // The current timer callback already fired; delete the stale entry
      // so scheduleProactiveRenewal's same-expiry short-circuit doesn't
      // prevent installing a new timer for the externally-refreshed token.
      this.proactiveRenewals.delete(key);
      this.scheduleProactiveRenewal(
        providerName,
        normalizedBucket,
        currentToken,
      );
      return;
    }

    const refreshedToken = await provider.refreshToken(currentToken, signal);
    if (!refreshedToken) {
      signal.throwIfAborted();
      // @plan PLAN-20260223-ISSUE1598.P14
      // @requirement REQ-1598-PR04, REQ-1598-PR05
      this.scheduleProactiveRetry(providerName, normalizedBucket);
      return;
    }

    const mergedToken = mergeRefreshedToken(
      currentToken as OAuthTokenWithExtras,
      refreshedToken as OAuthTokenWithExtras,
    );

    await this.tokenStore.saveToken(
      providerName,
      mergedToken,
      normalizedBucket,
    );
    if (signal.aborted) return;
    // @plan PLAN-20260223-ISSUE1598.P14
    // @requirement REQ-1598-PR03
    this.proactiveRenewalFailures.delete(key);
    this.scheduleProactiveRenewal(providerName, normalizedBucket, mergedToken);
  }

  /**
   * Checks if the token has been refreshed by another process since scheduling.
   */
  private hasTokenBeenRefreshedExternally(
    key: string,
    currentToken: OAuthToken,
  ): boolean {
    const scheduled = this.proactiveRenewalTokens.get(key);
    if (scheduled) {
      return (
        currentToken.access_token !== scheduled.accessToken ||
        (currentToken.refresh_token ?? '') !== scheduled.refreshToken
      );
    }
    // Direct runProactiveRenewal call (no prior schedule) — use expiry-based check
    const nowInSeconds = Math.floor(Date.now() / 1000);
    return currentToken.expiry > nowInSeconds + 30;
  }

  /**
   * Issue #1781: Check whether a disk token differs from the scheduled snapshot
   * or has a valid expiry, indicating another process already refreshed it.
   * Used by acquireAndRefresh when the lock times out.
   */
  private isTokenRefreshed(key: string, diskToken: OAuthToken): boolean {
    return this.hasTokenBeenRefreshedExternally(key, diskToken);
  }

  async configureProactiveRenewalsForProfile(
    profile: unknown,
    loadProfile?: (name: string) => Promise<unknown>,
  ): Promise<void> {
    const commit = await this.prepareProactiveRenewalsForProfile(
      profile,
      loadProfile,
    );
    commit();
  }

  async prepareProactiveRenewalsForProfile(
    profile: unknown,
    loadProfile?: (name: string) => Promise<unknown>,
  ): Promise<() => void> {
    const desiredKeys = new Set<string>();
    const targets: Array<{ providerName: string; bucket: string }> = [];

    const direct = getOAuthBucketsFromProfile(profile);
    if (direct) {
      for (const bucket of direct.buckets) {
        targets.push({ providerName: direct.providerName, bucket });
      }
    }

    if (isLoadBalancerProfileLike(profile)) {
      if (!loadProfile) {
        throw new Error(
          'Load-balancer renewals require the owner profile loader',
        );
      }
      await this.collectLoadBalancerTargets(profile, targets, loadProfile);
    }

    for (const target of targets) {
      const bucket = this.normalizeBucket(target.bucket);
      desiredKeys.add(this.getProactiveRenewalKey(target.providerName, bucket));
    }

    const results = await Promise.allSettled(
      targets.map(async (target) => {
        const bucket = this.normalizeBucket(target.bucket);
        const token = await this.maybeGetTokenForRenewal(
          target.providerName,
          bucket,
        );
        return { providerName: target.providerName, bucket, token };
      }),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Profile renewal preparation failed');
    const renewals = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    return () => {
      for (const existingKey of Array.from(this.proactiveRenewals.keys())) {
        if (!desiredKeys.has(existingKey)) {
          this.clearProactiveRenewal(existingKey);
        }
      }
      for (const { providerName, bucket, token } of renewals) {
        if (token) {
          this.scheduleProactiveRenewal(providerName, bucket, token);
        }
      }
    };
  }

  /**
   * Gets token for proactive renewal if OAuth is enabled and token exists.
   */
  private async maybeGetTokenForRenewal(
    providerName: string,
    bucket: string,
  ): Promise<OAuthToken | null> {
    if (!this.isOAuthEnabled(providerName)) {
      return null;
    }
    const token = await this.tokenStore.getToken(providerName, bucket);
    return token ?? null;
  }

  /**
   * Recursively collects OAuth targets from a load-balancer profile.
   */
  private async collectLoadBalancerTargets(
    profile: { type: 'loadbalancer'; profiles: string[] },
    targets: Array<{ providerName: string; bucket: string }>,
    loadProfile: (name: string) => Promise<unknown>,
  ): Promise<void> {
    const visited = new Set<string>();

    const visit = async (profileName: string): Promise<void> => {
      if (visited.has(profileName)) {
        return;
      }
      visited.add(profileName);

      let loaded: unknown;
      try {
        loaded = await loadProfile(profileName);
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

  /**
   * Cancel all scheduled proactive renewal timers and clear all state.
   * Used for lifecycle cleanup when OAuthManager is destroyed.
   */
  clearAllTimers(): void {
    for (const [, entry] of this.proactiveRenewals) {
      clearTimeout(entry.timer);
    }
    this.proactiveRenewals.clear();
    this.proactiveRenewalFailures.clear();
    for (const entry of this.proactiveRenewalInFlight.values())
      entry.controller.abort(new Error('OAuth renewals cleared'));
    this.proactiveRenewalTokens.clear();
  }

  /**
   * Clear proactive renewal(s) matching a given provider and optionally bucket.
   * Called during logout to clean up timers for the logged-out provider/bucket.
   */
  clearRenewalsForProvider(providerName: string, bucket?: string): void {
    if (bucket) {
      const normalizedBucket = this.normalizeBucket(bucket);
      const key = this.getProactiveRenewalKey(providerName, normalizedBucket);
      this.clearProactiveRenewal(key);
    } else {
      // Clear all renewals for this provider
      const prefix = `${providerName}:`;
      for (const existingKey of Array.from(this.proactiveRenewals.keys())) {
        if (existingKey.startsWith(prefix)) {
          this.clearProactiveRenewal(existingKey);
        }
      }
    }
  }
}
