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

import {
  DebugLogger,
  mergeRefreshedToken,
  type OAuthTokenWithExtras,
} from '@vybestack/llxprt-code-core';
import type { OAuthToken, TokenStore } from './types.js';
import type { OAuthProvider } from './types.js';
import {
  createProfileManager,
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
  private proactiveRenewalInFlight: Set<string> = new Set();
  private proactiveRenewalTokens: Map<string, string> = new Map();

  constructor(
    private tokenStore: TokenStore,
    private getProvider: (name: string) => OAuthProvider | undefined,
    private isOAuthEnabled: (name: string) => boolean,
  ) {}

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
    this.proactiveRenewalInFlight.delete(key);
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
    this.proactiveRenewalTokens.set(key, token.access_token);
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
  async runProactiveRenewal(
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

      const provider = this.getProvider(providerName);
      if (!provider) {
        // Provider might not be registered in this runtime; keep the timer but back off.
        this.scheduleProactiveRetry(providerName, normalizedBucket);
        return;
      }

      await this.acquireAndRefresh(
        providerName,
        normalizedBucket,
        key,
        provider,
      );
    } finally {
      this.proactiveRenewalInFlight.delete(key);
    }
  }

  /**
   * Acquires the refresh lock and performs the token refresh under lock.
   */
  private async acquireAndRefresh(
    providerName: string,
    normalizedBucket: string,
    key: string,
    provider: OAuthProvider,
  ): Promise<void> {
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
      await this.performTokenRefresh(
        providerName,
        normalizedBucket,
        key,
        provider,
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
  ): Promise<void> {
    // Issue #1159: Double-check pattern - re-read token after acquiring lock
    const currentToken = await this.tokenStore.getToken(
      providerName,
      normalizedBucket,
    );

    if (!currentToken || !currentToken.refresh_token) {
      this.clearProactiveRenewal(key);
      return;
    }

    // @plan PLAN-20260223-ISSUE1598.P14
    // @requirement REQ-1598-PR02
    // Check if another process already refreshed the token
    if (this.hasTokenBeenRefreshedExternally(key, currentToken)) {
      this.scheduleProactiveRenewal(
        providerName,
        normalizedBucket,
        currentToken,
      );
      return;
    }

    const refreshedToken = await provider.refreshToken(currentToken);
    if (!refreshedToken) {
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
    const scheduledAccessToken = this.proactiveRenewalTokens.get(key);
    if (scheduledAccessToken) {
      return currentToken.access_token !== scheduledAccessToken;
    }
    // Direct runProactiveRenewal call (no prior schedule) — use expiry-based check
    const nowInSeconds = Math.floor(Date.now() / 1000);
    return currentToken.expiry > nowInSeconds + 30;
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
      await this.collectLoadBalancerTargets(profile, targets);
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
   * Recursively collects OAuth targets from a load-balancer profile.
   */
  private async collectLoadBalancerTargets(
    profile: { type: 'loadbalancer'; profiles: string[] },
    targets: Array<{ providerName: string; bucket: string }>,
  ): Promise<void> {
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
    this.proactiveRenewalInFlight.clear();
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
